// The window: the views and the player with its lists in the sidebar, the current view beside them, after gmusicbrowser's "Lists, Library & Context".

import { Fragment, useEffect, useState } from 'react'
import { Shell, use_route } from '@x-tech-laboratories/x-libs/web/react/shell'
import { use_shortcuts } from '@x-tech-laboratories/x-libs/web/react/shortcuts'
import { Split } from '@x-tech-laboratories/x-libs/web/react/split'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { one_of } from '@x-tech-laboratories/x-libs/web/prefs'
import { format_duration } from '@x-tech-laboratories/x-libs/durations'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { AppInfo } from '@shared/ipc'
import app_icon from '../../resources/icon.svg'
import { ipc, page_ipc } from './lib/ipc'
import { configureLogging, log } from './lib/log'
import { theme } from './lib/theme'
import { library } from './stores/library'
import { player } from './stores/player'
import { PlayerBlock } from './widgets/PlayerBlock'
import { focus_search } from './widgets/SongList'
import { TabbedLists } from './widgets/TabbedLists'
import { DuplicatesView } from './views/DuplicatesView'
import { FoldersView } from './views/FoldersView'
import { ImportView } from './views/ImportView'
import { LibraryView } from './views/LibraryView'
import { Navigation, view_href, view_labels, view_of, type ViewId } from './views/Navigation'
import { SettingsView, type Density } from './views/SettingsView'

// ============================================================================
// Shortcuts
// ============================================================================

const SEEK_STEP_IN_MILLISECONDS = 10_000

const seek_by = (step: number): void => {
  const duration = player.status?.durationMs ?? null
  if (duration === null) return
  void player.seek(Math.min(duration, Math.max(0, player.positionMs + step)))
}

// ============================================================================
// Status bar
// ============================================================================

function StatusBar() {
  use_watch(library.data)
  const stats = library.stats
  if (library.error) return <span className="tone-bad">{library.error}</span>
  if (!stats) return null
  return (
    <>
      <span>{plural(stats.tracks, 'track')}</span>
      <span>{plural(stats.media, 'file')}</span>
      <span>{plural(stats.albums, 'album')}</span>
      {stats.missing > 0 && <span className="tone-warn">{stats.missing.toLocaleString()} missing</span>}
      <span>{format_duration(stats.totalMs / 1000, { largest_unit: 'days' })}</span>
    </>
  )
}

// ============================================================================
// App
// ============================================================================

export function App() {
  const [info, set_info] = useState<AppInfo | null>(null)
  const [density, set_density] = use_pref<Density>('x-music.pref.density', 'normal', one_of('compact', 'normal', 'comfortable'))
  const route = use_route()
  const view = view_of(route.parts)

  useEffect(() => {
    // Renderer failures are invisible from the terminal otherwise, so they go to the main log.
    const on_error = (event: ErrorEvent): void => log.error(event.message, { source: event.filename, line: event.lineno })
    const on_rejection = (event: PromiseRejectionEvent): void => log.error('unhandled rejection', { reason: String(event.reason) })
    window.addEventListener('error', on_error)
    window.addEventListener('unhandledrejection', on_rejection)

    const stop_player = player.init()
    // A change an AI client made through the MCP server shows as if made here.
    const stop_changes = window.xMusicEvents.on('changed', () => void library.refresh())
    void boot()

    return () => {
      window.removeEventListener('error', on_error)
      window.removeEventListener('unhandledrejection', on_rejection)
      stop_player()
      stop_changes()
    }
  }, [])

  async function boot(): Promise<void> {
    configureLogging((await page_ipc('get_log_config')).spec)
    log.debug('renderer booting')
    set_info(await ipc('get_app_info'))
    await library.refresh()
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
  }, [density])

  useEffect(() => {
    document.title = `${view_labels[view]} · X-Music`
  }, [view])

  use_shortcuts([
    { keys: 'ctrl+space', run: () => void player.toggle() },
    { keys: 'alt+arrowright', run: () => void player.next() },
    { keys: 'alt+arrowleft', run: () => void player.previous() },
    { keys: 'shift+arrowright', run: () => seek_by(SEEK_STEP_IN_MILLISECONDS) },
    { keys: 'shift+arrowleft', run: () => seek_by(-SEEK_STEP_IN_MILLISECONDS) },
    { keys: 'mod+f', run: focus_search },
    { keys: '/', run: focus_search }
  ])

  const sidebar = (
    <>
      <Navigation current={view} />
      <div className="player-column">
        <Split
          storage_key="x-music.split.vbleft"
          axis="vertical"
          specs={[{ min: 150, max: 320 }, { min: 120, grow: true }]}
          preferred={[196, undefined]}
          panes={[<PlayerBlock key="player" />, <TabbedLists key="lists" />]}
        />
      </div>
    </>
  )

  return (
    <Shell
      brand="X-Music"
      brand_icon={app_icon}
      brand_href={view_href('library')}
      sidebar={sidebar}
      sidebar_width={{ default_width: 420, min: 280, max: 720, storage_key: 'x-music.sidebar-width' }}
      theme={theme}
      settings={{ href: view_href('settings'), active: view === 'settings' }}
      status_bar={<StatusBar />}
      main_class={view === 'library' ? 'library-main' : undefined}
      view_key={view}
      contained
    >
      <Fragment key={view}>{view_content(view, { info, density, on_density: set_density })}</Fragment>
    </Shell>
  )
}

function view_content(view: ViewId, settings: { info: AppInfo | null; density: Density; on_density: (density: Density) => void }) {
  switch (view) {
    case 'library': return <LibraryView />
    case 'folders': return <FoldersView />
    case 'import': return <ImportView />
    case 'duplicates': return <DuplicatesView />
    case 'settings': return <SettingsView {...settings} />
  }
}
