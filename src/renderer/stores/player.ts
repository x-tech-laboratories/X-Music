// Playback view state. The decisions all live in the main process; this mirrors status and
// interpolates the position between ticks so the seek bar moves smoothly without a 60 Hz IPC feed.

import type { PlayerStatus, RepeatMode } from '@shared/ipc'
import { ipc } from '../lib/ipc'
import { create_watch } from '../lib/watch'

class PlayerStore {
  // Bumped when the status changes.
  readonly status_changes = create_watch()
  // Bumped on every clock tick, which only the time bar watches.
  readonly position_changes = create_watch()

  private statusValue: PlayerStatus | null = null
  // Interpolated locally between position events.
  private positionValue = 0
  private lastTickAt = 0
  private timer: ReturnType<typeof setInterval> | null = null

  init(): () => void {
    void this.refresh()

    const offStatus = window.xMusicEvents.on('player:status', (s) => {
      this.status = s
      this.positionMs = s.positionMs
      this.lastTickAt = performance.now()
    })

    const offPosition = window.xMusicEvents.on('player:position', (p) => {
      this.positionMs = p.positionMs
      this.lastTickAt = performance.now()
      // Replacing status re-renders everything that reads it, so only do it when the duration moved.
      const s = this.statusValue
      if (s && p.durationMs !== null && p.durationMs !== s.durationMs) {
        this.status = { ...s, durationMs: p.durationMs }
      }
    })

    // Between ticks, advance the clock locally rather than asking the main process every frame.
    this.timer = setInterval(() => {
      if (this.statusValue?.state !== 'playing') return
      const elapsed = performance.now() - this.lastTickAt
      if (elapsed > 0 && elapsed < 2000) this.positionMs = this.positionValue + elapsed
      this.lastTickAt = performance.now()
    }, 250)

    return () => {
      offStatus()
      offPosition()
      if (this.timer) clearInterval(this.timer)
    }
  }

  private apply(s: PlayerStatus): void {
    this.status = s
    this.positionMs = s.positionMs
  }

  async refresh(): Promise<void> {
    this.apply(await ipc('player:status'))
  }

  async playTrack(trackId: number, context?: number[], index?: number): Promise<void> {
    this.apply(await ipc('player:playTrack', { trackId, context, index }))
  }

  async toggle(): Promise<void> { this.apply(await ipc('player:toggle')) }
  async next(): Promise<void> { this.apply(await ipc('player:next')) }
  async previous(): Promise<void> { this.apply(await ipc('player:previous')) }
  async stop(): Promise<void> { this.apply(await ipc('player:stop')) }
  async seek(ms: number): Promise<void> { this.positionMs = ms; this.apply(await ipc('player:seek', ms)) }
  async setVolume(v: number): Promise<void> { this.apply(await ipc('player:volume', v)) }

  async enqueue(trackIds: number[], position: 'end' | 'next' = 'end'): Promise<void> {
    this.apply(await ipc('player:enqueue', { trackIds, position }))
  }

  async dequeue(index: number): Promise<void> { this.apply(await ipc('player:dequeue', index)) }
  async clearQueue(): Promise<void> { this.apply(await ipc('player:clearQueue')) }
  async setRepeat(mode: RepeatMode): Promise<void> { this.apply(await ipc('player:repeat', mode)) }
  async setShuffle(on: boolean): Promise<void> { this.apply(await ipc('player:shuffle', on)) }

  get status(): PlayerStatus | null { return this.statusValue }
  set status(s: PlayerStatus | null) { this.statusValue = s; this.status_changes.bump() }
  get positionMs(): number { return this.positionValue }
  set positionMs(ms: number) { this.positionValue = ms; this.position_changes.bump() }

  get playing(): boolean { return this.status?.state === 'playing' }
  get currentId(): number | null { return this.status?.track?.id ?? null }
}

export const player = new PlayerStore()
