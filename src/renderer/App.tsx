import { useEffect, useState } from 'react'
import type { AppInfo, SafetyStatus } from '@shared/ipc'
import { oneOf } from '@shared/prefs'
import { ipc } from './lib/ipc'
import { configureLogging, log } from './lib/log'
import { cx } from './lib/cx'
import { use_pref } from './lib/prefs'
import { use_watch } from './lib/watch'
import { Split } from './lib/Split'
import { library } from './stores/library'
import { player } from './stores/player'
import { PlayerBlock } from './widgets/PlayerBlock'
import { TabbedLists } from './widgets/TabbedLists'
import { FilterPane } from './widgets/FilterPane'
import { SongList } from './widgets/SongList'
import { SettingsPage, type Section } from './widgets/settings/SettingsPage'
import s from './App.module.css'

type Theme = 'light' | 'dark' | 'system'
type Density = 'compact' | 'normal' | 'comfortable'

const duration = (ms: number): string => {
  const h = Math.floor(ms / 3_600_000)
  const d = Math.floor(h / 24)
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`
}

/*
  Structure follows gmusicbrowser's default layout, "Lists, Library & Context":

    VBmain = HBmenu _HPmain Progress
     HPmain = VBLeft _TBRight
      VBLeft  = VBplayer _TabbedLists(PlayList, QueueList, song info, pictures)
      TBRight = "Library" VPRight | "Context"
       VPRight = HPfp0(genre | artist | album) _VBSongList
        VBSongList = HBSongList(search, filter actions) _SongList
*/
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [safety, setSafety] = useState<SafetyStatus | null>(null)
  const [theme, set_theme] = use_pref<Theme>('theme', 'system', oneOf('light', 'dark', 'system'))
  const [density, set_density] = use_pref<Density>('density', 'normal', oneOf('compact', 'normal', 'comfortable'))
  use_watch(library.data)
  const [rightTab, setRightTab] = useState<'library' | 'context'>('library')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<Section>('library')

  useEffect(() => {
    // Renderer failures are invisible from the terminal otherwise, which turns UI bugs into
    // guesswork. Forwarding them to the main log is cheap and always on.
    const onError = (e: ErrorEvent): void =>
      log.error(e.message, { source: e.filename, line: e.lineno })
    const onRejection = (e: PromiseRejectionEvent): void =>
      log.error('unhandled rejection', { reason: String(e.reason) })
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    const stopPlayer = player.init()
    void boot()

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      stopPlayer()
    }
  }, [])

  async function boot(): Promise<void> {
    configureLogging((await ipc('app:logConfig')).spec)
    log.debug('renderer booting')
    setInfo(await ipc('app:info'))
    setSafety(await ipc('app:safety'))
    await library.refresh()

    // Open settings on the Import tab when there is nothing to look at yet.
    if ((library.stats?.tracks ?? 0) === 0) {
      setSettingsSection('import')
      setShowSettings(true)
    }
  }

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
  }, [density])

  const cycleTheme = (): void => {
    set_theme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')
  }

  const leftPane = (
    <div className={s.vbleft}>
      <Split
        id="vbleft"
        dir="vertical"
        specs={[{ min: 150, max: 320 }, { min: 120, grow: true }]}
        preferred={[196, undefined]}
        panes={[<PlayerBlock />, <TabbedLists />]}
      />
    </div>
  )

  const panesRow = (
    <Split
      id="hpfp"
      dir="horizontal"
      specs={[{ min: 90 }, { min: 90 }, { min: 90, grow: true }]}
      panes={[
        <FilterPane id="fp0" field="genre" />,
        <FilterPane id="fp1" field="album_artist" />,
        <FilterPane id="fp2" field="album" />
      ]}
    />
  )

  const rightPane = (
    <div className={s.tbright}>
      <div className={s.tabs}>
        <button className={cx(s.tab, rightTab === 'library' && s.active)} onClick={() => setRightTab('library')}>
          Library
        </button>
        <button className={cx(s.tab, rightTab === 'context' && s.active)} onClick={() => setRightTab('context')}>
          Context
        </button>
      </div>

      {rightTab === 'library' ? (
        <Split
          id="vpright"
          dir="vertical"
          specs={[{ min: 90, max: 480 }, { min: 160, grow: true }]}
          preferred={[190, undefined]}
          panes={[panesRow, <SongList />]}
        />
      ) : (
        <div className={s.context}>
          <p>Context panel — lyrics, artist info and related tracks land in a later milestone.</p>
        </div>
      )}
    </div>
  )

  const stats = library.stats

  return (
    <div className={s.vbmain}>
      {showSettings && (
        <SettingsPage
          info={info}
          safety={safety}
          theme={theme}
          density={density}
          initialSection={settingsSection}
          onclose={() => setShowSettings(false)}
          onTheme={set_theme}
          onDensity={set_density}
        />
      )}

      <div className={s.hbmenu}>
        <button className={s.menuItem}
                onClick={() => { setSettingsSection('library'); setShowSettings(true) }}>Settings</button>
        <span className={s.spacer}></span>

        {safety && (
          <span className={cx(s.safety, safety.pinned && s.pinned)} title={safety.reason}>
            {safety.readOnly ? '🔒 Read-only' : '⚠ Writes enabled'}
          </span>
        )}

        <button className={s.menuItem} onClick={cycleTheme} title={`Theme: ${theme}`}>
          {theme === 'dark' ? '◐' : theme === 'light' ? '◑' : '◒'}
        </button>
      </div>

      {/* Every boundary below is draggable; sizes persist per split id. */}
      <Split
        id="hpmain"
        dir="horizontal"
        specs={[{ min: 280, max: 720 }, { min: 420, grow: true }]}
        preferred={[420, undefined]}
        panes={[leftPane, rightPane]}
      />

      <footer className={s.status}>
        {library.error ? (
          <span className={s.err}>{library.error}</span>
        ) : stats && (
          <>
            <span>{stats.tracks.toLocaleString()} tracks</span>
            <span className={s.sep}>·</span>
            <span>{stats.media.toLocaleString()} files</span>
            <span className={s.sep}>·</span>
            <span>{stats.albums.toLocaleString()} albums</span>
            {stats.missing > 0 && (
              <>
                <span className={s.sep}>·</span>
                <span className={s.warn}>{stats.missing.toLocaleString()} missing</span>
              </>
            )}
            <span className={s.sep}>·</span>
            <span>{duration(stats.totalMs)}</span>
          </>
        )}
        <span className={s.spacer}></span>
        {info && <span className={s.dim}>Electron {info.electron} · Chromium {info.chrome}</span>}
      </footer>
    </div>
  )
}
