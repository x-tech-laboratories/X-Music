import { app, BrowserWindow, ipcMain, nativeTheme, protocol, screen, shell, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { create_window } from '@x-tech-laboratories/x-libs/electron/window'
import { take_staged_restore } from '@x-tech-laboratories/x-libs/server/sqlite_backups'

import { x_music_backups_bridge } from '@shared/ipc'
import { libraryBackups } from './backups'
import { openLibrary, libraryPath } from './db'
import { registerIpc } from './ipc'
import { assertWritable, initSafety, safetyStatus } from './safety'
import { describeLogging, log } from './log'
import { artCacheDir } from './artcache'

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  return create_window(BrowserWindow, {
    title: 'X-Music',
    icon: join(__dirname, '../../resources/icon.png'),
    // electron-vite emits an ESM preload as .mjs; loading .js here silently yields no bridge.
    preload: join(__dirname, '../preload/index.mjs'),
    file: join(__dirname, '../renderer/index.html'),
    dev_url: isDev ? process.env.ELECTRON_RENDERER_URL : undefined,
    default_size: { width: 1400, height: 900 },
    min_size: { width: 900, height: 560 },
    state_file: join(app.getPath('userData'), 'window.json'),
    // The window's size and place are X-Music's own data, so the write guard lets them through.
    before_write: (path) => assertWritable('window-state', path),
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

// Cached covers cannot be served over file:// under the renderer's CSP, so they get their own
// scheme. Registered before ready, as Electron requires.
protocol.registerSchemesAsPrivileged([{
  scheme: 'x-music-art',
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false }
}])

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

app.whenReady().then(() => {
  // X-Music's own directories are the only paths it may ever write to (see safety.ts).
  initSafety([app.getPath('userData'), join(app.getPath('temp'), 'x-music')])

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
  if (take_staged_restore(libraryPath())) log.info('restored a backup', { path: libraryPath() })
  const db = openLibrary()
  const safety = safetyStatus()
  log.info(safety.reason)
  log.info('library opened', { path: libraryPath() })
  const { stopPlayer } = registerIpc(db)
  // A restore staged in Settings is taken in by starting again, once its reply has gone back to the page.
  const backups = libraryBackups(db, libraryPath(), () => setImmediate(() => {
    app.relaunch()
    app.quit()
  }))
  x_music_backups_bridge.handle(ipcMain, backups.methods)

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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
