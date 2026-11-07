// Settings as a full-window view: the library, its folders, imports, duplicates, appearance and versions.

import { useEffect, useState } from 'react'
import { confirm_dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { Segmented } from '@x-tech-laboratories/x-libs/web/react/controls'
import { Facts, SettingRow, SettingsGroup } from '@x-tech-laboratories/x-libs/web/react/layout'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { format_duration } from '@x-tech-laboratories/x-libs/durations'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { Theme } from '@x-tech-laboratories/x-libs/web/theme'
import type { AppInfo, SafetyStatus } from '@shared/ipc'
import { ipc } from '../../lib/ipc'
import { theme } from '../../lib/theme'
import { library } from '../../stores/library'
import { PageView } from '../PageView'
import { GmbImport } from './GmbImport'
import { ScanPanel } from './ScanPanel'
import { DuplicatesPanel } from './DuplicatesPanel'

const sections = [
  { id: 'library', label: 'Library' },
  { id: 'folders', label: 'Folders' },
  { id: 'import', label: 'Import' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About' }
] as const

export type Section = (typeof sections)[number]['id']
export type Density = 'compact' | 'normal' | 'comfortable'

// The theme as the Shell's button and this page share it.
function use_theme(): Theme {
  const [current, set_current] = useState(theme.get)
  useEffect(() => theme.on_change(set_current), [])
  return current
}

export function SettingsPage({
  info = null,
  safety = null,
  density = 'normal',
  initialSection = 'library',
  onclose,
  onDensity
}: {
  info?: AppInfo | null
  safety?: SafetyStatus | null
  density?: Density
  initialSection?: Section
  onclose: () => void
  onDensity?: (density: Density) => void
}) {
  use_watch(library.data)
  // The prop only chooses where to open; the tabs own the value from then on.
  const [section, set_section] = useState<Section>(initialSection)
  const current_theme = use_theme()

  function clear_library(): void {
    confirm_dialog({
      title: 'Clear the library database?',
      message: 'Removes every track, playlist and statistic. Files are untouched.',
      confirm_label: 'Clear library',
      busy_label: 'Clearing…',
      danger: true,
      run: async () => {
        await ipc('library:reset')
        await library.refresh()
      }
    })
  }

  const stats = library.stats

  let body
  if (section === 'library') {
    body = (
      <SettingsGroup heading="Library">
        <Facts layout="rows" rows={[
          ['Database', stats ? <code className="path">{stats.path}</code> : null],
          ['Contents', stats
            ? [plural(stats.tracks, 'track'), plural(stats.media, 'file'), plural(stats.albums, 'album'),
               format_duration(stats.totalMs / 1000, { largest_unit: 'days' }),
               ...(stats.missing > 0 ? [`${stats.missing} missing`] : [])].join(' · ')
            : null],
          ['File safety', safety ? (
            <>
              <strong className={safety.readOnly ? 'tone-good' : undefined}>{safety.readOnly ? 'Read-only' : 'Writes enabled'}</strong>
              <span className="setting-hint"> {safety.reason} </span>
              <span className="setting-hint">
                {safety.pinned
                  ? <>Pinned by the environment. Unset <code>X_MUSIC_FORCE_READ_ONLY</code> to change it.</>
                  : 'X-Music cannot write tags yet, so this is a guarantee rather than a preference.'}
              </span>
            </>
          ) : null]
        ]} />
        <SettingRow label="Danger zone" hint="Removes every track, playlist and statistic. Files are untouched.">
          <button className="danger" onClick={clear_library}>Clear library database</button>
        </SettingRow>
      </SettingsGroup>
    )
  } else if (section === 'folders') {
    body = <ScanPanel />
  } else if (section === 'import') {
    body = <GmbImport ondone={onclose} />
  } else if (section === 'duplicates') {
    body = <DuplicatesPanel />
  } else if (section === 'appearance') {
    body = (
      <SettingsGroup heading="Appearance" hint="Colours come from the Halon tokens; density sets the song list's row height.">
        <SettingRow label="Theme">
          <Segmented
            label="Theme"
            choices={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
            value={current_theme}
            on_change={(choice) => theme.set(choice)}
          />
        </SettingRow>
        <SettingRow label="Density">
          <Segmented
            label="Density"
            choices={[{ value: 'compact', label: 'Compact' }, { value: 'normal', label: 'Normal' }, { value: 'comfortable', label: 'Comfortable' }]}
            value={density}
            on_change={(choice) => onDensity?.(choice)}
          />
        </SettingRow>
      </SettingsGroup>
    )
  } else {
    body = (
      <SettingsGroup heading="About">
        <Facts layout="rows" rows={[
          ['X-Music', info?.version ?? null],
          ['Runtime', info ? `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}` : null],
          ['Last query', library.lastSql ? <pre className="output">{library.lastSql}</pre> : null]
        ]} />
      </SettingsGroup>
    )
  }

  return (
    <PageView title="Settings" onclose={onclose} sections={[...sections]} section={section} onSection={set_section}>
      {body}
    </PageView>
  )
}
