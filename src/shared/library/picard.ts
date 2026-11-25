// Handing tracks to MusicBrainz Picard: its settings, the files it gets, and the folders to read again once it closes.

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, asc, drizzle_of, eq, inArray, isNull } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { PicardSettings } from '../ipc.ts'
import { media, settings } from './schema.ts'

// ── Settings ─────────────────────────────────────────────────────────────────

const settings_key = 'picard'

// An empty path means Picard is looked for on PATH.
export const default_picard_settings: PicardSettings = { path: '', rescan: true }

export function get_picard_settings(database: SqlDatabase): PicardSettings {
  const row = drizzle_of(database).select({ value: settings.value }).from(settings).where(eq(settings.key, settings_key)).get()
  if (!row) return { ...default_picard_settings }
  const saved = JSON.parse(row.value) as Partial<PicardSettings>
  return {
    path: typeof saved.path === 'string' ? saved.path : default_picard_settings.path,
    rescan: typeof saved.rescan === 'boolean' ? saved.rescan : default_picard_settings.rescan
  }
}

export function set_picard_settings(database: SqlDatabase, changes: Partial<PicardSettings>): PicardSettings {
  const merged = { ...get_picard_settings(database), ...changes }
  const next = { ...merged, path: merged.path.trim() }
  const value = JSON.stringify(next)
  drizzle_of(database).insert(settings).values({ key: settings_key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
  return next
}

// ── Files ────────────────────────────────────────────────────────────────────

export interface HandoffFiles {
  files: string[]
  // Tracks left out: no file on disk, or a range inside a larger file, which Picard would retag whole.
  skipped: number
}

// The files on disk that play the tracks, one per file even when several tracks share it.
export function handoff_files(database: SqlDatabase, track_ids: readonly string[]): HandoffFiles {
  if (track_ids.length === 0) return { files: [], skipped: 0 }
  const rows = drizzle_of(database)
    .select({ track_id: media.track_id, uri: media.uri })
    .from(media)
    .where(and(
      inArray(media.track_id, [...track_ids]),
      eq(media.kind, 'file'), eq(media.present, 1), eq(media.subtrack_index, 0), isNull(media.start_ms)
    ))
    .orderBy(asc(media.uri))
    .all()

  const handed = new Set(rows.map((row) => row.track_id))
  return {
    files: [...new Set(rows.map((row) => row.uri))],
    skipped: [...new Set(track_ids)].filter((id) => !handed.has(id)).length
  }
}

// ── Rescanning ───────────────────────────────────────────────────────────────

const folder_of = (file: string): string => {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return cut <= 0 ? file.slice(0, cut + 1) || '/' : file.slice(0, cut)
}

const inside = (folder: string, parent: string): boolean =>
  folder === parent || folder.startsWith(parent.endsWith('/') || parent.endsWith('\\') ? parent : `${parent}/`) || folder.startsWith(`${parent}\\`)

export interface Rescan {
  // Folders inside the music folders, read whole so a file Picard renamed is found.
  folders: string[]
  // Files outside them, read alone so nothing else in their folder joins the library.
  files: string[]
}

// What to read again after Picard: each file's folder when it lies in a music folder, else the file itself.
export function rescan_targets(files: readonly string[], music_folders: readonly string[]): Rescan {
  const outside = new Set(files.filter((file) => !music_folders.some((root) => inside(file, root))))
  const folders = [...new Set(files.filter((file) => !outside.has(file)).map(folder_of))]
    .sort((first, second) => first.length - second.length)
  // A folder inside another is left out, since a scan reads a folder's subfolders too.
  const kept: string[] = []
  for (const folder of folders) if (!kept.some((parent) => inside(folder, parent))) kept.push(folder)
  return { folders: kept.sort(), files: [...outside].sort() }
}
