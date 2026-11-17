// Playback view state. The decisions all live in the main process; this mirrors status and
// interpolates the position between ticks so the seek bar moves smoothly without a 60 Hz IPC feed.

import { create_store } from '@x-tech-laboratories/x-libs/web/store'
import { clean_error_message } from '@x-tech-laboratories/x-libs/electron/bridge'
import { describe_error } from '@x-tech-laboratories/x-libs/web/errors'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { PlayerStatus, RepeatMode } from '@shared/ipc'
import { ipc } from '../lib/ipc.ts'

// ============================================================================
// State
// ============================================================================

export const player_status = create_store<PlayerStatus | null>(null)

// Redrawn at a steady pace, since both the main process and the local clock move it.
export const player_position = create_store(0, { coalesce_in_milliseconds: 250 })

let last_tick_at = 0

function apply(status: PlayerStatus): void {
  player_status.set(status)
  player_position.set(status.positionMs)
}

// Every call answers with the new status; a failed call says so in a toast rather than going unseen.
async function act(work: () => Promise<PlayerStatus>): Promise<void> {
  try {
    apply(await work())
  } catch (error) {
    toast(`Playback failed: ${clean_error_message(describe_error(error))}`, { tone: 'bad' })
  }
}

// ============================================================================
// Following the main process
// ============================================================================

function init(): () => void {
  void refresh()

  const stop_status = window.xMusicEvents.on('player_status', (status) => {
    apply(status)
    last_tick_at = performance.now()
  })

  const stop_position = window.xMusicEvents.on('player_position', (tick) => {
    player_position.set(tick.positionMs)
    last_tick_at = performance.now()
    // Replacing status redraws everything that reads it, so only do it when the duration moved.
    const status = player_status.get()
    if (status && tick.durationMs !== null && tick.durationMs !== status.durationMs) {
      player_status.set({ ...status, durationMs: tick.durationMs })
    }
  })

  // Between ticks, advance the clock locally rather than asking the main process every frame.
  const timer = setInterval(() => {
    if (player_status.get()?.state !== 'playing') return
    const elapsed = performance.now() - last_tick_at
    if (elapsed > 0 && elapsed < 2000) player_position.set(player_position.get() + elapsed)
    last_tick_at = performance.now()
  }, 250)

  return () => {
    stop_status()
    stop_position()
    clearInterval(timer)
  }
}

function refresh(): Promise<void> {
  return act(() => ipc('get_player_status'))
}

// ============================================================================
// Actions
// ============================================================================

export const player = {
  init,
  refresh,
  play_track: (track_id: string, context?: string[], index?: number) => act(() => ipc('play_track', track_id, context, index)),
  toggle: () => act(() => ipc('toggle_playback')),
  next: () => act(() => ipc('play_next')),
  previous: () => act(() => ipc('play_previous')),
  stop: () => act(() => ipc('stop_playback')),
  seek: (milliseconds: number) => {
    player_position.set(milliseconds)
    return act(() => ipc('seek', milliseconds))
  },
  set_volume: (volume: number) => act(() => ipc('set_volume', volume)),
  enqueue: (track_ids: string[], position: 'end' | 'next' = 'end') => act(() => ipc('queue_tracks', track_ids, position)),
  dequeue: (index: number) => act(() => ipc('remove_from_queue', index)),
  clear_queue: () => act(() => ipc('clear_queue')),
  set_repeat: (mode: RepeatMode) => act(() => ipc('set_repeat', mode)),
  set_shuffle: (on: boolean) => act(() => ipc('set_shuffle', on)),

  // Read-only views of the stores, for the widgets that read them in place.
  status_changes: player_status.watch,
  position_changes: player_position.watch,
  get status(): PlayerStatus | null { return player_status.get() },
  get position_ms(): number { return player_position.get() },
  get playing(): boolean { return player_status.get()?.state === 'playing' },
  get current_id(): string | null { return player_status.get()?.track?.id ?? null }
}
