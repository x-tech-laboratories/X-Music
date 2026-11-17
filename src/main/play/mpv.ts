// mpv backend, driven over its JSON IPC socket.
//
// mpv is used for the same reason gmusicbrowser eventually added an mpv backend: gapless, format
// coverage, precise seeking and output backend selection are unglamorous and enormous to re-solve,
// and mpv has already solved them. X-Music talks to it as a subprocess rather than linking libmpv,
// which keeps the native dependency surface at zero.

import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection, type Socket } from 'node:net'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { on_path } from '@x-tech-laboratories/x-libs/agent/programs'

import type { EngineListener, EngineState, LoadOptions, PlaybackEngine } from './engine.ts'

// Finds an mpv that can run: an explicit setting, then X_MUSIC_MPV, then the PATH.
export async function find_mpv(explicit?: string): Promise<string | null> {
  for (const candidate of [explicit, process.env.X_MUSIC_MPV]) {
    const found = candidate ? await on_path(candidate) : null
    if (found) return found
  }
  return on_path('mpv')
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

/** Unique per engine instance: two engines in one process must not share an IPC socket. */
let instance_counter = 0

/** A Unix socket path holds about a hundred bytes, so a long temporary folder falls back to /tmp. */
const SOCKET_PATH_LIMIT = 100

const PROP_POSITION = 1
const PROP_DURATION = 2
const PROP_PAUSE = 3
const PROP_IDLE = 4

export interface MpvOptions {
  binary?: string
  /** Receives mpv's own diagnostics, which are otherwise discarded. */
  on_log?: (line: string) => void
  /** How often mpv reports position, in seconds. The UI interpolates between ticks. */
  position_interval?: number
  /** How long mpv has to open its socket before start-up counts as failed. */
  start_timeout_ms?: number
  extra_args?: readonly string[]
}

export class MpvEngine implements PlaybackEngine {
  private proc: ChildProcess | null = null
  private socket: Socket | null = null
  private readonly socket_path: string
  private buffer = ''
  private next_id = 1
  private pending = new Map<number, Pending>()
  private listeners = new Set<EngineListener>()

  private state: EngineState = 'idle'
  private position_ms = 0
  private duration_ms: number | null = null
  /** Start-up under way or done; null before the first command and after mpv fails or exits. */
  private ready: Promise<void> | null = null
  /** mpv's last diagnostic line, which explains a failed start. */
  private last_log = ''
  /** Set while a load is in flight, so mpv going idle mid-swap is not read as the track ending. */
  private swapping = false

  private readonly opts: MpvOptions

  constructor(opts: MpvOptions = {}) {
    this.opts = opts
    const name = `x-music-mpv-${process.pid}-${++instance_counter}.sock`
    const folder = join(tmpdir(), name).length <= SOCKET_PATH_LIMIT ? tmpdir() : '/tmp'
    this.socket_path = join(folder, name)
  }

  private emit: EngineListener = (event, payload) => {
    for (const l of this.listeners) l(event, payload)
  }

  private set_state(state: EngineState, error?: string): void {
    if (this.state === state && !error) return
    this.state = state
    this.emit('state', error ? { state, error } : { state })
  }

  /** Starts mpv on first use, and again after a failed start or an exit, so the next command is the retry. */
  private started(): Promise<void> {
    if (!this.ready) {
      this.ready = this.start().catch((err: Error) => {
        this.ready = null
        this.halt()
        this.set_state('error', err.message)
        throw err
      })
    }
    return this.ready
  }

  private async start(): Promise<void> {
    const binary = await find_mpv(this.opts.binary)
    if (!binary) throw new Error('mpv was not found; set X_MUSIC_MPV or install mpv')

    // A leftover socket file stops mpv binding, so clear it before starting.
    rmSync(this.socket_path, { force: true })
    this.last_log = ''

    const proc = spawn(binary, [
      '--idle=yes',
      '--no-video',
      '--gapless-audio=yes',
      '--keep-open=no',
      '--audio-display=no',
      // Without this mpv's diagnostics go nowhere, which makes a failed load unexplainable.
      '--msg-level=all=warn',
      `--input-ipc-server=${this.socket_path}`,
      ...(this.opts.extra_args ?? [])
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    this.proc = proc
    let stopped: string | null = null

    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim() === '') continue
        this.last_log = line.trim()
        this.opts.on_log?.(this.last_log)
      }
    })

    proc.on('error', (err) => { stopped = err.message })

    proc.on('close', (code, signal) => {
      stopped = signal ? `signal ${signal}` : `exit code ${code}`
      if (this.proc !== proc) return
      this.proc = null
      // Once running, an exit means the next command starts mpv again.
      if (this.socket) {
        this.ready = null
        this.socket.destroy()
        this.socket = null
        if (code !== 0) this.set_state('error', `mpv stopped (${stopped})`)
      }
    })

    await this.connect(() => stopped)
    await this.observe()
  }

  /** mpv creates the socket a moment after starting, so connecting retries until mpv stops or time runs out. */
  private connect(stopped: () => string | null): Promise<void> {
    const timeout_ms = this.opts.start_timeout_ms ?? 10_000
    const deadline = Date.now() + timeout_ms
    const detail = (): string => (this.last_log ? `: ${this.last_log}` : '')

    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        const reason = stopped()
        if (reason !== null) {
          reject(new Error(`mpv stopped while starting (${reason})${detail()}`))
          return
        }

        const socket = createConnection(this.socket_path)

        socket.once('connect', () => {
          this.socket = socket
          socket.setEncoding('utf8')
          socket.on('data', (chunk: string) => this.on_data(chunk))
          socket.on('error', () => socket.destroy())
          socket.on('close', () => {
            if (this.socket === socket) this.socket = null
            this.fail_pending(new Error('mpv stopped answering'))
          })
          resolve()
        })

        socket.once('error', () => {
          socket.destroy()
          if (Date.now() < deadline) {
            setTimeout(attempt, 40)
            return
          }
          reject(new Error(`mpv did not answer within ${Math.round(timeout_ms / 1000)} seconds${detail()}`))
        })
      }
      attempt()
    })
  }

  private fail_pending(err: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(err)
    this.pending.clear()
  }

  /** Stops the process and closes the socket, after a failed start or on dispose. */
  private halt(): void {
    this.socket?.destroy()
    this.socket = null
    this.proc?.kill()
    this.proc = null
    rmSync(this.socket_path, { force: true })
  }

  private on_data(chunk: string): void {
    this.buffer += chunk

    let index: number
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line === '') continue

      let message: Record<string, unknown>
      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue // A malformed line must not stall the stream.
      }

      if (typeof message.request_id === 'number') {
        const waiter = this.pending.get(message.request_id)
        if (waiter) {
          this.pending.delete(message.request_id)
          if (message.error === 'success') waiter.resolve(message.data)
          else waiter.reject(new Error(String(message.error)))
        }
        continue
      }

      this.on_event(message)
    }
  }

  private on_event(message: Record<string, unknown>): void {
    if (message.event === 'property-change') {
      const id = message.id as number
      const value = message.data

      if (id === PROP_POSITION && typeof value === 'number') {
        this.position_ms = Math.round(value * 1000)
        this.emit('position', { position_ms: this.position_ms, duration_ms: this.duration_ms })
      } else if (id === PROP_DURATION) {
        this.duration_ms = typeof value === 'number' ? Math.round(value * 1000) : null
      } else if (id === PROP_PAUSE && typeof value === 'boolean') {
        if (this.state === 'playing' || this.state === 'paused') {
          this.set_state(value ? 'paused' : 'playing')
        }
      } else if (id === PROP_IDLE && value === true && !this.swapping) {
        // mpv goes idle when its playlist runs out, which is how a finished track reports itself.
        if (this.state === 'playing' || this.state === 'paused') {
          this.set_state('ended')
          this.emit('ended', {})
        }
      }
      return
    }

    if (message.event === 'end-file' && message.reason === 'error') {
      const detail = String(message.file_error ?? 'playback failed')
      this.opts.on_log?.(`end-file error: ${JSON.stringify(message)}`)
      this.set_state('error', detail)
    }
  }

  /**
   * Writes a command straight to the socket. Used during start-up, where waiting on `ready` would
   * deadlock: `ready` is the promise that start-up itself resolves.
   */
  private send(...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('mpv is not connected'))
        return
      }
      const id = this.next_id++
      this.pending.set(id, { resolve, reject })
      this.socket.write(`${JSON.stringify({ command: args, request_id: id })}\n`)
    })
  }

  /** Waits for start-up before sending, for everything after it. */
  private command(...args: unknown[]): Promise<unknown> {
    return this.started().then(() => this.send(...args))
  }

  private async observe(): Promise<void> {
    const interval = this.opts.position_interval ?? 0.25
    await this.send('observe_property', PROP_POSITION, 'time-pos')
    await this.send('observe_property', PROP_DURATION, 'duration')
    await this.send('observe_property', PROP_PAUSE, 'pause')
    await this.send('observe_property', PROP_IDLE, 'idle-active')
    // mpv reports time-pos on change; this keeps the cadence predictable for the UI.
    await this.send('set_property', 'options/audio-buffer', String(interval))
  }

  /**
   * mpv 0.38 added an insert-index parameter to loadfile, so the signature is
   * `loadfile <url> <flags> <index> <options>`. Passing options in the index slot fails with
   * "invalid parameter", and an empty options string is rejected outright — so the argument list
   * is built rather than padded.
   */
  private load_args(uri: string, mode: 'replace' | 'append', opts?: LoadOptions): unknown[] {
    const flags = this.apply_options(opts)
    return flags.length > 0
      ? ['loadfile', uri, mode, -1, flags.join(',')]
      : ['loadfile', uri, mode]
  }

  private apply_options(opts?: LoadOptions): string[] {
    const flags: string[] = []
    if (opts?.start_ms != null) flags.push(`start=${(opts.start_ms / 1000).toFixed(3)}`)
    if (opts?.end_ms != null) flags.push(`end=${(opts.end_ms / 1000).toFixed(3)}`)
    // ReplayGain is applied as a volume adjustment rather than by re-encoding anything.
    if (opts?.gain_db != null) {
      const factor = Math.pow(10, opts.gain_db / 20)
      flags.push(`af-add=volume=${factor.toFixed(4)}`)
    }
    return flags
  }

  async load(uri: string, opts?: LoadOptions): Promise<void> {
    this.swapping = true
    this.set_state('loading')
    this.position_ms = 0
    this.duration_ms = null

    try {
      await this.command(...this.load_args(uri, 'replace', opts))
      await this.command('set_property', 'pause', false)
      this.set_state('playing')
    } finally {
      this.swapping = false
    }
  }

  async preload(uri: string, opts?: LoadOptions): Promise<void> {
    // Appending puts the next file in mpv's own playlist, which is what makes the join gapless.
    await this.command(...this.load_args(uri, 'append', opts))
  }

  async play(): Promise<void> {
    await this.command('set_property', 'pause', false)
    this.set_state('playing')
  }

  async pause(): Promise<void> {
    await this.command('set_property', 'pause', true)
    this.set_state('paused')
  }

  async stop(): Promise<void> {
    if (!this.ready) {
      this.set_state('idle')
      return
    }
    this.swapping = true
    try {
      await this.command('stop')
      this.set_state('idle')
    } finally {
      this.swapping = false
    }
  }

  async seek(position_ms: number): Promise<void> {
    await this.command('seek', position_ms / 1000, 'absolute')
    this.position_ms = position_ms
  }

  async set_volume(volume: number): Promise<void> {
    await this.command('set_property', 'volume', volume)
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    this.listeners.clear()
    if (this.ready) {
      try {
        await this.command('quit')
      } catch {
        // Already gone; killing below is the fallback.
      }
    }
    this.halt()
  }
}
