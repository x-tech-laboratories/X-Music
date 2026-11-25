import { ipcMain, app, dialog, shell, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import type { Implementation, IpcMainEventLike } from '@x-tech-laboratories/x-libs/electron/bridge'
import { find_mpv, MpvEngine, NullEngine } from '@x-tech-laboratories/x-libs/mpv'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { default_gmbrc_path, parse_gmbrc } from '@shared/import/gmbrc'
import { import_gmbrc } from '@shared/import/gmb_import'
import {
  x_music_bridge, x_music_events, x_music_history_bridge, x_music_page_bridge,
  type XMusicApi, type XMusicEvents, type XMusicHistoryApi, type XMusicPageApi, type EventName, type FileResult
} from '@shared/ipc'
import { track_details } from '@shared/library/details'
import { find_duplicates } from '@shared/library/duplicates'
import {
  get_history_keep_days, record_history, set_history_keep_days, track_history_methods
} from '@shared/library/history'
import { list_recent_merges, merge_preview, merge_tracks, unmerge } from '@shared/library/merge'
import { set_rating } from '@shared/library/ratings'
import {
  add_root, enabled_root_paths, group_tracks, library_stats, list_roots, mark_roots_scanned,
  query_tracks, remove_root
} from '@shared/library/store'
import { art_cache_dir, resize_image } from './artcache.ts'
import { clear_library_backed_up, type LibraryBackups } from './backups.ts'
import { resolve_artwork, thumbnail } from './library/artwork.ts'
import { scan_roots } from './library/scan.ts'
import { logger } from './log.ts'
import { Player } from './play/player.ts'

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
export async function register_ipc(db: SqlDatabase, options: IpcOptions): Promise<{ api: ApiImplementation; stop_player: () => Promise<void> }> {
  // A scan runs at most once at a time; the flag is what cancel flips.
  let scanning: { aborted: boolean } | null = null

  // Without mpv the app still runs and the library still works; only audio is unavailable, and the player reports that plainly rather than failing at the first click.
  const play_log = logger('play')
  const mpv_path = await find_mpv(process.env.X_MUSIC_MPV)
  if (!mpv_path) play_log.warn('mpv not found; playback is disabled', { hint: 'set X_MUSIC_MPV' })
  else play_log.info('using mpv', { path: mpv_path })

  const player = new Player(
    db,
    mpv_path
      ? new MpvEngine({ binary: mpv_path, socket_name: 'x-music-mpv', on_log: (line) => play_log.debug(`mpv: ${line}`) })
      : new NullEngine(),
    { replay_gain: 'track', after_write: () => record_history(db) }
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

    get_default_gmbrc_path: () => default_gmbrc_path(homedir(), process.platform),

    // Reads and parses without writing anything, so the user can see what an import would do.
    get_gmbrc_preview: (path) => {
      if (!existsSync(path)) {
        return { path, exists: false, songs: 0, saved_filters: 0, saved_lists: 0,
                 play_history_entries: 0, unmapped_columns: [] }
      }
      try {
        const data = parse_gmbrc(readFileSync(path, 'utf8'))
        return {
          path,
          exists: true,
          version: data.version,
          base_folder: data.base_folder,
          songs: data.songs.length,
          saved_filters: data.saved_filters.length,
          saved_lists: data.saved_lists.length,
          play_history_entries: data.songs.reduce((n, s) => n + s.play_history.length, 0),
          unmapped_columns: data.unmapped_columns
        }
      } catch (err) {
        return { path, exists: true, songs: 0, saved_filters: 0, saved_lists: 0,
                 play_history_entries: 0, unmapped_columns: [], error: (err as Error).message }
      }
    },

    import_gmbrc: (path, statistics, labels, playlists) => {
      const data = parse_gmbrc(readFileSync(path, 'utf8'))
      return import_gmbrc(db, data, { statistics, labels, playlists })
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
        const report = await scan_roots(db, roots, {
          signal: scanning,
          on_progress: (p) => emit('scan_progress', p),
          on_file: (r) => {
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

    get_track: (track_id) => track_details(db, track_id),

    set_rating: (track_ids, rating) => {
      const result = set_rating(db, track_ids, rating)
      player.reload_track(track_ids)
      return result
    },

    get_player_status: () => player.status(),

    play_track: (track_id, context, index) => {
      if (context) player.set_context(context, index ?? -1)
      void player.play_track(track_id, index ?? -1)
      return player.status()
    },

    toggle_playback: () => { void player.toggle(); return player.status() },
    play_next: () => { void player.next(true); return player.status() },
    play_previous: () => { void player.previous(); return player.status() },
    stop_playback: () => { void player.stop(); return player.status() },
    seek: (ms) => { void player.seek(ms); return player.status() },
    set_volume: (v) => { void player.set_volume(v); return player.status() },

    queue_tracks: (track_ids, position) => {
      player.enqueue(track_ids, position ?? 'end')
      return player.status()
    },

    remove_from_queue: (index) => { player.dequeue(index); return player.status() },
    move_in_queue: (index, to_index) => { player.move_in_queue(index, to_index); return player.status() },
    clear_queue: () => { player.clear_queue(); return player.status() },
    set_repeat: (mode) => { player.set_repeat(mode); return player.status() },
    set_shuffle: (on) => { player.set_shuffle(on); return player.status() },

    get_merge_preview: (track_ids) => merge_preview(db, track_ids),

    merge_tracks: (track_ids, survivor_id, resolutions) => merge_tracks(db, { ids: track_ids, survivor: survivor_id, resolutions }),

    undo_merge: (batch_id) => unmerge(db, batch_id),

    list_duplicates: (reasons, length_tolerance_ms, limit) => find_duplicates(db, { reasons, length_tolerance_ms, limit }),

    // Clearing replaces the whole library, so a backup is taken first and the clear is refused if it fails.
    clear_library: async () => {
      await clear_library_backed_up(db, options.backups)
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
        defaultPath: default_gmbrc_path(homedir(), process.platform),
        properties: ['openFile'],
        filters: [{ name: 'gmusicbrowser config', extensions: ['*'] }]
      })
      return picked?.[0] ?? null
    },

    show_in_folder: (uri) => {
      shell.showItemInFolder(uri)
      return { revealed: true }
    },

    cache_cover: async (track_id, size) => {
      const art_options = { cache_dir: art_cache_dir(), resize: resize_image }
      const art = await resolve_artwork(db, track_id, art_options)
      const path = size ? thumbnail(art_options, art, size) : art.path
      return { url: path ? `x-music-art://local${encodeURI(path)}` : null, source: art.source }
    }
  }

  const recorded = recording(db, handlers)
  const recorded_history = recording(db, history)
  const guard = { trusted: options.trusted, envelopes: true }
  x_music_bridge.handle(ipcMain, recorded, guard)
  x_music_history_bridge.handle(ipcMain, recorded_history, guard)
  x_music_page_bridge.handle(ipcMain, page, guard)
  return { api: { ...recorded, ...recorded_history }, stop_player: () => player.dispose() }
}
