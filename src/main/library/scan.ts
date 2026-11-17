// Filesystem scanner.
//
// Reads only: files are opened 'r' for tag parsing and hashing, and nothing here ever writes to the
// music tree. Identity resolution is delegated to identity.ts, so scanning a library that was
// already imported from gmusicbrowser attaches to the existing tracks instead of duplicating them.

import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { parseFile } from 'music-metadata'

import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { FileResult, ScanProgress, ScanReport } from '@shared/ipc'
import { regroup_albums, split_values } from '@shared/library/albums'
import { all_rows, first_row, run } from '@shared/library/database'
import { create_upserter, type MediaCandidate, type TrackCandidate } from '@shared/library/identity'
import { hash_audio, needs_rehash } from './audio_hash.ts'

export type { FileOutcome, FileResult, ScanProgress, ScanReport } from '@shared/ipc'

export const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.m4b', '.mp4', '.aac', '.wav', '.aiff',
  '.aif', '.wv', '.ape', '.mpc', '.wma', '.dsf', '.tta', '.spx'
])

export interface ScanOptions {
  /** Directory names skipped wholesale. */
  exclude_dirs?: readonly string[]
  /** Skip hashing; much faster, but move detection stops working. For slow network mounts. */
  slow?: boolean
  on_progress?: (p: ScanProgress) => void
  on_file?: (r: FileResult) => void
  signal?: { aborted: boolean }
}

const DEFAULT_EXCLUDES = ['.git', 'node_modules', '@eaDir', '.Trash-1000', 'lost+found']

/** Yields every audio file beneath `root`, depth first, skipping excluded directories. */
async function* walk(
  root: string,
  excludes: ReadonlySet<string>,
  on_dir?: (path: string) => void
): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return // An unreadable directory is skipped, not fatal.
  }

  on_dir?.(root)

  for (const entry of entries) {
    const full = join(root, entry.name)

    if (entry.isDirectory()) {
      if (excludes.has(entry.name)) continue
      yield* walk(full, excludes, on_dir)
    } else if (entry.isFile()) {
      if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) yield full
    }
  }
}

const first = (v: readonly string[] | undefined): string | null => v?.[0] ?? null

// Files are read a batch at a time and each batch is written in one transaction, since a transaction cannot wait on the disk.
const BATCH = 200

interface ReadFile {
  path: string
  track: TrackCandidate
  media: MediaCandidate
}

export async function scan_roots(
  db: SqlDatabase,
  roots: readonly string[],
  opts: ScanOptions = {}
): Promise<ScanReport> {
  const started = Date.now()
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(opts.exclude_dirs ?? [])])

  const report: ScanReport = {
    filesFound: 0, filesRead: 0, filesSkipped: 0, tracksCreated: 0, tracksMatched: 0,
    movesDetected: 0, markedMissing: 0, errors: [], durationMs: 0
  }

  // Collect first so the total is known and progress can be honest about how far along it is.
  const files: string[] = []
  for (const root of roots) {
    for await (const file of walk(root, excludes)) {
      files.push(file)
      if (files.length % 500 === 0) {
        opts.on_progress?.({ phase: 'walking', found: files.length, processed: 0 })
      }
      if (opts.signal?.aborted) break
    }
  }
  report.filesFound = files.length

  const upsert = create_upserter(db)
  const seen = new Set<string>()
  let batch: ReadFile[] = []
  let touched: string[] = []

  // Writes what the batch read; a file that fails to write is reported and the rest still land.
  const write = (): void => {
    if (batch.length === 0 && touched.length === 0) return
    const pending = batch
    const seen_again = touched
    batch = []
    touched = []
    in_transaction(db, () => {
      const now = Date.now()
      for (const id of seen_again) run(db, 'UPDATE media SET present = 1, last_seen = ? WHERE id = ?', now, id)
      for (const { path, track, media } of pending) {
        try {
          // Tags are not authoritative for X-Music's own statistics.
          const result = upsert(track, media, { statistics: false, metadata: true })
          seen.add(result.media_id)
          report.filesRead++
          const detail = `matched by ${result.matched_by === 'audio_hash' ? 'audio content' : result.matched_by}`
          if (result.created) {
            report.tracksCreated++
            opts.on_file?.({ path, outcome: 'new', trackId: result.track_id })
          } else if (result.moved) {
            report.movesDetected++
            report.tracksMatched++
            opts.on_file?.({ path, outcome: 'moved', trackId: result.track_id, detail })
          } else {
            report.tracksMatched++
            opts.on_file?.({ path, outcome: 'matched', trackId: result.track_id, detail })
          }
        } catch (err) {
          const message = (err as Error).message
          report.errors.push({ path, message })
          opts.on_file?.({ path, outcome: 'error', detail: message })
        }
      }
    })
  }

  for (let i = 0; i < files.length; i++) {
    if (opts.signal?.aborted) break
    const path = files[i]!

    if (i % 25 === 0) {
      opts.on_progress?.({
        phase: 'reading', found: files.length, processed: i, currentPath: path
      })
    }

    try {
      const info = await stat(path)
      const mtime = Math.floor(info.mtimeMs)

      // Unchanged files are the common case on a rescan; skip the expensive part entirely, unless the
      // stored hash is missing or weaker than what hashing now produces.
      const hit = first_row<{ id: string; algo: string | null }>(db,
        'SELECT id, audio_hash_algo AS algo FROM media WHERE uri = ? AND subtrack_index = 0 AND mtime = ? AND filesize = ?',
        path, mtime, info.size)
      if (hit && (opts.slow || !needs_rehash(path, hit.algo))) {
        touched.push(hit.id)
        seen.add(hit.id)
        report.filesSkipped++
        opts.on_file?.({ path, outcome: 'unchanged' })
        continue
      }

      const meta = await parseFile(path, { duration: true, skipCovers: true })
      const c = meta.common
      const f = meta.format

      const track: TrackCandidate = {
        title: c.title ?? null,
        album: c.album ?? null,
        artist: first(split_values(c.artists ?? c.artist)) ?? c.artist ?? null,
        album_artist: c.albumartist ?? null,
        year: c.year ?? null,
        track_number: c.track?.no ?? null,
        disc_number: c.disk?.no ?? null,
        length_ms: f.duration !== undefined ? Math.round(f.duration * 1000) : null,
        compilation: c.compilation ?? false,
        bpm: typeof c.bpm === 'number' ? Math.round(c.bpm) : null,
        mb_recording_id: c.musicbrainz_recordingid ?? null,
        mb_release_id: c.musicbrainz_albumid ?? null,
        acoustid: c.acoustid_id ?? null,
        comment: c.comment?.map((x) => (typeof x === 'string' ? x : x.text)).join(' ') || null,
        sets: {
          artist: split_values(c.artists ?? c.artist),
          album_artist: c.albumartist ? [c.albumartist] : [],
          genre: split_values(c.genre),
          grouping: split_values(c.grouping)
        }
      }

      const media: MediaCandidate = {
        uri: path,
        codec: (f.codec ?? extname(path).slice(1)).toLowerCase(),
        bitrate: f.bitrate !== undefined ? Math.round(f.bitrate / 1000) : null,
        samplerate: f.sampleRate ?? null,
        channels: f.numberOfChannels ?? null,
        bits_per_sample: f.bitsPerSample ?? null,
        filesize: info.size,
        mtime,
        present: true
      }

      if (!opts.slow) {
        try {
          const h = await hash_audio(path)
          media.audio_hash = h.hash
          media.audio_hash_algo = h.algo
        } catch {
          // A file that cannot be hashed still gets indexed; it just loses move detection.
        }
      }

      batch.push({ path, track, media })
    } catch (err) {
      const message = (err as Error).message
      report.errors.push({ path, message })
      opts.on_file?.({ path, outcome: 'error', detail: message })
    } finally {
      if (batch.length + touched.length >= BATCH) write()
    }
  }

  write()

  // Anything under a scanned root that was not seen is gone from disk. The media is flagged, never
  // deleted, so its track keeps its rating and history (DESIGN-SPEC §3.4).
  opts.on_progress?.({ phase: 'finishing', found: files.length, processed: files.length })

  if (!opts.signal?.aborted && roots.length > 0) {
    in_transaction(db, () => {
      const candidates = all_rows<{ id: string; uri: string }>(db, `SELECT id, uri FROM media WHERE kind = 'file' AND present = 1`)
      for (const m of candidates) {
        const under_root = roots.some((r) => m.uri.startsWith(r.endsWith('/') ? r : `${r}/`))
        if (under_root && !seen.has(m.id)) {
          run(db, 'UPDATE media SET present = 0 WHERE id = ?', m.id)
          report.markedMissing++
          opts.on_file?.({ path: m.uri, outcome: 'missing', detail: 'no longer on disk' })
        }
      }
    })
  }

  in_transaction(db, () => regroup_albums(db))

  report.durationMs = Date.now() - started
  return report
}
