// The music folders the library is read from, a scan of them, and what the scan did to each file.

import { useEffect, useState } from 'react'
import type { Tone } from '@x-tech-laboratories/x-libs/web/react/badges'
import { Section, Tile, Tiles } from '@x-tech-laboratories/x-libs/web/react/layout'
import { OutcomeLog } from '@x-tech-laboratories/x-libs/web/react/outcome_log'
import { ProgressBar } from '@x-tech-laboratories/x-libs/web/react/progress'
import { Empty, Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { Age } from '@x-tech-laboratories/x-libs/web/react/time'
import { format_duration } from '@x-tech-laboratories/x-libs/durations'
import { describe_error } from '@x-tech-laboratories/x-libs/web/errors'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { FileOutcome, FileResult, Root, ScanProgress, ScanReport } from '@shared/ipc'
import { ipc, page_ipc } from '../lib/ipc.ts'
import { library } from '../stores/library.ts'
import { view_href } from '../views/Navigation.tsx'

// ============================================================================
// Outcomes
// ============================================================================

const OUTCOMES: Record<FileOutcome, [text: string, tone: Tone]> = {
  new: ['New', 'good'],
  matched: ['Matched', 'none'],
  moved: ['Moved', 'info'],
  unchanged: ['Unchanged', 'none'],
  missing: ['Missing', 'warn'],
  error: ['Failed', 'bad']
}

function progress_detail(progress: ScanProgress): string {
  if (progress.phase === 'walking') return `Finding files… ${plural(progress.found, 'file')} so far`
  if (progress.phase === 'finishing') return 'Checking for files that disappeared…'
  return `${progress.processed.toLocaleString()} of ${plural(progress.found, 'file')}`
}

// ============================================================================
// Folders
// ============================================================================

function folder_columns(scanning: boolean, remove: (root: Root) => void): TableColumn<Root>[] {
  return [
    { label: 'Folder', cell: (root) => <span className="path">{root.path}</span> },
    { label: 'Last scanned', cell: (root) => <Age epoch={root.lastScan === null ? null : root.lastScan / 1000} missing="Never" /> },
    {
      label: 'Actions',
      id: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      class: 'actions-cell',
      cell: (root) => (
        <div className="row-actions">
          <button type="button" aria-label={`Remove ${root.path}`} disabled={scanning} onClick={() => remove(root)}>Remove</button>
        </div>
      )
    }
  ]
}

// ============================================================================
// Summary
// ============================================================================

function took(duration_in_milliseconds: number): string {
  return duration_in_milliseconds < 1000 ? 'Under a second' : format_duration(duration_in_milliseconds / 1000)
}

function ScanSummary({ report, on_show_failed }: { report: ScanReport; on_show_failed: () => void }) {
  const failed = report.errors.length
  const notes = [
    report.movesDetected > 0 && `${plural(report.movesDetected, 'moved or renamed file')} recognised by the audio, keeping ratings and play history.`,
    report.markedMissing > 0 && `${plural(report.markedMissing, 'file')} no longer on disk, marked missing; their tracks and statistics are kept.`,
    failed > 0 && `${plural(failed, 'file')} could not be read.`
  ].filter(Boolean)
  return (
    <>
      <Tiles>
        <Tile label="Files read" value={report.filesFound.toLocaleString()} value_first />
        <Tile label="New tracks" value={report.tracksCreated.toLocaleString()} value_first />
        <Tile label="Already known" value={report.tracksMatched.toLocaleString()} value_first />
        <Tile label="Unchanged" value={report.filesSkipped.toLocaleString()} value_first />
        <Tile label="Took" value={took(report.durationMs)} value_first />
      </Tiles>
      {notes.length > 0 && (
        <p className={failed > 0 || report.markedMissing > 0 ? 'tone-warn' : 'muted'}>
          {notes.join(' ')}
          {failed > 0 && <> <button type="button" onClick={on_show_failed}>{failed === 1 ? 'Show the failed file' : 'Show the failed files'}</button></>}
        </p>
      )}
    </>
  )
}

// A file's path within the music folder it is in, which is shorter to read than the whole path.
function within_folder(path: string, roots: Root[]): string {
  const root = roots.find((each) => path.startsWith(`${each.path}/`))
  return root ? path.slice(root.path.length + 1) : path
}

// ============================================================================
// Panel
// ============================================================================

export function ScanPanel() {
  const roots = use_resource(() => ipc('list_folders'), [])
  const [progress, set_progress] = useState<ScanProgress | null>(null)
  const [report, set_report] = useState<ScanReport | null>(null)
  const [error, set_error] = useState<string | null>(null)
  const [scanning, set_scanning] = useState(false)
  const [results, set_results] = useState<FileResult[]>([])
  const [filter, set_filter] = useState<FileOutcome | null>(null)

  useEffect(() => {
    const off_progress = window.xMusicEvents.on('scan_progress', set_progress)
    const off_files = window.xMusicEvents.on('scan_files', (batch) => set_results((shown) => [...shown, ...batch]))
    const off_done = window.xMusicEvents.on('scan_done', (done) => {
      set_report(done)
      set_progress(null)
      set_scanning(false)
      void roots.reload(true)
      void library.refresh()
    })
    return () => { off_progress(); off_files(); off_done() }
  }, [])

  async function add(): Promise<void> {
    try {
      set_error(null)
      const path = await page_ipc('pick_folder')
      if (path === null) return
      await ipc('add_folder', path)
      await roots.reload(true)
    } catch (failure) {
      set_error(describe_error(failure))
    }
  }

  async function remove(root: Root): Promise<void> {
    try {
      set_error(null)
      await ipc('remove_folder', root.id)
      await roots.reload(true)
    } catch (failure) {
      set_error(describe_error(failure))
    }
  }

  async function scan(): Promise<void> {
    set_error(null)
    set_report(null)
    set_results([])
    set_filter(null)
    set_scanning(true)
    try {
      await ipc('scan_folders')
    } catch (failure) {
      set_error(describe_error(failure))
      set_scanning(false)
      set_progress(null)
    }
  }

  const has_folders = (roots.data?.length ?? 0) > 0
  const tools = (
    <>
      <button type="button" onClick={() => void add()} disabled={scanning}>Add folder…</button>
      {scanning
        ? <button type="button" onClick={() => void ipc('cancel_scan')}>Cancel</button>
        : <button type="button" className="accent solid" onClick={() => void scan()} disabled={!has_folders}>Scan now</button>}
    </>
  )

  return (
    <>
      <Section title="Music folders" tools={tools}>
        <Loaded resource={roots} lines={2}>{(list) => list.length > 0 ? (
          <DataTable caption="Music folders" columns={folder_columns(scanning, (root) => void remove(root))} rows={list} row_key={(root) => String(root.id)} column_hiding={false} />
        ) : (
          <Empty title="No music folders yet." hint={<>Add a folder to read its music, or bring in a gmusicbrowser library under <a href={view_href('import')}>Import</a>.</>} />
        )}</Loaded>
        {error && <p className="tone-bad" role="alert">{error}</p>}
        {progress && (
          <ProgressBar label="Scan progress" value={progress.phase === 'reading' ? progress.processed : null} max={progress.found} detail={progress_detail(progress)} />
        )}
      </Section>

      {(scanning || report || results.length > 0) && (
        <Section title={scanning ? 'Scanning' : 'Last scan'}>
          {report && <ScanSummary report={report} on_show_failed={() => set_filter('error')} />}
          <OutcomeLog
            label="Scanned files"
            entries={results}
            outcome_of={(result) => result.outcome}
            outcomes={OUTCOMES}
            item_of={(result) => within_folder(result.path, roots.data ?? [])}
            detail_of={(result) => result.detail}
            active={scanning}
            filter={filter}
            on_filter_change={set_filter}
            labels={{ item: 'File', empty: scanning ? 'Looking for music files…' : 'No files were read.' }}
          />
        </Section>
      )}
    </>
  )
}
