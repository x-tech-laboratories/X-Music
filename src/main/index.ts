import { app, BrowserWindow, ipcMain, nativeTheme, protocol, screen, shell, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { bring_to_front, hold_single_instance } from '@x-tech-laboratories/x-libs/electron/app'
import { create_local_mcp } from '@x-tech-laboratories/x-libs/electron/mcp'
import { create_window } from '@x-tech-laboratories/x-libs/electron/window'
import { take_staged_restore } from '@x-tech-laboratories/x-libs/server/sqlite_backups'

import { is_read_only, mcp_instructions, x_music_api } from '@shared/api'
import { history_channels, x_music_backups_bridge, x_music_bridge, x_music_events, x_music_history_bridge, x_music_mcp_bridge } from '@shared/ipc'
import { describe_upgrade } from '@shared/library/legacy'
import { library_backups, open_library_backed_up } from './backups.ts'
import { open_database, library_path } from './db/index.ts'
import { register_ipc, type ApiImplementation } from './ipc.ts'
import { trusted_sender } from './sender.ts'
import { describe_logging, log } from './log.ts'
import { art_cache_dir } from './artcache.ts'

const is_dev = !app.isPackaged

const page = {
  dev_url: is_dev ? process.env.ELECTRON_RENDERER_URL : undefined,
  file: join(__dirname, '../renderer/index.html')
}

function create_main_window(): BrowserWindow {
  return create_window(BrowserWindow, {
    ...page,
    title: 'X-Music',
    icon: join(__dirname, '../../resources/icon.png'),
    // electron-vite emits an ESM preload as .mjs; loading .js here silently yields no bridge.
    preload: join(__dirname, '../preload/index.mjs'),
    default_size: { width: 1400, height: 900 },
    min_size: { width: 900, height: 560 },
    state_file: join(app.getPath('userData'), 'window.json'),
    native_theme: nativeTheme,
    shell,
    screen,
    // Halon's root surface, shown before the page paints.
    background: { light: '#f1f5f9', dark: '#060b14' },
    // A player must keep ticking when its window is hidden, so Chromium may not throttle its timers.
    background_throttling: false,
    title_bar_style: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  })
}

const trusted = trusted_sender(page)

function show_existing_window(): void {
  const [window] = BrowserWindow.getAllWindows()
  if (window) bring_to_front(window)
}

// Cached covers cannot be served over file:// under the renderer's CSP, so they get their own scheme. Registered before ready, as Electron requires.
protocol.registerSchemesAsPrivileged([{
  scheme: 'x-music-art',
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false }
}])

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// The MCP server for AI clients on this computer: off until turned on in Settings, and then on 127.0.0.1 only.
function local_mcp_for(api: ApiImplementation) {
  return create_local_mcp({
    name: 'x-music',
    version: app.getVersion(),
    instructions: mcp_instructions,
    api: x_music_api,
    is_read_only,
    settings_file: join(app.getPath('userData'), 'mcp.json'),
    default_port: 3919,
    // A change made through MCP reaches the open window as if made there.
    call: async (method, args) => {
      const bridge = (history_channels as readonly string[]).includes(method) ? x_music_history_bridge : x_music_bridge
      const result = await bridge.dispatch(api, method, args)
      if (!is_read_only(method)) x_music_events.emit(BrowserWindow.getAllWindows(), 'changed', null)
      return result
    }
  })
}

async function start(): Promise<void> {
  log.info('starting', { logging: describe_logging(), version: app.getVersion() })

  // The url carries the cache path; only files inside the cache directory are served.
  protocol.handle('x-music-art', (request) => {
    const url = new URL(request.url)
    const file = decodeURIComponent(url.pathname)
    const root = art_cache_dir()

    if (!file.startsWith(root)) {
      log.warn('refused art outside the cache', { file })
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })

  // A backup restored in Settings waits beside the database until now, when nothing has it open.
  const path = library_path()
  if (take_staged_restore(path)) log.info('restored a backup', { path })
  const db = open_database(path)

  // A restore staged in Settings is taken in by starting again, once its reply has gone back to the page.
  const backups = library_backups(() => db, path, () => setImmediate(() => {
    app.relaunch()
    app.quit()
  }))

  // A schema upgrade changes years of ratings and plays, so the library as it was is kept first.
  const { backup, report } = await open_library_backed_up(db, backups)
  if (backup) log.info('backed up the library before upgrading it', { backup: backup.name })
  for (const line of report ? describe_upgrade(report) : []) log.warn(line)
  log.info('library opened', { path })
  backups.start()

  const { api, stop_player } = await register_ipc(db, { path, backups, trusted })
  x_music_backups_bridge.handle(ipcMain, backups.methods, { trusted, envelopes: true })
  const local_mcp = local_mcp_for(api)
  x_music_mcp_bridge.handle(ipcMain, local_mcp.methods, { trusted, envelopes: true })
  void local_mcp.start()

  create_main_window()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) create_main_window()
  })

  // Quitting waits for mpv to stop, or for two seconds if it does not answer, then quits for real.
  let stopped = false
  app.on('before-quit', (event) => {
    if (stopped) return
    event.preventDefault()
    stopped = true
    backups.stop()
    void Promise.race([Promise.all([stop_player(), local_mcp.stop()]), new Promise((resolve) => setTimeout(resolve, 2000))]).finally(() => {
      db.close()
      app.quit()
    })
  })
}

// One copy runs at a time, since two would share one database and two mpv's; a second launch brings the first forward.
if (hold_single_instance(app, show_existing_window)) {
  app.whenReady().then(start).catch((error: unknown) => {
    log.error('could not start', { error: String(error) })
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
