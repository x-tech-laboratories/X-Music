// The window: the player and its lists in the sidebar, the library browser beside them, after gmusicbrowser's "Lists, Library & Context".

import { useEffect, useState } from 'react'
import { Badge } from '@x-tech-laboratories/x-libs/web/react/badges'
import { Tabs } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Shell } from '@x-tech-laboratories/x-libs/web/react/shell'
import { use_shortcuts } from '@x-tech-laboratories/x-libs/web/react/shortcuts'
import { Split } from '@x-tech-laboratories/x-libs/web/react/split'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { one_of } from '@x-tech-laboratories/x-libs/web/prefs'
import { format_duration } from '@x-tech-laboratories/x-libs/durations'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { AppInfo, SafetyStatus } from '@shared/ipc'
import { ipc } from './lib/ipc'
import { configureLogging, log } from './lib/log'
import { theme } from './lib/theme'
import { library } from './stores/library'
import { player } from './stores/player'
import { PlayerBlock } from './widgets/PlayerBlock'
import { TabbedLists } from './widgets/TabbedLists'
import { FilterPane } from './widgets/FilterPane'
import { SongList } from './widgets/SongList'
import { SettingsPage, type Section, type Density } from './widgets/settings/SettingsPage'

// ============================================================================
// Shortcuts
// ============================================================================

const SEEK_STEP_IN_MILLISECONDS = 10_000

const seek_by = (step: number): void => {
  const duration = player.status?.durationMs ?? null
  if (duration === null) return
  void player.seek(Math.min(duration, Math.max(0, player.positionMs + step)))
}

const focus_search = (): void => {
  document.querySelector<HTMLInputElement>('input[type="search"][aria-label="Search the library"]')?.focus()
}

// ============================================================================
// App
// ============================================================================

export function App() {
  const [info, set_info] = useState<AppInfo | null>(null)
  const [safety, set_safety] = useState<SafetyStatus | null>(null)
  const [density, set_density] = use_pref<Density>('x-music.pref.density', 'normal', one_of('compact', 'normal', 'comfortable'))
  const [right_tab, set_right_tab] = useState<'library' | 'context'>('library')
  const [settings_section, set_settings_section] = useState<Section | null>(null)
  use_watch(library.data)

  useEffect(() => {
    // Renderer failures are invisible from the terminal otherwise, so they go to the main log.
    const on_error = (event: ErrorEvent): void => log.error(event.message, { source: event.filename, line: event.lineno })
    const on_rejection = (event: PromiseRejectionEvent): void => log.error('unhandled rejection', { reason: String(event.reason) })
    window.addEventListener('error', on_error)
    window.addEventListener('unhandledrejection', on_rejection)

    const stop_player = player.init()
    void boot()

    return () => {
      window.removeEventListener('error', on_error)
      window.removeEventListener('unhandledrejection', on_rejection)
      stop_player()
    }
  }, [])

  async function boot(): Promise<void> {
    configureLogging((await ipc('app:logConfig')).spec)
    log.debug('renderer booting')
    set_info(await ipc('app:info'))
    set_safety(await ipc('app:safety'))
    await library.refresh()

    // Open settings on the Import tab when there is nothing to look at yet.
    if ((library.stats?.tracks ?? 0) === 0) set_settings_section('import')
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
  }, [density])

  use_shortcuts([
    { keys: 'ctrl+space', run: () => void player.toggle() },
    { keys: 'alt+arrowright', run: () => void player.next() },
    { keys: 'alt+arrowleft', run: () => void player.previous() },
    { keys: 'shift+arrowright', run: () => seek_by(SEEK_STEP_IN_MILLISECONDS) },
    { keys: 'shift+arrowleft', run: () => seek_by(-SEEK_STEP_IN_MILLISECONDS) },
    { keys: 'mod+f', run: focus_search },
    { keys: '/', run: focus_search }
  ])

  const tools = (
    <>
      <span className="topbar-spacer" />
      {safety && (
        <Badge tone={safety.pinned ? 'info' : safety.readOnly ? 'good' : 'warn'} title={safety.reason}>
          {safety.readOnly ? 'Read-only' : 'Writes enabled'}
        </Badge>
      )}
      <button onClick={() => set_settings_section('library')}>Settings</button>
    </>
  )

  const player_column = (
    <div className="player-column">
      <Split
        storage_key="x-music.split.vbleft"
        axis="vertical"
        specs={[{ min: 150, max: 320 }, { min: 120, grow: true }]}
        preferred={[196, undefined]}
        panes={[<PlayerBlock key="player" />, <TabbedLists key="lists" />]}
      />
    </div>
  )

  const panes_row = (
    <Split
      storage_key="x-music.split.hpfp"
      specs={[{ min: 90 }, { min: 90 }, { min: 90, grow: true }]}
      panes={[
        <FilterPane key="fp0" id="fp0" field="genre" />,
        <FilterPane key="fp1" id="fp1" field="album_artist" />,
        <FilterPane key="fp2" id="fp2" field="album" />
      ]}
    />
  )

  const stats = library.stats

  const status_bar = (
    <>
      {library.error ? (
        <span className="tone-bad">{library.error}</span>
      ) : stats && (
        <>
          <span>{plural(stats.tracks, 'track')}</span>
          <span>{plural(stats.media, 'file')}</span>
          <span>{plural(stats.albums, 'album')}</span>
          {stats.missing > 0 && <span className="tone-warn">{stats.missing.toLocaleString()} missing</span>}
          <span>{format_duration(stats.totalMs / 1000, { largest_unit: 'days' })}</span>
        </>
      )}
      <span className="statusbar-spacer" />
      {info && <span className="muted">Electron {info.electron} · Chromium {info.chrome}</span>}
    </>
  )

  return (
    <Shell
      brand="X-Music"
      sidebar={player_column}
      sidebar_width={{ default_width: 420, min: 280, max: 720, storage_key: 'x-music.sidebar-width' }}
      theme={theme}
      user=""
      tools={tools}
      status_bar={status_bar}
    >
      <div className="library-view">
        <Tabs
          label="Views"
          items={[{ id: 'library', label: 'Library' }, { id: 'context', label: 'Context' }]}
          active={right_tab}
          on_select={set_right_tab}
        />

        {right_tab === 'library' ? (
          <Split
            storage_key="x-music.split.vpright"
            axis="vertical"
            specs={[{ min: 90, max: 480 }, { min: 160, grow: true }]}
            preferred={[190, undefined]}
            panes={[panes_row, <SongList key="songs" />]}
          />
        ) : (
          <div className="empty">
            <p>Context panel — lyrics, artist info and related tracks land in a later milestone.</p>
          </div>
        )}

      </div>

      {settings_section !== null && (
        <SettingsPage
          info={info}
          safety={safety}
          density={density}
          initialSection={settings_section}
          onclose={() => set_settings_section(null)}
          onDensity={set_density}
        />
      )}
    </Shell>
  )
}
