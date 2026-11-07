import { useEffect, useState } from 'react'
import { Tile, Tiles } from '@x-tech-laboratories/x-libs/web/react/layout'
import { ipc } from '../../lib/ipc'
import { cx } from '../../lib/cx'
import type { GmbPreview, ImportReport } from '@shared/ipc'
import { library } from '../../stores/library'
import s from './GmbImport.module.css'

export function GmbImport({ ondone }: { ondone?: () => void }) {
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<GmbPreview | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [statistics, setStatistics] = useState(true)
  const [labels, setLabels] = useState(true)
  const [playlists, setPlaylists] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const initial = await ipc('import:gmbDefaultPath')
        setPath(initial)
        await check(initial)
      } catch (err) {
        setError(`Could not reach the main process: ${(err as Error).message}`)
      }
    })()
  }, [])

  async function check(at: string): Promise<void> {
    if (!at) return
    try {
      setError(null)
      setPreview(await ipc('import:gmbPreview', at))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function browse(): Promise<void> {
    try {
      const picked = await ipc('import:gmbBrowse')
      if (picked) {
        setPath(picked)
        await check(picked)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function run(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setReport(await ipc('import:gmbRun', { path, statistics, labels, playlists }))
      await library.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function reset(): Promise<void> {
    setBusy(true)
    try {
      await ipc('library:reset')
      setReport(null)
      await library.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={s.import}>
      <header className={s.header}>
        <h3 className={s.heading}>gmusicbrowser</h3>
        <p className={s.lead}>
          Imports ratings, play counts, full play history, genres, groupings, labels and saved lists.
          Your music files are only ever read.
        </p>
      </header>

      <div className={s.row}>
        <label className={s.label} htmlFor="gmbrc">Configuration file</label>
        <input id="gmbrc" value={path} spellCheck={false}
               onChange={(e) => setPath(e.currentTarget.value)}
               onBlur={(e) => void check(e.currentTarget.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') void check(e.currentTarget.value) }} />
        <button onClick={browse}>Browse…</button>
      </div>

      {preview && !preview.exists ? (
        <p className={cx(s.note, s.warn)}>No file at that path. gmusicbrowser keeps it at{' '}
          <code className={s.code}>~/.config/gmusicbrowser/gmbrc</code> by default.</p>
      ) : preview?.error ? (
        <p className={cx(s.note, s.err)}>Could not parse: {preview.error}</p>
      ) : preview && (
        <>
          <Tiles>
            <Tile label="songs" value={preview.songs.toLocaleString()} value_first />
            <Tile label="play events" value={preview.playHistoryEntries.toLocaleString()} value_first />
            <Tile label="saved lists" value={preview.savedLists} value_first />
            <Tile label="saved filters" value={preview.savedFilters} value_first />
          </Tiles>
          {preview.baseFolder && (
            <p className={s.note}>Music root: <code className={s.code}>{preview.baseFolder}</code>{preview.version && <> · gmbrc {preview.version}</>}</p>
          )}
          {preview.unmappedColumns.length > 0 && (
            <p className={cx(s.note, s.warn)}>Unrecognised columns will be ignored: {preview.unmappedColumns.join(', ')}</p>
          )}

          <div className={s.opts}>
            <label className={s.label}>
              <input type="checkbox" checked={statistics}
                     onChange={(e) => setStatistics((e.currentTarget as HTMLInputElement).checked)} /> Ratings, play counts and history
            </label>
            <label className={s.label}>
              <input type="checkbox" checked={labels}
                     onChange={(e) => setLabels((e.currentTarget as HTMLInputElement).checked)} /> Genres, groupings and labels
            </label>
            <label className={s.label}>
              <input type="checkbox" checked={playlists}
                     onChange={(e) => setPlaylists((e.currentTarget as HTMLInputElement).checked)} /> Saved lists as playlists
            </label>
          </div>

          <div className={s.actions}>
            <button className="accent solid" disabled={busy || preview.songs === 0} onClick={run}>
              {busy ? 'Importing…' : `Import ${preview.songs.toLocaleString()} songs`}
            </button>
            <button className="danger" disabled={busy} onClick={reset}>Clear library</button>
            <span className={s.readonly}>Reads only — your music files are never modified.</span>
          </div>
        </>
      )}

      {error && <p className={cx(s.note, s.err)}>{error}</p>}

      {report && (
        <div className={s.report}>
          <p>
            Imported <strong>{report.tracksCreated.toLocaleString()}</strong> tracks and{' '}
            <strong>{report.mediaCreated.toLocaleString()}</strong> files,
            with <strong>{report.playHistoryRows.toLocaleString()}</strong> play events and{' '}
            <strong>{report.playlistsCreated}</strong> playlists.
          </p>
          {report.notes.map((note) => (
            <p key={note} className={s.note}>{note}</p>
          ))}

          <button className="accent solid" onClick={ondone}>Show my library →</button>
        </div>
      )}
    </section>
  )
}
