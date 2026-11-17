import { ipcMain, app, dialog, shell, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import type { Implementation, IpcMainEventLike } from '@x-tech-laboratories/x-libs/electron/bridge'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { defaultGmbrcPath, parseGmbrc } from '@shared/import/gmbrc'
import { importGmbrc } from '@shared/import/gmb_import'
import {
  x_music_bridge, x_music_events, x_music_history_bridge, x_music_page_bridge,
  type XMusicApi, type XMusicEvents, type XMusicHistoryApi, type XMusicPageApi, type EventName, type FileResult
} from '@shared/ipc'
import { trackDetails } from '@shared/library/details'
import { findDuplicates } from '@shared/library/duplicates'
import {
  get_history_keep_days, record_history, set_history_keep_days, track_history_methods
} from '@shared/library/history'
import { list_recent_merges, mergePreview, mergeTracks, unmerge } from '@shared/library/merge'
import {
  add_root, enabled_root_paths, group_tracks, library_stats, list_roots, mark_roots_scanned,
  query_tracks, remove_root
} from '@shared/library/store'
import { artCacheDir, resizeImage } from './artcache.ts'
import { clearLibraryBackedUp, type LibraryBackups } from './backups.ts'
import { resolveArtwork, thumbnail } from './library/artwork.ts'
import { scanRoots } from './library/scan.ts'
import { logFromRenderer, logger } from './log.ts'
import { Player } from './play/player.ts'
import { MpvEngine, findMpv } from './play/mpv.ts'
import { NullEngine } from './play/engine.ts'

// Every call other programs may make too, answered on the library and the player.
export type ApiImplementation = Implementation<XMusicApi> & Implementation<XMusicHistoryApi>

function emit<E extends EventName>(name: E, payload: XMusicEvents[E]): void {
  x_music_events.emit(BrowserWindow.getAllWindows(), name, payload)
}

export interface IpcOptions {
  path: string
  backups: LibraryBackups
  // Refuses calls from any page but X-Music's own.
  trusted: (event: IpcMainEventLike) => boolean
}

// Each call is followed by a version of every track it touched, so the history sees a write however it was made.
function recording<Methods extends Record<string, (...args: never[]) => unknown>>(database: SqlDatabase, methods: Methods): Methods {
  const wrapped = Object.entries(methods).map(([name, method]) => [name, (...args: never[]) => {
    const result = method(...args)
    if (result instanceof Promise) return result.finally(() => record_history(database))
    record_history(database)
    return result
  }])
  return Object.fromEntries(wrapped) as Methods
}

// Returns the calls for the MCP server, and what stops the player, whose mpv is a process of its own that would otherwise outlive X-Music.
export async function registerIpc(db: SqlDatabase, options: IpcOptions): Promise<{ api: ApiImplementation; stopPlayer: () => Promise<void> }> {
  // A scan runs at most once at a time; the flag is what cancel flips.
  let scanning: { aborted: boolean } | null = null

  // Without mpv the app still runs and the library still works; only audio is unavailable, and the
  // player reports that plainly rather than failing at the first click.
  const playLog = logger('play')
  const mpvPath = await findMpv()
  if (!mpvPath) playLog.warn('mpv not found; playback is disabled', { hint: 'set X_MUSIC_MPV' })
  else playLog.info('using mpv', { path: mpvPath })

  const player = new Player(
    db,
    mpvPath
      ? new MpvEngine({ binary: mpvPath, onLog: (line) => playLog.debug(`mpv: ${line}`) })
      : new NullEngine(),
    { replayGain: 'track', afterWrite: () => record_history(db) }
  )

  player.subscribe((event, payload) => {
    if (event === 'status') emit('player_status', payload as XMusicEvents['player_status'])
    else if (event === 'position') emit('player_position', payload as XMusicEvents['player_position'])
  })

  const handlers: Implementation<XMusicApi> = {
    get_app_info: () => ({
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      platform: process.platform
    }),

    get_library_stats: () => library_stats(db, options.path),

    list_tracks: (filter, sort, limit, offset) => query_tracks(db, { filter, sort, limit, offset }),

    list_track_groups: (filter, field) => group_tracks(db, { filter, field }),

    get_default_gmbrc_path: () => defaultGmbrcPath(homedir(), process.platform),

    // Reads and parses without writing anything, so the user can see what an import would do.
    get_gmbrc_preview: (path) => {
      if (!existsSync(path)) {
        return { path, exists: false, songs: 0, savedFilters: 0, savedLists: 0,
                 playHistoryEntries: 0, unmappedColumns: [] }
      }
      try {
        const data = parseGmbrc(readFileSync(path, 'utf8'))
        return {
          path,
          exists: true,
          version: data.version,
          baseFolder: data.baseFolder,
          songs: data.songs.length,
          savedFilters: data.savedFilters.length,
          savedLists: data.savedLists.length,
          playHistoryEntries: data.songs.reduce((n, s) => n + s.playHistory.length, 0),
          unmappedColumns: data.unmappedColumns
        }
      } catch (err) {
        return { path, exists: true, songs: 0, savedFilters: 0, savedLists: 0,
                 playHistoryEntries: 0, unmappedColumns: [], error: (err as Error).message }
      }
    },

    import_gmbrc: (path, statistics, labels, playlists) => {
      const data = parseGmbrc(readFileSync(path, 'utf8'))
      return importGmbrc(db, data, { statistics, labels, playlists })
    },

    list_folders: () => list_roots(db),

    add_folder: (path) => add_root(db, path),

    remove_folder: (id) => {
      remove_root(db, id)
      return { removed: true }
    },

    cancel_scan: () => {
      if (scanning) scanning.aborted = true
      return { cancelled: scanning !== null }
    },

    scan_folders: async () => {
      if (scanning) throw new Error('a scan is already running')

      const roots = enabled_root_paths(db)
      if (roots.length === 0) throw new Error('no music folders configured')

      scanning = { aborted: false }

      // One IPC message per file would flood the bridge; flush in batches instead.
      let pending: FileResult[] = []
      const flush = (): void => {
        if (pending.length === 0) return
        emit('scan_files', pending)
        pending = []
      }

      try {
        const report = await scanRoots(db, roots, {
          signal: scanning,
          onProgress: (p) => emit('scan_progress', p),
          onFile: (r) => {
            pending.push(r)
            if (pending.length >= 40) flush()
          }
        })
        flush()
        mark_roots_scanned(db, Date.now())
        emit('scan_done', report)
        return report
      } finally {
        scanning = null
      }
    },

    get_track: (track_id) => trackDetails(db, track_id),

    get_player_status: () => player.status(),

    play_track: (track_id, context, index) => {
      if (context) player.setContext(context, index ?? -1)
      void player.playTrack(track_id, index ?? -1)
      return player.status()
    },

    toggle_playback: () => { void player.toggle(); return player.status() },
    play_next: () => { void player.next(true); return player.status() },
    play_previous: () => { void player.previous(); return player.status() },
    stop_playback: () => { void player.stop(); return player.status() },
    seek: (ms) => { void player.seek(ms); return player.status() },
    set_volume: (v) => { void player.setVolume(v); return player.status() },

    queue_tracks: (track_ids, position) => {
      player.enqueue(track_ids, position ?? 'end')
      return player.status()
    },

    remove_from_queue: (index) => { player.dequeue(index); return player.status() },
    clear_queue: () => { player.clearQueue(); return player.status() },
    set_repeat: (mode) => { player.setRepeat(mode); return player.status() },
    set_shuffle: (on) => { player.setShuffle(on); return player.status() },

    get_merge_preview: (track_ids) => mergePreview(db, track_ids),

    merge_tracks: (track_ids, survivor_id, resolutions) => mergeTracks(db, { ids: track_ids, survivor: survivor_id, resolutions }),

    undo_merge: (batch_id) => unmerge(db, batch_id),

    list_duplicates: (reasons, length_tolerance_ms, limit) => findDuplicates(db, { reasons, lengthToleranceMs: length_tolerance_ms, limit }),

    // Clearing replaces the whole library, so a backup is taken first and the clear is refused if it fails.
    clear_library: async () => {
      await clearLibraryBackedUp(db, options.backups)
      return { cleared: true }
    }
  }

  const history: Implementation<XMusicHistoryApi> = {
    ...track_history_methods(() => db),
    get_history_keep_days: () => get_history_keep_days(db),
    set_history_keep_days: (days) => set_history_keep_days(db, days),
    list_recent_merges: (limit) => list_recent_merges(db, limit)
  }

  const page: Implementation<XMusicPageApi> = {
    pick_folder: () => {
      const picked = dialog.showOpenDialogSync({ title: 'Choose a music folder', properties: ['openDirectory', 'createDirectory'] })
      return picked?.[0] ?? null
    },

    pick_gmbrc_file: () => {
      const picked = dialog.showOpenDialogSync({
        title: 'Select a gmusicbrowser configuration file',
        defaultPath: defaultGmbrcPath(homedir(), process.platform),
        properties: ['openFile'],
        filters: [{ name: 'gmusicbrowser config', extensions: ['*'] }]
      })
      return picked?.[0] ?? null
    },

    show_in_folder: (uri) => {
      shell.showItemInFolder(uri)
      return { revealed: true }
    },

    get_cover_url: async (track_id, size) => {
      const art_options = { cacheDir: artCacheDir(), resize: resizeImage }
      const art = await resolveArtwork(db, track_id, art_options)
      const path = size ? thumbnail(art_options, art, size) : art.path
      return { url: path ? `x-music-art://local${encodeURI(path)}` : null, source: art.source }
    },

    write_log: (record) => {
      logFromRenderer(record.level, record.scope, record.message, record.data)
      return { logged: true }
    },

    get_log_config: () => ({ spec: process.env.X_MUSIC_LOG })
  }

  const recorded = recording(db, handlers)
  const recorded_history = recording(db, history)
  const guard = { trusted: options.trusted, envelopes: true }
  x_music_bridge.handle(ipcMain, recorded, guard)
  x_music_history_bridge.handle(ipcMain, recorded_history, guard)
  x_music_page_bridge.handle(ipcMain, page, guard)
  return { api: { ...recorded, ...recorded_history }, stopPlayer: () => player.dispose() }
}
