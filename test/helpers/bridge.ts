// A stand-in for the preload bridge, so a rendered test can mount the whole window without a main process.

import { CHANNELS, type LibraryStats, type PlayerStatus } from '@shared/ipc'

export const empty_stats: LibraryStats = { tracks: 0, media: 0, albums: 0, missing: 0, totalMs: 0, schemaVersion: 1, path: '/tmp/x-music-test.db' }

const idle_status: PlayerStatus = {
  state: 'idle', track: null, media: null, positionMs: 0, durationMs: null, volume: 80,
  repeat: 'off', shuffle: false, queue: [], contextLength: 0, contextIndex: -1
}

// What each call answers unless a test overrides it; a function answer may throw to make the call fail.
const defaults: Record<string, unknown> = {
  'app:logConfig': { spec: 'critical' },
  'app:info': { version: '0.1.2', electron: '43.0.0', chrome: '140.0', node: '24.0.0', platform: 'linux' },
  'app:log': undefined,
  'library:stats': empty_stats,
  'library:query': [],
  'library:groupBy': [],
  'library:explain': { sql: '', params: [] },
  'library:roots': [],
  'import:gmbDefaultPath': '',
  'player:status': idle_status
}

export function install_bridge(answers: Record<string, unknown> = {}): void {
  const table = { ...defaults, ...answers }
  const call = (channel: string) => async () => {
    const answer = table[channel]
    return typeof answer === 'function' ? (answer as () => unknown)() : answer
  }
  Object.assign(window, {
    // A plain object of every channel, as the preload exposes it.
    xMusic: Object.fromEntries(CHANNELS.map((channel) => [channel, call(channel)])),
    xMusicEvents: { on: () => () => undefined },
    xMusicBackups: {
      list_backups: async () => [],
      get_backup_schedule: async () => ({ automatic: true, to_keep: 14 }),
      set_backup_schedule: async () => undefined,
      create_backup: async () => undefined,
      restore_backup: async () => undefined,
      remove_backup: async () => undefined
    },
    xMusicHistory: {
      list_versions: async () => [],
      list_recent_versions: async () => [],
      list_recent_merges: async () => [],
      restore_version: async () => undefined,
      get_history_keep_days: async () => 365,
      set_history_keep_days: async () => undefined
    }
  })
}
