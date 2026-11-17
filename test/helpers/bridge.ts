// A stand-in for the preload bridge, so a rendered test can mount the whole window without a main process.

import { api_method_names, history_channels, page_method_names, type LibraryStats, type PlayerStatus } from '@shared/ipc'

export const empty_stats: LibraryStats = { tracks: 0, media: 0, albums: 0, missing: 0, totalMs: 0, schemaVersion: 1, path: '/tmp/x-music-test.db' }

const idle_status: PlayerStatus = {
  state: 'idle', track: null, media: null, positionMs: 0, durationMs: null, volume: 80,
  repeat: 'off', shuffle: false, queue: [], contextLength: 0, contextIndex: -1
}

// What each call answers unless a test overrides it; a function answer gets the call's arguments and may throw to make the call fail.
const defaults: Record<string, unknown> = {
  get_log_config: { spec: 'critical' },
  get_app_info: { version: '0.1.2', electron: '43.0.0', chrome: '140.0', node: '24.0.0', platform: 'linux' },
  write_log: { logged: true },
  get_library_stats: empty_stats,
  list_tracks: [],
  list_track_groups: [],
  list_folders: [],
  get_default_gmbrc_path: '',
  get_player_status: idle_status,
  list_versions: [],
  list_recent_versions: [],
  list_recent_merges: [],
  get_history_keep_days: 365,
  get_local_mcp_settings: { enabled: false, port: 3919 },
  get_local_mcp_status: { state: 'off', url: '', error: '' }
}

type Listener = (payload: unknown) => void

let listeners = new Map<string, Set<Listener>>()

// Pushes an event from the main process to whatever the page listens with.
export function emit_event(event: string, payload: unknown): void {
  for (const listener of listeners.get(event) ?? []) listener(payload)
}

export interface Call {
  channel: string
  args: unknown[]
}

// Puts every bridge on the window, as the preload exposes them, and gives back every call made through them in order.
export function install_bridge(answers: Record<string, unknown> = {}): Call[] {
  const table = { ...defaults, ...answers }
  const calls: Call[] = []
  listeners = new Map()
  const client = (names: readonly string[]) => Object.fromEntries(names.map((channel) => [channel, async (...args: unknown[]) => {
    calls.push({ channel, args })
    const answer = table[channel]
    return typeof answer === 'function' ? (answer as (...args: unknown[]) => unknown)(...args) : answer
  }]))
  Object.assign(window, {
    xMusic: client(api_method_names),
    xMusicPage: client(page_method_names),
    xMusicHistory: client(history_channels),
    xMusicMcp: client(['get_local_mcp_settings', 'set_local_mcp_settings', 'get_local_mcp_status']),
    xMusicEvents: {
      on: (event: string, listener: Listener) => {
        const set = listeners.get(event) ?? new Set<Listener>()
        listeners.set(event, set.add(listener))
        return () => set.delete(listener)
      }
    },
    xMusicBackups: {
      list_backups: async () => [],
      get_backup_schedule: async () => ({ automatic: true, to_keep: 14 }),
      set_backup_schedule: async () => undefined,
      create_backup: async () => undefined,
      restore_backup: async () => undefined,
      remove_backup: async () => undefined
    }
  })
  return calls
}
