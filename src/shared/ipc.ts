// The IPC contract. Both the main process and the renderer import this module, so the boundary is
// type-checked end to end with no codegen step, and the X-Libs bridge builds both ends from it. Types the
// library store owns are declared there and only named here, so each has one declaration.

import { backup_method_names, type BackupMethods } from '@x-tech-laboratories/x-libs/backup_protocol'
import { define_bridge } from '@x-tech-laboratories/x-libs/electron/bridge'
import { define_events } from '@x-tech-laboratories/x-libs/electron/events'
import { history_method_names, type HistoryMethods } from '@x-tech-laboratories/x-libs/history'
import { local_mcp_method_names, type LocalMcpMethods } from '@x-tech-laboratories/x-libs/local_mcp_protocol'
import type { FilterNode, SortKey, Limit } from './filter.ts'
import type { TrackDetails } from './library/details.ts'
import type { DuplicateGroup, DuplicateReason } from './library/duplicates.ts'
import type { TrackSnapshot } from './library/history.ts'
import type { MergeEntry, MergePreview, MergeResult, Resolution } from './library/merge.ts'

export type { DetailMedia, TrackDetails } from './library/details.ts'
export type { DuplicateGroup, DuplicateMember, DuplicateReason } from './library/duplicates.ts'
export type { TrackSnapshot, TrackState } from './library/history.ts'
export type { FieldOption, MergeEntry, MergePreview, MergeResult, PreviewField, PreviewMedia, Resolution } from './library/merge.ts'
export type { Version, VersionKind } from '@x-tech-laboratories/x-libs/history'

export interface LibraryStats {
  tracks: number
  media: number
  albums: number
  missing: number
  totalMs: number
  schemaVersion: number
  path: string
}

export interface TrackRow {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  year: number | null
  track_number: number | null
  length_ms: number | null
  rating: number | null
  play_count: number
}

export interface GroupRow {
  gid: number | string | null
  label: string | null
  n: number
  total_ms: number
}

export interface QueryRequest {
  filter: FilterNode
  sort?: readonly SortKey[]
  limit?: Limit
  offset?: number
}

export interface GmbPreview {
  path: string
  exists: boolean
  version?: string
  baseFolder?: string
  songs: number
  savedFilters: number
  savedLists: number
  playHistoryEntries: number
  unmappedColumns: string[]
  error?: string
}

export interface ImportReport {
  songsRead: number
  tracksCreated: number
  tracksUpdated: number
  mediaMatched: number
  mediaCreated: number
  missingFlagged: number
  playHistoryRows: number
  playlistsCreated: number
  savedFiltersFound: number
  unmappedColumns: string[]
  notes: string[]
}

export interface Root {
  id: string
  path: string
  enabled: boolean
  slow: boolean
  lastScan: number | null
}

export interface ScanProgress {
  phase: 'walking' | 'reading' | 'finishing'
  found: number
  processed: number
  currentPath?: string
}

export type FileOutcome = 'new' | 'matched' | 'moved' | 'unchanged' | 'error' | 'missing'

export interface FileResult {
  path: string
  outcome: FileOutcome
  // Why, for errors; the previous path, for moves.
  detail?: string
  trackId?: string
}

export interface ScanReport {
  filesFound: number
  filesRead: number
  filesSkipped: number
  tracksCreated: number
  tracksMatched: number
  movesDetected: number
  markedMissing: number
  errors: { path: string; message: string }[]
  durationMs: number
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface PlayerTrack {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  lengthMs: number | null
  rating: number | null
}

export interface PlayerMedia {
  id: string
  uri: string
  startMs: number | null
  endMs: number | null
  gainDb: number | null
}

export interface PlayerStatus {
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  track: PlayerTrack | null
  media: PlayerMedia | null
  positionMs: number
  durationMs: number | null
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  // Tracks explicitly queued, which drain before the standing context.
  queue: string[]
  // The list the player walks when the queue is empty.
  contextLength: number
  contextIndex: number
  error?: string
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

// Every call X-Music offers: the page makes them, and other programs reach them through the local MCP server.
export interface XMusicApi {
  get_app_info: () => AppInfo
  get_library_stats: () => LibraryStats
  list_tracks: (filter: FilterNode, sort?: readonly SortKey[], limit?: Limit, offset?: number) => TrackRow[]
  list_track_groups: (filter: FilterNode, field: string) => GroupRow[]
  get_track: (track_id: string) => TrackDetails | null
  list_duplicates: (reasons?: DuplicateReason[], length_tolerance_ms?: number, limit?: number) => DuplicateGroup[]
  get_merge_preview: (track_ids: string[]) => MergePreview
  merge_tracks: (track_ids: string[], survivor_id: string, resolutions?: Record<string, Resolution>) => MergeResult
  undo_merge: (batch_id: string) => { batchId: string; restored: string[]; survivor: string }
  list_folders: () => Root[]
  add_folder: (path: string) => Root
  remove_folder: (folder_id: string) => { removed: boolean }
  scan_folders: () => ScanReport
  cancel_scan: () => { cancelled: boolean }
  get_default_gmbrc_path: () => string
  get_gmbrc_preview: (path: string) => GmbPreview
  import_gmbrc: (path: string, statistics?: boolean, labels?: boolean, playlists?: boolean) => ImportReport
  clear_library: () => { cleared: boolean }
  get_player_status: () => PlayerStatus
  play_track: (track_id: string, context?: string[], index?: number) => PlayerStatus
  toggle_playback: () => PlayerStatus
  play_next: () => PlayerStatus
  play_previous: () => PlayerStatus
  stop_playback: () => PlayerStatus
  seek: (position_ms: number) => PlayerStatus
  set_volume: (volume: number) => PlayerStatus
  queue_tracks: (track_ids: string[], position?: 'end' | 'next') => PlayerStatus
  remove_from_queue: (index: number) => PlayerStatus
  clear_queue: () => PlayerStatus
  set_repeat: (mode: RepeatMode) => PlayerStatus
  set_shuffle: (on: boolean) => PlayerStatus
}

export const api_method_names = [
  'get_app_info', 'get_library_stats', 'list_tracks', 'list_track_groups', 'get_track',
  'list_duplicates', 'get_merge_preview', 'merge_tracks', 'undo_merge',
  'list_folders', 'add_folder', 'remove_folder', 'scan_folders', 'cancel_scan',
  'get_default_gmbrc_path', 'get_gmbrc_preview', 'import_gmbrc', 'clear_library',
  'get_player_status', 'play_track', 'toggle_playback', 'play_next', 'play_previous', 'stop_playback',
  'seek', 'set_volume', 'queue_tracks', 'remove_from_queue', 'clear_queue', 'set_repeat', 'set_shuffle'
] as const satisfies readonly (keyof XMusicApi)[]

export interface LogRecord {
  level: 'critical' | 'error' | 'warn' | 'info' | 'debug'
  scope: string
  message: string
  data?: unknown
}

// Calls only X-Music's own window makes: dialogs, the file manager, cover images and its log, none of them for other programs.
export interface XMusicPageApi {
  pick_folder: () => string | null
  pick_gmbrc_file: () => string | null
  show_in_folder: (uri: string) => { revealed: boolean }
  // Finds a track's cover and caches it, so it writes; gives an x-music-art:// url, or null when the track has none.
  cache_cover: (track_id: string, size?: number) => { url: string | null; source: string }
  write_log: (record: LogRecord) => { logged: boolean }
  get_log_config: () => { spec: string | undefined }
}

export const page_method_names = [
  'pick_folder', 'pick_gmbrc_file', 'show_in_folder', 'cache_cover', 'write_log', 'get_log_config'
] as const satisfies readonly (keyof XMusicPageApi)[]

// Pushed from the main process; the renderer subscribes rather than polling.
export type XMusicEvents = {
  scan_progress: ScanProgress
  // Batched, because one message per file would flood the bridge on a large library.
  scan_files: FileResult[]
  scan_done: ScanReport
  player_status: PlayerStatus
  // Throttled; the UI interpolates between ticks rather than being fed every frame.
  player_position: { positionMs: number; durationMs: number | null }
  // The library changed outside the window, through the MCP server.
  changed: null
}

export type EventName = keyof XMusicEvents

export type ApiName = keyof XMusicApi
export type PageName = keyof XMusicPageApi

// The page reaches these as window.xMusic, window.xMusicPage and window.xMusicEvents.
export const x_music_bridge = define_bridge<XMusicApi>('xMusic', api_method_names)
export const x_music_page_bridge = define_bridge<XMusicPageApi>('xMusicPage', page_method_names)
export const x_music_events = define_events<XMusicEvents>('xMusicEvents')
// The library database's backups, for Settings, as window.xMusicBackups.
export const x_music_backups_bridge = define_bridge<BackupMethods>('xMusicBackups', backup_method_names)
// The local MCP server's settings, for Settings, as window.xMusicMcp.
export const x_music_mcp_bridge = define_bridge<LocalMcpMethods>('xMusicMcp', local_mcp_method_names)

// The track history: a track's versions, the latest changes to every track, restoring a version, how long versions are kept, and the latest merges.
export type XMusicHistoryApi = HistoryMethods<TrackSnapshot> & {
  get_history_keep_days: () => number
  set_history_keep_days: (days: number) => void
  list_recent_merges: (limit: number) => MergeEntry[]
}

export const history_channels = [...history_method_names, 'get_history_keep_days', 'set_history_keep_days', 'list_recent_merges'] as const

// The page reaches these as window.xMusicHistory.
export const x_music_history_bridge = define_bridge<XMusicHistoryApi>('xMusicHistory', history_channels)
