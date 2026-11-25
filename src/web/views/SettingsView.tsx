// Settings: how the app looks, Picard, the library database, its backups and the MCP server, and the version.

import { useEffect, useRef, useState } from 'react'
import { BackupSettings } from '@x-tech-laboratories/x-libs/web/react/backup_settings'
import { confirm_dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { NumberField, PathInput, Segmented, Switch } from '@x-tech-laboratories/x-libs/web/react/controls'
import { LocalMcpSettings } from '@x-tech-laboratories/x-libs/web/react/local_mcp_settings'
import { Facts, PageHeading, SettingRow, SettingsPage, type SettingsCategory } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { describe_call_error } from '@x-tech-laboratories/x-libs/web/errors'
import { format_duration } from '@x-tech-laboratories/x-libs/durations'
import { format_count, plural } from '@x-tech-laboratories/x-libs/web/format'
import type { Theme } from '@x-tech-laboratories/x-libs/web/theme'
import type { AppInfo, PicardSettings, PicardSetup } from '@shared/ipc'
import { ipc, page_ipc } from '../lib/ipc.ts'
import { theme } from '../lib/theme.ts'
import { library } from '../stores/library.ts'
import { PICARD_WARNING } from '../widgets/picard.tsx'

export type Density = 'compact' | 'normal' | 'comfortable'

// ============================================================================
// Theme
// ============================================================================

// The theme as the sidebar's theme row and this page share it.
function use_theme(): Theme {
  const [current, set_current] = useState(theme.get)
  useEffect(() => theme.on_change(set_current), [])
  return current
}

// ============================================================================
// Library database
// ============================================================================

const CLEAR_LIBRARY_EFFECT = 'Removes every track, album, playlist, rating and play from the library. Your music folders stay listed, and your music files are not touched.'

function clear_library(): void {
  confirm_dialog({
    title: 'Clear the library database?',
    message: CLEAR_LIBRARY_EFFECT,
    confirm_label: 'Clear library',
    busy_label: 'Clearing…',
    danger: true,
    run: async () => {
      await ipc('clear_library')
      await library.refresh()
    }
  })
}

function LibraryDatabase() {
  use_watch(library.data)
  const stats = library.stats
  const contents = stats && [
    plural(stats.tracks, 'track'),
    plural(stats.media, 'file'),
    plural(stats.albums, 'album'),
    format_duration(stats.total_ms / 1000, { largest_unit: 'days' }),
    ...(stats.missing > 0 ? [`${format_count(stats.missing)} missing`] : [])
  ].join(' · ')

  return (
    <>
      <Facts layout="rows" rows={[
        ['Location', stats ? <code className="path">{stats.path}</code> : null],
        ['Contents', contents]
      ]} />
      <SettingRow label="Clear library" hint={CLEAR_LIBRARY_EFFECT}>
        <button className="danger" onClick={clear_library}>Clear library…</button>
      </SettingRow>
    </>
  )
}

// ============================================================================
// History
// ============================================================================

// How long track versions are kept, read once, saved on each change, and offered again on Retry when it could not be read.
function HistoryKeeping() {
  const loaded = use_resource(() => window.xMusicHistory.get_history_keep_days(), [])
  const [changed, set_changed] = useState<number | null>(null)
  const days = changed ?? loaded.data ?? null

  async function change(next: number | null): Promise<void> {
    if (next === null || next < 1) return
    const before = changed
    set_changed(next)
    try {
      await window.xMusicHistory.set_history_keep_days(next)
    } catch (error) {
      set_changed(before)
      toast(`Could not change how long changes are kept: ${describe_call_error(error)}`, { tone: 'bad' })
    }
  }

  return (
    <SettingRow label="Keep changes for" hint="Older changes are pruned; each track always keeps its latest.">
      <Loaded resource={loaded} lines={1}>
        {() => <NumberField label="Keep changes for" bare unit="days" min={1} value={days} on_change={(next) => void change(next)} />}
      </Loaded>
    </SettingRow>
  )
}

// ============================================================================
// Picard
// ============================================================================

// Where Picard is and whether its files are read again when it closes, each saved as it changes.
function PicardSettingsSection() {
  const loaded = use_resource(() => page_ipc('get_picard_setup'), [])
  const [changed, set_changed] = useState<PicardSetup | null>(null)
  const latest = useRef(0)
  const setup = changed ?? loaded.data ?? null

  // The path is saved on every key, so only the newest answer counts, and the field keeps what was typed.
  async function change(changes: Partial<PicardSettings>): Promise<void> {
    const request = ++latest.current
    if (setup) set_changed({ ...setup, ...changes })
    try {
      const saved = await page_ipc('set_picard_settings', changes)
      if (request === latest.current) set_changed((shown) => ({ ...saved, path: shown?.path ?? saved.path }))
    } catch (error) {
      if (request === latest.current) set_changed(null)
      toast(`Could not change the Picard settings: ${describe_call_error(error)}`, { tone: 'bad' })
    }
  }

  const found_hint = (current: PicardSetup): string => {
    if (current.found) return `Using ${current.found}.`
    return current.path ? 'There is no program at this path.' : 'Picard was not found on PATH; install it, or choose where it is.'
  }

  return (
    <Loaded resource={loaded} lines={2}>
      {() => setup && (
        <>
          <SettingRow label="Picard program" hint={`${found_hint(setup)} Leave empty to look for picard on PATH.`}>
            <PathInput
              label="Picard program"
              value={setup.path}
              placeholder={setup.path ? undefined : setup.found ?? 'picard on PATH'}
              on_change={(path) => void change({ path })}
              pick={() => page_ipc('pick_program', 'Choose the Picard program')}
            />
          </SettingRow>
          <SettingRow label="Read files again when Picard closes" hint="Picks up Picard's tags, and follows files it renamed or moved.">
            <Switch label="Read files again when Picard closes" checked={setup.rescan} on_change={(rescan) => void change({ rescan })} />
          </SettingRow>
        </>
      )}
    </Loaded>
  )
}

// ============================================================================
// Page
// ============================================================================

interface SettingsViewProps {
  info: AppInfo | null
  density: Density
  on_density: (density: Density) => void
}

export function SettingsView({ info, density, on_density }: SettingsViewProps) {
  const current_theme = use_theme()

  const categories: SettingsCategory[] = [
    {
      heading: 'General',
      sections: [
        {
          id: 'appearance',
          heading: 'Appearance',
          content: (
            <>
              <SettingRow label="Theme" hint="System follows the light or dark choice of your desktop.">
                <Segmented
                  label="Theme"
                  choices={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
                  value={current_theme}
                  on_change={(choice) => theme.set(choice)}
                />
              </SettingRow>
              <SettingRow label="Density" hint="How tall the rows of lists and tables are.">
                <Segmented
                  label="Density"
                  choices={[{ value: 'compact', label: 'Compact' }, { value: 'normal', label: 'Normal' }, { value: 'comfortable', label: 'Comfortable' }]}
                  value={density}
                  on_change={on_density}
                />
              </SettingRow>
            </>
          )
        }
      ]
    },
    {
      heading: 'Tagging',
      sections: [
        {
          id: 'picard',
          heading: 'MusicBrainz Picard',
          hint: PICARD_WARNING,
          content: <PicardSettingsSection />
        }
      ]
    },
    {
      heading: 'Data',
      sections: [
        { id: 'library', heading: 'Library database', content: <LibraryDatabase /> },
        {
          id: 'history',
          heading: 'History',
          hint: 'Every change to a track is kept, to look back on or restore under History. Plays and skips are counted, not kept as changes.',
          content: <HistoryKeeping />
        },
        {
          id: 'backups',
          heading: 'Backups',
          hint: 'Copies of the library database, kept beside it. Restoring one restarts X-Music. Your music files are never backed up or touched.',
          content: <BackupSettings device={window.xMusicBackups} data_name="tracks, playlists, ratings and play history" />
        },
        {
          id: 'mcp',
          heading: 'MCP server',
          hint: 'Let AI assistants such as Claude Code reach the library and the player.',
          content: <LocalMcpSettings device={window.xMusicMcp} name="x-music" data_name="read and change your music library and control the player" />
        }
      ]
    },
    {
      heading: 'About',
      sections: [
        {
          id: 'about',
          heading: 'X-Music',
          content: (
            <Facts layout="rows" rows={[
              ['Version', info?.version ?? null],
              ['Runtime', info ? `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}` : null]
            ]} />
          )
        }
      ]
    }
  ]

  return (
    <div className="page">
      <PageHeading class_name="inline" title="Settings" />
      <SettingsPage categories={categories} />
    </div>
  )
}
