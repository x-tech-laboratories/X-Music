// Starting mpv, against a stand-in that answers its socket, exits, or stays silent as the test asks.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MpvEngine } from '@main/play/mpv'

// ============================================================================
// A stand-in mpv
// ============================================================================

// Reads its mode from a file beside it on each start, so one test can fix it between attempts.
const fake_mpv = `#!${process.execPath}
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const mode = fs.readFileSync(path.join(__dirname, 'mode'), 'utf8').trim()
const socket_path = process.argv.find((each) => each.startsWith('--input-ipc-server=')).slice('--input-ipc-server='.length)
if (mode === 'exit') { console.error('[ao] no audio device'); process.exit(2) }
if (mode === 'silent') setInterval(() => {}, 1000)
else {
  const server = net.createServer((connection) => {
    let buffer = ''
    connection.on('data', (chunk) => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)
        connection.write(JSON.stringify({ request_id: request.request_id, error: 'success', data: null }) + '\\n')
        if (request.command[0] === 'quit') process.exit(0)
      }
    })
  })
  server.on('error', (error) => { console.error(String(error)); process.exit(3) })
  server.listen(socket_path)
}
`

let folder: string
let binary: string
let engine: MpvEngine | null
let saved_tmpdir: string | undefined
const unhandled: unknown[] = []
const note_unhandled = (reason: unknown): void => { unhandled.push(reason) }

function set_mode(mode: 'serve' | 'exit' | 'silent'): void {
  writeFileSync(join(folder, 'mode'), mode)
}

function start_engine(options: { start_timeout_ms?: number } = {}): { engine: MpvEngine; states: { state: string; error?: string }[] } {
  const states: { state: string; error?: string }[] = []
  engine = new MpvEngine({ binary, ...options })
  engine.subscribe((event, payload) => { if (event === 'state') states.push(payload as { state: string; error?: string }) })
  return { engine, states }
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'x-music-fake-mpv-'))
  binary = join(folder, 'mpv')
  writeFileSync(binary, fake_mpv)
  chmodSync(binary, 0o755)
  set_mode('serve')
  engine = null
  saved_tmpdir = process.env.TMPDIR
  unhandled.length = 0
  process.on('unhandledRejection', note_unhandled)
})

afterEach(async () => {
  await engine?.dispose()
  process.off('unhandledRejection', note_unhandled)
  if (saved_tmpdir === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = saved_tmpdir
  rmSync(folder, { recursive: true, force: true })
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

// ============================================================================
// Starting
// ============================================================================

describe('starting mpv', () => {
  it('plays through an mpv that answers', async () => {
    const { engine, states } = start_engine()

    await engine.load('/music/song.flac')

    expect(states.at(-1)?.state).toBe('playing')
  })

  it('leaves nothing unhandled when mpv exits at start', async () => {
    set_mode('exit')

    start_engine()
    await new Promise((resolve) => setTimeout(resolve, 2300))

    expect(unhandled).toEqual([])
  }, 5000)

  it('reports an mpv that exits at start as an error state the listener can read', async () => {
    set_mode('exit')
    const { engine, states } = start_engine()

    await expect(engine.load('/music/song.flac')).rejects.toThrow(/mpv stopped while starting/)

    const last = states.at(-1)
    expect(last?.state).toBe('error')
    expect(last?.error).toMatch(/mpv stopped while starting.*no audio device/)
    await settle()
    expect(unhandled).toEqual([])
  })

  it('gives up on an mpv that never opens its socket', async () => {
    set_mode('silent')
    const { engine, states } = start_engine({ start_timeout_ms: 300 })

    await expect(engine.load('/music/song.flac')).rejects.toThrow(/did not answer/)

    expect(states.at(-1)?.state).toBe('error')
  })

  it('starts mpv again on the next command after a failed start', async () => {
    set_mode('exit')
    const { engine, states } = start_engine()
    await expect(engine.load('/music/song.flac')).rejects.toThrow()

    set_mode('serve')
    await engine.load('/music/song.flac')

    expect(states.at(-1)).toEqual({ state: 'playing' })
  })

  it('opens its socket even when the temporary folder has a long path', async () => {
    const long_folder = join(folder, 'a-temporary-folder-whose-path-is-far-too-long-for-a-unix-socket-to-live-inside-it')
    mkdirSync(long_folder)
    process.env.TMPDIR = long_folder
    const { engine, states } = start_engine({ start_timeout_ms: 2000 })

    await engine.load('/music/song.flac')

    expect(states.at(-1)?.state).toBe('playing')
  })
})
