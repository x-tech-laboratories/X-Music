import { app, BrowserWindow, ipcMain, nativeTheme, protocol, screen, shell, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { bring_to_front, hold_single_instance } from '@x-tech-laboratories/x-libs/electron/app'
import { create_window } from '@x-tech-laboratories/x-libs/electron/window'
import { take_staged_restore } from '@x-tech-laboratories/x-libs/server/sqlite_backups'

import { x_music_backups_bridge } from '@shared/ipc'
import { libraryBackups, openLibraryBackedUp } from './backups'
import { openDatabase, libraryPath } from './db'
import { registerIpc } from './ipc'
import { trustedSender } from './sender'
import { describeLogging, log } from './log'
import { artCacheDir } from './artcache'

const isDev = !app.isPackaged

const page = {
  dev_url: isDev ? process.env.ELECTRON_RENDERER_URL : undefined,
  file: join(__dirname, '../renderer/index.html')
}

function createWindow(): BrowserWindow {
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

const trusted = trustedSender(page)

function showExistingWindow(): void {
  const [window] = BrowserWindow.getAllWindows()
  if (window) bring_to_front(window)
}

// Cached covers cannot be served over file:// under the renderer's CSP, so they get their own
// scheme. Registered before ready, as Electron requires.
protocol.registerSchemesAsPrivileged([{
  scheme: 'x-music-art',
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false }
}])

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

async function start(): Promise<void> {
  log.info('starting', { logging: describeLogging(), version: app.getVersion() })

  // The url carries the cache path; only files inside the cache directory are served.
  protocol.handle('x-music-art', (request) => {
    const url = new URL(request.url)
    const file = decodeURIComponent(url.pathname)
    const root = artCacheDir()

    if (!file.startsWith(root)) {
      log.warn('refused art outside the cache', { file })
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })

  // A backup restored in Settings waits beside the database until now, when nothing has it open.
  const path = libraryPath()
  if (take_staged_restore(path)) log.info('restored a backup', { path })
  const db = openDatabase(path)

  // A restore staged in Settings is taken in by starting again, once its reply has gone back to the page.
  const backups = libraryBackups(() => db, path, () => setImmediate(() => {
    app.relaunch()
    app.quit()
  }))

  // A schema upgrade changes years of ratings and plays, so the library as it was is kept first.
  const backup = await openLibraryBackedUp(db, backups)
  if (backup) log.info('backed up the library before upgrading it', { backup: backup.name })
  log.info('library opened', { path })
  backups.start()

  const { stopPlayer } = await registerIpc(db, { path, backups, trusted })
  x_music_backups_bridge.handle(ipcMain, backups.methods, { trusted, envelopes: true })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Quitting waits for mpv to stop, or for two seconds if it does not answer, then quits for real.
  let stopped = false
  app.on('before-quit', (event) => {
    if (stopped) return
    event.preventDefault()
    stopped = true
    backups.stop()
    void Promise.race([stopPlayer(), new Promise((resolve) => setTimeout(resolve, 2000))]).finally(() => {
      db.close()
      app.quit()
    })
  })
}

// One copy runs at a time, since two would share one database and two mpv's; a second launch brings the first forward.
if (hold_single_instance(app, showExistingWindow)) {
  app.whenReady().then(start).catch((error: unknown) => {
    log.error('could not start', { error: String(error) })
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
