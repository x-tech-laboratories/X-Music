// Bringing in a gmusicbrowser library: its configuration file previewed, what to bring in, and what came in.

import { useEffect, useState } from 'react'
import { PathInput, Switch } from '@x-tech-laboratories/x-libs/web/react/controls'
import { Facts, FormRow, Section, SettingRow, Tile, Tiles } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { describe_error } from '@x-tech-laboratories/x-libs/web/errors'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { GmbPreview, ImportReport } from '@shared/ipc'
import { ipc, page_ipc } from '../lib/ipc.ts'
import { library } from '../stores/library.ts'
import { view_href } from '../views/Navigation.tsx'

// A typed path is read once typing pauses this long.
const CHECK_DELAY_IN_MILLISECONDS = 400

// ============================================================================
// Options
// ============================================================================

interface Options {
  statistics: boolean
  labels: boolean
  playlists: boolean
}

const OPTION_ROWS: { id: keyof Options; label: string; hint: string }[] = [
  { id: 'statistics', label: 'Ratings, play counts and history', hint: 'Every play gmusicbrowser kept, with its date.' },
  { id: 'labels', label: 'Genres, groupings and labels', hint: 'As gmusicbrowser has them, not as the files are tagged.' },
  { id: 'playlists', label: 'Saved lists as playlists', hint: 'Each saved list becomes a playlist of the same name.' }
]

// ============================================================================
// Preview
// ============================================================================

function Preview({ found }: { found: GmbPreview }) {
  return (
    <>
      <Tiles>
        <Tile label="Tracks" value={found.songs.toLocaleString()} value_first />
        <Tile label="Play events" value={found.playHistoryEntries.toLocaleString()} value_first />
        <Tile label="Saved lists" value={found.savedLists.toLocaleString()} value_first />
        <Tile label="Saved filters" value={found.savedFilters.toLocaleString()} value_first />
      </Tiles>
      <Facts layout="rows" rows={[
        found.baseFolder ? ['Music folder', <span className="path">{found.baseFolder}</span>] : null,
        found.version ? ['gmusicbrowser version', found.version] : null
      ]} />
      {found.unmappedColumns.length > 0 && (
        <p className="tone-warn">These columns are not known to X-Music and are left out: {found.unmappedColumns.join(', ')}.</p>
      )}
    </>
  )
}

function Imported({ report }: { report: ImportReport }) {
  return (
    <Section title="Imported">
      <p>
        Brought in {plural(report.tracksCreated, 'track')} and {plural(report.mediaCreated, 'file')}, with{' '}
        {plural(report.playHistoryRows, 'play event')} and {plural(report.playlistsCreated, 'playlist')}.
      </p>
      {report.notes.map((note) => <p key={note} className="muted">{note}</p>)}
      <div>
        <a className="button accent solid" href={view_href('library')}>Show the library</a>
      </div>
    </Section>
  )
}

// ============================================================================
// Import
// ============================================================================

export function GmbImport() {
  const [path, set_path] = useState('')
  // The path last read for the preview; the field may hold a newer one still being typed.
  const [checked, set_checked] = useState('')
  const preview = use_resource(() => ipc('get_gmbrc_preview', checked), [checked], { enabled: checked !== '' })
  const [options, set_options] = useState<Options>({ statistics: true, labels: true, playlists: true })
  const [report, set_report] = useState<ImportReport | null>(null)
  const [busy, set_busy] = useState(false)
  const [error, set_error] = useState<string | null>(null)

  useEffect(() => {
    ipc('get_default_gmbrc_path').then(set_path, (failure: unknown) => set_error(describe_error(failure)))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => set_checked(path.trim()), CHECK_DELAY_IN_MILLISECONDS)
    return () => clearTimeout(timer)
  }, [path])

  async function run(): Promise<void> {
    set_busy(true)
    set_error(null)
    try {
      const done = await ipc('import_gmbrc', checked, options.statistics, options.labels, options.playlists)
      set_report(done)
      toast(`Imported ${plural(done.tracksCreated, 'track')}`, { tone: 'good', link: { href: view_href('library'), text: 'Show the library' } })
      await library.refresh()
    } catch (failure) {
      set_error(describe_error(failure))
    } finally {
      set_busy(false)
    }
  }

  return (
    <>
      <Section title="gmusicbrowser">
        <div className="form-rows">
          <FormRow label="Configuration file" id="gmb-path" hint="gmusicbrowser keeps it at ~/.config/gmusicbrowser/gmbrc unless told otherwise.">
            <PathInput label="Configuration file" value={path} on_change={set_path} pick={() => page_ipc('pick_gmbrc_file')} />
          </FormRow>
        </div>

        <Loaded resource={preview} lines={3}>{(found) => !found.exists ? (
          <p className="tone-warn">No gmusicbrowser configuration at this path.</p>
        ) : found.error ? (
          <p className="tone-bad" role="alert">This file could not be read: {found.error}</p>
        ) : (
          <>
            <Preview found={found} />
            <div>
              {OPTION_ROWS.map((row) => (
                <SettingRow key={row.id} label={row.label} hint={row.hint} as_label>
                  <Switch label={row.label} checked={options[row.id]} disabled={busy} on_change={(on) => set_options((now) => ({ ...now, [row.id]: on }))} />
                </SettingRow>
              ))}
            </div>
            <div className="toolbar">
              <button type="button" className="accent solid" disabled={busy || found.songs === 0} onClick={() => void run()}>
                {busy ? 'Importing…' : `Import ${plural(found.songs, 'track')}`}
              </button>
            </div>
            <p className="muted">
              Your music files are only read. To start afresh rather than add to the library, clear it
              under <a href={view_href('settings')}>Settings</a> first.
            </p>
          </>
        )}</Loaded>

        {error && <p className="tone-bad" role="alert">{error}</p>}
      </Section>

      {report && <Imported report={report} />}
    </>
  )
}
