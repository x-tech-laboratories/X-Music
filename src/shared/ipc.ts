// The IPC contract. Both the main process and the renderer import this module, so the boundary is
// type-checked end to end with no codegen step, and the X-Libs bridge builds both ends from it. Types the
// library store owns are declared there and only named here, so each has one declaration.

import { backup_method_names, type BackupMethods } from '@x-tech-laboratories/x-libs/backup_protocol'
import { define_bridge } from '@x-tech-laboratories/x-libs/electron/bridge'
import { define_events } from '@x-tech-laboratories/x-libs/electron/events'
import { history_method_names, type HistoryMethods } from '@x-tech-laboratories/x-libs/history'
import type { FilterNode, SortKey, Limit } from './filter'
import type { FieldDescriptor } from './fields'
import type { TrackDetails } from './library/details'
import type { DuplicateGroup, DuplicateReason } from './library/duplicates'
import type { TrackSnapshot } from './library/history'
import type { MergePreview, MergeResult, Resolution } from './library/merge'

export type { DetailMedia, TrackDetails } from './library/details'
export type { DuplicateGroup, DuplicateMember, DuplicateReason } from './library/duplicates'
export type { TrackSnapshot, TrackState } from './library/history'
export type { FieldOption, MergePreview, MergeResult, PreviewField, PreviewMedia, Resolution } from './library/merge'
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
  /** Why, for errors; the previous path, for moves. */
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
  /** Tracks explicitly queued, which drain before the standing context. */
  queue: string[]
  /** The list the player walks when the queue is empty. */
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

/** Every channel the renderer may invoke, with its argument and result types. */
export interface XMusicApi {
  'app:info': () => AppInfo
  'library:stats': () => LibraryStats
  'library:query': (req: QueryRequest) => TrackRow[]
  'library:groupBy': (req: { filter: FilterNode; field: string }) => GroupRow[]
  'library:explain': (req: QueryRequest) => { sql: string; params: unknown[] }
  'fields:list': () => FieldDescriptor[]
  'theme:list': () => string[]
  'import:gmbDefaultPath': () => string
  'import:gmbBrowse': () => string | null
  'import:gmbPreview': (path: string) => GmbPreview
  'import:gmbRun': (req: { path: string; statistics?: boolean; labels?: boolean; playlists?: boolean }) => ImportReport
  'library:reset': () => { cleared: boolean }
  'library:roots': () => Root[]
  'library:addRoot': () => Root | null
  'library:removeRoot': (id: string) => { removed: boolean }
  'library:scan': () => ScanReport
  'library:scanCancel': () => { cancelled: boolean }
  'tracks:mergePreview': (ids: string[]) => MergePreview
  'tracks:merge': (req: {
    ids: string[]
    survivor: string
    resolutions?: Record<string, Resolution>
  }) => MergeResult
  'tracks:unmerge': (batchId: string) => { batchId: string; restored: string[]; survivor: string }
  'app:log': (record: {
    level: 'critical' | 'error' | 'warn' | 'info' | 'debug'
    scope: string
    message: string
    data?: unknown
  }) => { logged: boolean }
  'app:logConfig': () => { spec: string | undefined }
  'tracks:details': (trackId: string) => TrackDetails | null
  /** Resolves cover art lazily; returns an x-music-art:// url, or null when there is none. */
  'art:forTrack': (req: { trackId: string; size?: number }) =>
    { url: string | null; source: string }
  'art:rescan': () => { forgotten: number }
  'tracks:reveal': (uri: string) => { revealed: boolean }
  'player:status': () => PlayerStatus
  'player:playTrack': (req: { trackId: string; context?: string[]; index?: number }) => PlayerStatus
  'player:toggle': () => PlayerStatus
  'player:next': () => PlayerStatus
  'player:previous': () => PlayerStatus
  'player:stop': () => PlayerStatus
  'player:seek': (positionMs: number) => PlayerStatus
  'player:volume': (volume: number) => PlayerStatus
  'player:enqueue': (req: { trackIds: string[]; position?: 'end' | 'next' }) => PlayerStatus
  'player:dequeue': (index: number) => PlayerStatus
  'player:clearQueue': () => PlayerStatus
  'player:repeat': (mode: RepeatMode) => PlayerStatus
  'player:shuffle': (on: boolean) => PlayerStatus
  'tracks:duplicates': (opts?: {
    reasons?: DuplicateReason[]
    lengthToleranceMs?: number
    limit?: number
  }) => DuplicateGroup[]
}

/** Pushed from the main process; the renderer subscribes rather than polling. */
export type XMusicEvents = {
  'scan:progress': ScanProgress
  /** Batched, because one message per file would flood the bridge on a large library. */
  'scan:files': FileResult[]
  'scan:done': ScanReport
  'player:status': PlayerStatus
  /** Throttled; the UI interpolates between ticks rather than being fed every frame. */
  'player:position': { positionMs: number; durationMs: number | null }
}

export type EventName = keyof XMusicEvents

export type Channel = keyof XMusicApi
export type ApiArgs<C extends Channel> = Parameters<XMusicApi[C]>
export type ApiResult<C extends Channel> = ReturnType<XMusicApi[C]>

export const CHANNELS: readonly Channel[] = [
  'app:info', 'library:stats', 'library:query', 'library:groupBy',
  'library:explain', 'library:reset', 'fields:list', 'theme:list',
  'import:gmbDefaultPath', 'import:gmbBrowse', 'import:gmbPreview', 'import:gmbRun',
  'library:roots', 'library:addRoot', 'library:removeRoot', 'library:scan', 'library:scanCancel',
  'tracks:mergePreview', 'tracks:merge', 'tracks:unmerge', 'tracks:duplicates',
  'app:log', 'app:logConfig', 'tracks:details', 'tracks:reveal',
  'art:forTrack', 'art:rescan',
  'player:status', 'player:playTrack', 'player:toggle', 'player:next', 'player:previous',
  'player:stop', 'player:seek', 'player:volume', 'player:enqueue', 'player:dequeue',
  'player:clearQueue', 'player:repeat', 'player:shuffle'
]

// The page reaches these as window.xMusic and window.xMusicEvents.
export const x_music_bridge = define_bridge<XMusicApi>('xMusic', CHANNELS)
export const x_music_events = define_events<XMusicEvents>('xMusicEvents')
// The library database's backups, for Settings, as window.xMusicBackups.
export const x_music_backups_bridge = define_bridge<BackupMethods>('xMusicBackups', backup_method_names)

// The track history: a track's versions, the latest changes to every track, restoring a version, and how long versions are kept.
export type XMusicHistoryApi = HistoryMethods<TrackSnapshot> & {
  get_history_keep_days: () => number
  set_history_keep_days: (days: number) => void
}

export const history_channels = [...history_method_names, 'get_history_keep_days', 'set_history_keep_days'] as const

// The page reaches these as window.xMusicHistory.
export const x_music_history_bridge = define_bridge<XMusicHistoryApi>('xMusicHistory', history_channels)
