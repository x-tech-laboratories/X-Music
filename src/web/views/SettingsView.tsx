// Settings: how the app looks, the library database, its backups and the MCP server, and the version.

import { useEffect, useState } from 'react'
import { BackupSettings } from '@x-tech-laboratories/x-libs/web/react/backup_settings'
import { confirm_dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { NumberField, Segmented } from '@x-tech-laboratories/x-libs/web/react/controls'
import { LocalMcpSettings } from '@x-tech-laboratories/x-libs/web/react/local_mcp_settings'
import { Facts, PageHeading, SettingRow, SettingsPage, type SettingsCategory } from '@x-tech-laboratories/x-libs/web/react/layout'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { describe_error } from '@x-tech-laboratories/x-libs/web/errors'
import { clean_error_message } from '@x-tech-laboratories/x-libs/electron/bridge'
import { format_duration } from '@x-tech-laboratories/x-libs/durations'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { Theme } from '@x-tech-laboratories/x-libs/web/theme'
import type { AppInfo } from '@shared/ipc'
import { ipc } from '../lib/ipc.ts'
import { theme } from '../lib/theme.ts'
import { library } from '../stores/library.ts'

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
    ...(stats.missing > 0 ? [`${stats.missing.toLocaleString()} missing`] : [])
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

// How long track versions are kept, read once and saved on each change.
function HistoryKeeping() {
  const [days, set_days] = useState<number | null>(null)
  useEffect(() => void window.xMusicHistory.get_history_keep_days().then(set_days, () => undefined), [])

  async function change(next: number | null): Promise<void> {
    if (next === null || next < 1) return
    const before = days
    set_days(next)
    try {
      await window.xMusicHistory.set_history_keep_days(next)
    } catch (error) {
      set_days(before)
      toast(`Could not change how long changes are kept: ${clean_error_message(describe_error(error))}`, { tone: 'bad' })
    }
  }

  return (
    <SettingRow label="Keep changes for" hint="Older changes are pruned; each track always keeps its latest.">
      <NumberField label="Keep changes for" bare unit="days" min={1} value={days} on_change={(next) => void change(next)} />
    </SettingRow>
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
