import { ipcMain, app, dialog, shell, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import type { Implementation, IpcMainEventLike } from '@x-tech-laboratories/x-libs/electron/bridge'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { BUILTIN_FIELDS } from '@shared/fields'
import { defaultGmbrcPath, parseGmbrc } from '@shared/import/gmbrc'
import { importGmbrc } from '@shared/import/gmb-import'
import {
  x_music_bridge, x_music_events, x_music_history_bridge,
  type XMusicApi, type XMusicEvents, type XMusicHistoryApi, type EventName, type FileResult
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
import { compileFilter } from '@shared/query/compile'
import { artCacheDir, resizeImage } from './artcache'
import { clearLibraryBackedUp, type LibraryBackups } from './backups'
import { forgetMisses, resolveArtwork, thumbnail } from './library/artwork'
import { scanRoots } from './library/scan'
import { logFromRenderer, logger } from './log'
import { Player } from './play/player'
import { MpvEngine, findMpv } from './play/mpv'
import { NullEngine } from './play/engine'

type Handlers = Implementation<XMusicApi>

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

// Returns what stops the player, whose mpv is a process of its own that would otherwise outlive X-Music.
export async function registerIpc(db: SqlDatabase, options: IpcOptions): Promise<{ stopPlayer: () => Promise<void> }> {
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
    if (event === 'status') emit('player:status', payload as XMusicEvents['player:status'])
    else if (event === 'position') emit('player:position', payload as XMusicEvents['player:position'])
  })

  const handlers: Handlers = {
    'app:info': () => ({
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      platform: process.platform
    }),

    'library:stats': () => library_stats(db, options.path),

    'library:query': (req) => query_tracks(db, req),

    'library:groupBy': (req) => group_tracks(db, req),

    'library:explain': (req) =>
      compileFilter(req.filter, { sort: req.sort, limit: req.limit }),

    'fields:list': () => [...BUILTIN_FIELDS],

    'theme:list': () => ['halon-light', 'halon-dark'],

    'import:gmbDefaultPath': () => defaultGmbrcPath(homedir(), process.platform),

    'import:gmbBrowse': () => {
      const result = dialog.showOpenDialogSync({
        title: 'Select a gmusicbrowser configuration file',
        defaultPath: defaultGmbrcPath(homedir(), process.platform),
        properties: ['openFile'],
        filters: [{ name: 'gmusicbrowser config', extensions: ['*'] }]
      })
      return result?.[0] ?? null
    },

    // Reads and parses without writing anything, so the user can see what an import would do.
    'import:gmbPreview': (path) => {
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

    'import:gmbRun': (req) => {
      const data = parseGmbrc(readFileSync(req.path, 'utf8'))
      return importGmbrc(db, data, {
        statistics: req.statistics,
        labels: req.labels,
        playlists: req.playlists
      })
    },

    'library:roots': () => list_roots(db),

    'library:addRoot': () => {
      const picked = dialog.showOpenDialogSync({
        title: 'Choose a music folder',
        properties: ['openDirectory', 'createDirectory']
      })
      const path = picked?.[0]
      return path ? add_root(db, path) : null
    },

    'library:removeRoot': (id) => {
      remove_root(db, id)
      return { removed: true }
    },

    'library:scanCancel': () => {
      if (scanning) scanning.aborted = true
      return { cancelled: scanning !== null }
    },

    'library:scan': async () => {
      if (scanning) throw new Error('a scan is already running')

      const roots = enabled_root_paths(db)
      if (roots.length === 0) throw new Error('no music folders configured')

      scanning = { aborted: false }

      // One IPC message per file would flood the bridge; flush in batches instead.
      let pending: FileResult[] = []
      const flush = (): void => {
        if (pending.length === 0) return
        emit('scan:files', pending)
        pending = []
      }

      try {
        const report = await scanRoots(db, roots, {
          signal: scanning,
          onProgress: (p) => emit('scan:progress', p),
          onFile: (r) => {
            pending.push(r)
            if (pending.length >= 40) flush()
          }
        })
        flush()
        mark_roots_scanned(db, Date.now())
        emit('scan:done', report)
        return report
      } finally {
        scanning = null
      }
    },

    'app:log': (record) => {
      logFromRenderer(record.level, record.scope, record.message, record.data)
      return { logged: true }
    },

    'app:logConfig': () => ({ spec: process.env.X_MUSIC_LOG }),

    'tracks:details': (trackId) => trackDetails(db, trackId),

    'art:forTrack': async (req) => {
      const art_options = { cacheDir: artCacheDir(), resize: resizeImage }
      const art = await resolveArtwork(db, req.trackId, art_options)
      const path = req.size ? thumbnail(art_options, art, req.size) : art.path

      return {
        url: path ? `x-music-art://local${encodeURI(path)}` : null,
        source: art.source
      }
    },

    'art:rescan': () => ({ forgotten: forgetMisses(db) }),

    'tracks:reveal': (uri) => {
      shell.showItemInFolder(uri)
      return { revealed: true }
    },

    'player:status': () => player.status(),

    'player:playTrack': (req) => {
      if (req.context) player.setContext(req.context, req.index ?? -1)
      void player.playTrack(req.trackId, req.index ?? -1)
      return player.status()
    },

    'player:toggle': () => { void player.toggle(); return player.status() },
    'player:next': () => { void player.next(true); return player.status() },
    'player:previous': () => { void player.previous(); return player.status() },
    'player:stop': () => { void player.stop(); return player.status() },
    'player:seek': (ms) => { void player.seek(ms); return player.status() },
    'player:volume': (v) => { void player.setVolume(v); return player.status() },

    'player:enqueue': (req) => {
      player.enqueue(req.trackIds, req.position ?? 'end')
      return player.status()
    },

    'player:dequeue': (index) => { player.dequeue(index); return player.status() },
    'player:clearQueue': () => { player.clearQueue(); return player.status() },
    'player:repeat': (mode) => { player.setRepeat(mode); return player.status() },
    'player:shuffle': (on) => { player.setShuffle(on); return player.status() },

    'tracks:mergePreview': (ids) => mergePreview(db, ids),

    'tracks:merge': (req) => mergeTracks(db, req),

    'tracks:unmerge': (batchId) => unmerge(db, batchId),

    'tracks:duplicates': (opts) => findDuplicates(db, opts ?? {}),

    // Clearing replaces the whole library, so a backup is taken first and the clear is refused if it fails.
    'library:reset': async () => {
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

  const guard = { trusted: options.trusted, envelopes: true }
  x_music_bridge.handle(ipcMain, recording(db, handlers), guard)
  x_music_history_bridge.handle(ipcMain, recording(db, history), guard)
  return { stopPlayer: () => player.dispose() }
}
