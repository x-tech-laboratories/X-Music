// Tagging with MusicBrainz Picard: the tracks' files open in a Picard window of their own, and once it closes X-Music
// reads those folders again, so Picard's tags show and ratings and plays stay with the files by their audio.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { PicardClosed, PicardHandoff, PicardSetup, ScanReport } from '@shared/ipc'
import { get_picard_settings, handoff_files, rescan_targets, type Rescan } from '@shared/library/picard'

// ── Finding Picard ───────────────────────────────────────────────────────────

export interface PicardLauncher {
  // Gives the full path of a program on PATH, or null.
  on_path: (name: string) => Promise<string | null>
  // Says whether a file is there to run.
  exists: (path: string) => boolean
  // Runs a program and answers with its exit code once it ends.
  run: (argv: readonly string[]) => Promise<{ exit_code: number }>
}

// The Picard the settings name, or the one on PATH when they name none.
export async function find_picard(database: SqlDatabase, launcher: PicardLauncher): Promise<string | null> {
  const { path } = get_picard_settings(database)
  if (path) return launcher.exists(path) ? path : null
  return launcher.on_path('picard')
}

export async function picard_setup(database: SqlDatabase, launcher: PicardLauncher): Promise<PicardSetup> {
  return { ...get_picard_settings(database), found: await find_picard(database, launcher) }
}

// ── Handing off ──────────────────────────────────────────────────────────────

export interface PicardScans {
  // The music folders the library scans.
  music_folders: () => readonly string[]
  // Reads these folders and files again, waiting for a scan already running.
  scan: (targets: Rescan) => Promise<ScanReport>
  // Reads every music folder, for files Picard moved out of the folders above.
  scan_all: () => Promise<ScanReport>
}

export interface PicardRun extends PicardHandoff {
  // Settles once the window has closed and the rescan, if any, is done.
  closed: Promise<PicardClosed>
}

// Opens the files in a stand-alone Picard, so its window closing means the tagging is done.
export async function tag_with_picard(
  database: SqlDatabase, track_ids: readonly string[], launcher: PicardLauncher, scans: PicardScans
): Promise<PicardRun> {
  const { files, skipped } = handoff_files(database, track_ids)
  if (files.length === 0) throw new Error('none of these tracks has a whole file on disk to tag')
  const picard = await find_picard(database, launcher)
  if (!picard) throw new Error('Picard was not found; install it, or set where it is in Settings')
  const { rescan } = get_picard_settings(database)

  const closed = (async (): Promise<PicardClosed> => {
    try {
      const { exit_code } = await launcher.run([picard, '--stand-alone-instance', ...files])
      const error = exit_code === 0 ? undefined : `Picard ended with exit code ${exit_code}`
      if (!rescan) return { files: files.length, report: null, error }

      const music_folders = scans.music_folders()
      const report = await scans.scan(rescan_targets(files, music_folders))
      // A file gone from its folder was most likely moved by Picard, so the music folders are read for it.
      const moved = report.marked_missing > 0 && music_folders.length > 0
      return { files: files.length, report: moved ? await scans.scan_all() : report, error }
    } catch (error) {
      return { files: files.length, report: null, error: (error as Error).message }
    }
  })()

  return { files: files.length, skipped, picard, closed }
}
