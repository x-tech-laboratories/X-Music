// What plays, and what plays next.
//
// This owns every decision X-Music makes about playback and none of the audio: which of a track's
// media to use, when a play counts as a play rather than a skip, how the queue drains against the
// standing playlist, and what repeat and shuffle mean. The engine underneath is injected, so all of
// it is testable without spawning a process.

import { existsSync } from 'node:fs'

import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { PlayerMedia, PlayerStatus, PlayerTrack, RepeatMode } from '@shared/ipc'
import {
  count_play, count_skip, get_player_track, has_any_file, list_playable_files, set_file_present
} from '@shared/library/plays'
import type { LoadOptions, PlaybackEngine } from './engine.ts'

export type { PlayerMedia, PlayerStatus, PlayerTrack, RepeatMode }

export interface PlayerEvents {
  status: PlayerStatus
  position: { position_ms: number; duration_ms: number | null }
}

export type PlayerListener = <E extends keyof PlayerEvents>(
  event: E,
  payload: PlayerEvents[E]
) => void

/**
 * A play counts once the listener has heard enough of it to mean it. Anything less that is skipped
 * forward counts as a skip. These are the conventional thresholds and they matter, because play
 * counts drive weighted shuffle and smart playlists.
 */
export const PLAY_THRESHOLD_RATIO = 0.5
export const PLAY_THRESHOLD_MS = 240_000

export function counts_as_play(position_ms: number, duration_ms: number | null): boolean {
  if (position_ms >= PLAY_THRESHOLD_MS) return true
  if (duration_ms === null || duration_ms <= 0) return false
  return position_ms / duration_ms >= PLAY_THRESHOLD_RATIO
}

/** Deterministic shuffle, so an order can be reproduced and tested. */
export function shuffle_order(length: number, seed: number): number[] {
  const order = Array.from({ length }, (_, i) => i)
  let s = seed | 0 || 1
  for (let i = length - 1; i > 0; i--) {
    s ^= s << 13; s |= 0
    s ^= s >>> 17
    s ^= s << 5; s |= 0
    const j = Math.abs(s) % (i + 1)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

export interface PlayerOptions {
  /** How ReplayGain is applied; 'off' leaves the file alone. */
  replay_gain?: 'off' | 'track' | 'album'
  preamp_db?: number
  // Runs after the player writes to the library, such as a counted play, so the track history sees it.
  after_write?: () => void
}

export class Player {
  private listeners = new Set<PlayerListener>()
  private unsubscribe: (() => void) | null = null

  private context: string[] = []
  private context_index = -1
  private order: number[] | null = null
  private queue: string[] = []

  private current_track: PlayerTrack | null = null
  private current_media: PlayerMedia | null = null
  private state: PlayerStatus['state'] = 'idle'
  private position_ms = 0
  private duration_ms: number | null = null
  private volume = 80
  private error: string | undefined

  repeat: RepeatMode = 'off'
  shuffle = false

  /** Highest position reached in the current track, so a seek back cannot fake a play. */
  private furthest_ms = 0
  /** A track resolves to exactly one outcome: played, skipped, or neither. Never both. */
  private settled = false
  private seed = 1

  private readonly db: SqlDatabase
  private readonly engine: PlaybackEngine
  private readonly opts: PlayerOptions

  constructor(db: SqlDatabase, engine: PlaybackEngine, opts: PlayerOptions = {}) {
    this.db = db
    this.engine = engine
    this.opts = opts
    this.unsubscribe = engine.subscribe((event, payload) => {
      if (event === 'position') {
        const p = payload as PlayerEvents['position']
        this.position_ms = p.position_ms
        this.duration_ms = p.duration_ms ?? this.duration_ms
        this.furthest_ms = Math.max(this.furthest_ms, p.position_ms)
        this.maybe_count_play()
        this.emit('position', { position_ms: this.position_ms, duration_ms: this.duration_ms })
      } else if (event === 'state') {
        const s = payload as { state: PlayerStatus['state']; error?: string }
        this.state = s.state
        this.error = s.error
        this.publish()
      } else if (event === 'ended') {
        void this.on_ended()
      }
    })
  }

  // ── data access ────────────────────────────────────────────────────────
  private load_track(id: string): PlayerTrack | null {
    return get_player_track(this.db, id)
  }

  /**
   * The best source that is actually there.
   *
   * Existence is checked rather than trusted: a library imported from elsewhere, or scanned before
   * a drive was unplugged, is full of rows whose files have since gone. Handing one of those to the
   * engine produces "loading failed", which tells the listener nothing. A row found to be absent is
   * marked so, which also means the library corrects itself as it is used.
   */
  private load_media(track_id: string): PlayerMedia | null {
    const rows = list_playable_files(this.db, track_id)

    const mode = this.opts.replay_gain ?? 'off'

    for (const row of rows) {
      if (!existsSync(row.uri)) {
        if (row.present === 1) set_file_present(this.db, row.id, false)
        continue
      }

      // Found on disk after being marked absent: the drive came back, so record that.
      if (row.present === 0) set_file_present(this.db, row.id, true)

      const gain = mode === 'track' ? row.trackGain : mode === 'album' ? row.albumGain : null
      return {
        id: row.id,
        uri: row.uri,
        startMs: row.startMs,
        endMs: row.endMs,
        gainDb: gain === null ? null : gain + (this.opts.preamp_db ?? 0)
      }
    }

    return null
  }

  /** Whether a track has any file on disk, without loading it. */
  private has_any_media(track_id: string): boolean {
    return has_any_file(this.db, track_id)
  }

  // ── statistics ─────────────────────────────────────────────────────────
  private maybe_count_play(): void {
    if (this.settled || !this.current_track) return
    if (!counts_as_play(this.furthest_ms, this.duration_ms ?? this.current_track.lengthMs)) return

    this.settled = true
    count_play(this.db, this.current_track.id, Date.now())
    this.opts.after_write?.()
  }

  /** Called when a track is abandoned before it counted as played. */
  private record_skip(): void {
    if (this.settled || !this.current_track) return
    // Barely-started tracks are not skips; the listener changed their mind before it began.
    if (this.furthest_ms < 3000) return

    this.settled = true
    count_skip(this.db, this.current_track.id, Date.now())
    this.opts.after_write?.()
  }

  // ── ordering ───────────────────────────────────────────────────────────
  private rebuild_order(): void {
    this.order = this.shuffle ? shuffle_order(this.context.length, this.seed) : null
  }

  /** Position of `contextIndex` within the walk order. */
  private order_position(): number {
    if (!this.order) return this.context_index
    return this.order.indexOf(this.context_index)
  }

  private context_at(order_pos: number): string | null {
    if (order_pos < 0 || order_pos >= this.context.length) return null
    const idx = this.order ? this.order[order_pos]! : order_pos
    return this.context[idx] ?? null
  }

  private next_from_context(step: 1 | -1): { track_id: string; index: number } | null {
    if (this.context.length === 0) return null

    const pos = this.order_position()
    let next_pos = pos + step

    if (next_pos >= this.context.length || next_pos < 0) {
      if (this.repeat !== 'all') return null
      next_pos = step === 1 ? 0 : this.context.length - 1
      // A new pass through a shuffled list should not repeat the same order.
      if (this.shuffle) { this.seed = (this.seed * 1103515245 + 12345) | 0; this.rebuild_order() }
    }

    const track_id = this.context_at(next_pos)
    if (track_id === null) return null

    const index = this.order ? this.order[next_pos]! : next_pos
    return { track_id, index }
  }

  // ── commands ───────────────────────────────────────────────────────────
  set_context(track_ids: readonly string[], start_index = -1): void {
    this.context = [...track_ids]
    this.context_index = start_index
    this.rebuild_order()
    this.publish()
  }

  enqueue(track_ids: readonly string[], position: 'end' | 'next' = 'end'): void {
    this.queue = position === 'next'
      ? [...track_ids, ...this.queue]
      : [...this.queue, ...track_ids]
    this.publish()
  }

  dequeue(index: number): void {
    this.queue = this.queue.filter((_, i) => i !== index)
    this.publish()
  }

  clear_queue(): void {
    this.queue = []
    this.publish()
  }

  async play_track(track_id: string, context_index = -1): Promise<void> {
    this.record_skip()

    const track = this.load_track(track_id)
    if (!track) throw new Error(`track ${track_id} no longer exists`)

    const media = this.load_media(track_id)
    if (!media) {
      this.current_track = track
      this.current_media = null
      this.state = 'error'
      // Distinguish "never had a file" from "the file is gone", because the fix differs.
      this.error = this.has_any_media(track_id)
        ? 'The file for this track is missing. Rescan its folder, or reconnect the drive it is on.'
        : 'This track has no file. It exists in the library, but nothing is attached to it.'
      this.publish()
      return
    }

    this.current_track = track
    this.current_media = media
    this.position_ms = 0
    this.furthest_ms = 0
    this.settled = false
    this.duration_ms = track.lengthMs
    this.error = undefined
    if (context_index >= 0) this.context_index = context_index

    const opts: LoadOptions = {
      start_ms: media.startMs, end_ms: media.endMs, gain_db: media.gainDb
    }

    const started = await this.drive(async () => {
      await this.engine.load(media.uri, opts)
      await this.engine.play()
    })
    if (!started) return
    this.publish()
    // A failed hint only costs the gapless join, so it is dropped.
    void this.preload_next().catch(() => undefined)
  }

  /** Runs an engine call, turning its failure into the error state the listener sees rather than a rejection. */
  private async drive(work: () => Promise<void>): Promise<boolean> {
    try {
      await work()
      return true
    } catch (err) {
      this.state = 'error'
      this.error = (err as Error).message
      this.publish()
      return false
    }
  }

  /** Tells the engine what is coming, so it can make the transition gapless. */
  private async preload_next(): Promise<void> {
    if (!this.engine.preload) return
    const upcoming = this.peek_next()
    if (upcoming === null) return

    const media = this.load_media(upcoming)
    if (!media) return
    await this.engine.preload(media.uri, {
      start_ms: media.startMs, end_ms: media.endMs, gain_db: media.gainDb
    })
  }

  peek_next(): string | null {
    if (this.queue.length > 0) return this.queue[0]!
    if (this.repeat === 'one' && this.current_track) return this.current_track.id
    return this.next_from_context(1)?.track_id ?? null
  }

  async next(user_initiated = true): Promise<void> {
    if (user_initiated) this.record_skip()

    if (this.queue.length > 0) {
      const [head, ...rest] = this.queue
      this.queue = rest
      await this.play_track(head!)
      return
    }

    if (this.repeat === 'one' && this.current_track && !user_initiated) {
      await this.play_track(this.current_track.id)
      return
    }

    const target = this.next_from_context(1)
    if (!target) {
      await this.stop()
      return
    }
    await this.play_track(target.track_id, target.index)
  }

  async previous(): Promise<void> {
    // Restart the track first, as every other player does, before stepping back.
    if (this.position_ms > 3000 && this.current_track) {
      await this.seek(0)
      return
    }

    this.record_skip()
    const target = this.next_from_context(-1)
    if (!target) {
      await this.seek(0)
      return
    }
    await this.play_track(target.track_id, target.index)
  }

  private async on_ended(): Promise<void> {
    // Reaching the end is a complete listen even if the position tick missed the threshold.
    if (!this.settled && this.current_track) {
      this.furthest_ms = this.duration_ms ?? this.current_track.lengthMs ?? PLAY_THRESHOLD_MS
      this.maybe_count_play()
    }
    await this.next(false)
  }

  async play(): Promise<void> {
    if (!this.current_track) {
      const first = this.queue[0] ?? this.context_at(0)
      if (first === null || first === undefined) return
      await this.next(false)
      return
    }
    // After a failure, play starts the track again rather than resuming nothing.
    if (this.state === 'error') {
      await this.play_track(this.current_track.id)
      return
    }
    await this.drive(() => this.engine.play())
  }

  async pause(): Promise<void> { await this.drive(() => this.engine.pause()) }

  async toggle(): Promise<void> {
    if (this.state === 'playing') await this.pause()
    else await this.play()
  }

  async stop(): Promise<void> {
    this.record_skip()
    await this.drive(() => this.engine.stop())
    this.current_track = null
    this.current_media = null
    this.position_ms = 0
    this.state = 'idle'
    this.publish()
  }

  async seek(position_ms: number): Promise<void> {
    if (!(await this.drive(() => this.engine.seek(position_ms)))) return
    this.position_ms = position_ms
  }

  async set_volume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, volume))
    await this.drive(() => this.engine.set_volume(this.volume))
    this.publish()
  }

  set_repeat(mode: RepeatMode): void { this.repeat = mode; this.publish() }

  set_shuffle(on: boolean): void {
    this.shuffle = on
    this.rebuild_order()
    this.publish()
  }

  // ── observation ────────────────────────────────────────────────────────
  status(): PlayerStatus {
    return {
      state: this.state,
      track: this.current_track,
      media: this.current_media,
      positionMs: this.position_ms,
      durationMs: this.duration_ms,
      volume: this.volume,
      repeat: this.repeat,
      shuffle: this.shuffle,
      queue: [...this.queue],
      contextLength: this.context.length,
      contextIndex: this.context_index,
      error: this.error
    }
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit: PlayerListener = (event, payload) => {
    for (const l of this.listeners) l(event, payload)
  }

  private publish(): void {
    this.emit('status', this.status())
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.()
    this.listeners.clear()
    await this.engine.dispose()
  }
}
