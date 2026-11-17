// Settings: how the app looks, the library database, its backups and the MCP server, and the version.

import { useEffect, useState } from 'react'
import { BackupSettings } from '@x-tech-laboratories/x-libs/web/react/backup_settings'
import { confirm_dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { Segmented } from '@x-tech-laboratories/x-libs/web/react/controls'
import { LocalMcpSettings } from '@x-tech-laboratories/x-libs/web/react/local_mcp_settings'
import { Facts, PageHeading, SettingRow, SettingsPage, type SettingsCategory } from '@x-tech-laboratories/x-libs/web/react/layout'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { format_duration } from '@x-tech-laboratories/x-libs/durations'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { Theme } from '@x-tech-laboratories/x-libs/web/theme'
import type { AppInfo } from '@shared/ipc'
import { ipc } from '../lib/ipc'
import { theme } from '../lib/theme'
import { library } from '../stores/library'

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
    format_duration(stats.totalMs / 1000, { largest_unit: 'days' }),
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
