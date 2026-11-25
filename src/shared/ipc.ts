// The IPC contract. Both the main process and the renderer import this module, so the boundary is
// type-checked end to end with no codegen step, and the X-Libs bridge builds both ends from it. Types the
// library store owns are declared there and only named here, so each has one declaration.

import { backup_method_names, type BackupMethods } from '@x-tech-laboratories/x-libs/backup_protocol'
import { define_bridge } from '@x-tech-laboratories/x-libs/electron/bridge'
import { define_events } from '@x-tech-laboratories/x-libs/electron/events'
import { history_method_names, type HistoryMethods } from '@x-tech-laboratories/x-libs/history'
import { local_mcp_method_names, type LocalMcpMethods } from '@x-tech-laboratories/x-libs/local_mcp_protocol'
import { page_log_method_names, type PageLogMethods } from '@x-tech-laboratories/x-libs/log_protocol'
import type { FilterNode, SortKey } from '@x-tech-laboratories/x-libs/filter'
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
  total_ms: number
  schema_version: number
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

// One value of a field among the tracks, with how many tracks hold it and their total length.
export interface GroupRow {
  group_id: number | string | null
  label: string | null
  count: number
  total_ms: number
}

export interface QueryRequest {
  filter: FilterNode
  sort?: readonly SortKey[]
  // At most this many tracks, after skipping `offset` of them.
  limit?: number
  offset?: number
}

export interface GmbPreview {
  path: string
  exists: boolean
  version?: string
  base_folder?: string
  songs: number
  saved_filters: number
  saved_lists: number
  play_history_entries: number
  unmapped_columns: string[]
  error?: string
}

export interface ImportReport {
  songs_read: number
  tracks_created: number
  tracks_updated: number
  media_matched: number
  media_created: number
  missing_flagged: number
  play_history_rows: number
  playlists_created: number
  saved_filters_found: number
  unmapped_columns: string[]
  notes: string[]
}

export interface Root {
  id: string
  path: string
  enabled: boolean
  slow: boolean
  last_scan: number | null
}

export interface ScanProgress {
  phase: 'walking' | 'reading' | 'finishing'
  found: number
  processed: number
  current_path?: string
}

export type FileOutcome = 'new' | 'matched' | 'moved' | 'unchanged' | 'error' | 'missing'

export interface FileResult {
  path: string
  outcome: FileOutcome
  // Why, for errors; the previous path, for moves.
  detail?: string
  track_id?: string
}

export interface ScanReport {
  files_found: number
  files_read: number
  files_skipped: number
  tracks_created: number
  tracks_matched: number
  moves_detected: number
  marked_missing: number
  errors: { path: string; message: string }[]
  duration_ms: number
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface PlayerTrack {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  length_ms: number | null
  rating: number | null
}

export interface PlayerMedia {
  id: string
  uri: string
  start_ms: number | null
  end_ms: number | null
  gain_db: number | null
}

export interface PlayerStatus {
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  track: PlayerTrack | null
  media: PlayerMedia | null
  position_ms: number
  duration_ms: number | null
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  // Tracks explicitly queued, which drain before the standing context.
  queue: string[]
  // The list the player walks when the queue is empty.
  context_length: number
  context_index: number
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
  list_tracks: (filter: FilterNode, sort?: readonly SortKey[], limit?: number, offset?: number) => TrackRow[]
  list_track_groups: (filter: FilterNode, field: string) => GroupRow[]
  get_track: (track_id: string) => TrackDetails | null
  set_rating: (track_ids: string[], rating: number | null) => { changed: number }
  list_duplicates: (reasons?: DuplicateReason[], length_tolerance_ms?: number, limit?: number) => DuplicateGroup[]
  get_merge_preview: (track_ids: string[]) => MergePreview
  merge_tracks: (track_ids: string[], survivor_id: string, resolutions?: Record<string, Resolution>) => MergeResult
  undo_merge: (batch_id: string) => { batch_id: string; restored: string[]; survivor: string }
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
  move_in_queue: (index: number, to_index: number) => PlayerStatus
  clear_queue: () => PlayerStatus
  set_repeat: (mode: RepeatMode) => PlayerStatus
  set_shuffle: (on: boolean) => PlayerStatus
}

export const api_method_names = [
  'get_app_info', 'get_library_stats', 'list_tracks', 'list_track_groups', 'get_track', 'set_rating',
  'list_duplicates', 'get_merge_preview', 'merge_tracks', 'undo_merge',
  'list_folders', 'add_folder', 'remove_folder', 'scan_folders', 'cancel_scan',
  'get_default_gmbrc_path', 'get_gmbrc_preview', 'import_gmbrc', 'clear_library',
  'get_player_status', 'play_track', 'toggle_playback', 'play_next', 'play_previous', 'stop_playback',
  'seek', 'set_volume', 'queue_tracks', 'remove_from_queue', 'move_in_queue', 'clear_queue', 'set_repeat', 'set_shuffle'
] as const satisfies readonly (keyof XMusicApi)[]

// Calls only X-Music's own window makes: dialogs, the file manager and cover images, none of them for other programs.
export interface XMusicPageApi {
  pick_folder: () => string | null
  pick_gmbrc_file: () => string | null
  show_in_folder: (uri: string) => { revealed: boolean }
  // Finds a track's cover and caches it, so it writes; gives an x-music-art:// url, or null when the track has none.
  cache_cover: (track_id: string, size?: number) => { url: string | null; source: string }
}

export const page_method_names = [
  'pick_folder', 'pick_gmbrc_file', 'show_in_folder', 'cache_cover'
] as const satisfies readonly (keyof XMusicPageApi)[]

// Pushed from the main process; the renderer subscribes rather than polling.
export type XMusicEvents = {
  scan_progress: ScanProgress
  // Batched, because one message per file would flood the bridge on a large library.
  scan_files: FileResult[]
  scan_done: ScanReport
  player_status: PlayerStatus
  // Throttled; the UI interpolates between ticks rather than being fed every frame.
  player_position: { position_ms: number; duration_ms: number | null }
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
// The page's log, joining the main process's, as window.xMusicLog.
export const x_music_log_bridge = define_bridge<PageLogMethods>('xMusicLog', page_log_method_names)
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
