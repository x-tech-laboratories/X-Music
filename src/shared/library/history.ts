// Every change to a track kept as a version through X-Libs history: its tags, rating, album, set fields and files, so
// any version can be restored and a track a merge took away brought back. Plays are a log rather than an edit, so a
// play alone makes no version.

// ── Imports ──────────────────────────────────────────────────────────────────

import { create_history, history_methods, type HistoryMethods } from '@x-tech-laboratories/x-libs/history'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { all_rows, first_row, placeholders, run } from './database.ts'
import { intern_value } from './values.ts'

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface TrackState {
  title: string | null
  album_id: string | null
  // The album's name when the version was made, for showing it after the album is gone.
  album: string | null
  year: number | null
  track_number: number | null
  disc_number: number | null
  length_ms: number | null
  compilation: number
  bpm: number | null
  mb_recording_id: string | null
  acoustid: string | null
  identity_source: string
  identity_key: string | null
  pinned: number
  rating: number | null
  loved: number
  rg_track_gain: number | null
  rg_album_gain: number | null
  added: number
  primary_media_id: string | null
  play_count: number
  skip_count: number
  first_played: number | null
  last_played: number | null
  last_skipped: number | null
  bookmark_ms: number | null
}

// A track as one version holds it; set values and extras by their field's number, files by id.
export interface TrackSnapshot {
  track: TrackState
  values: { field_id: number; value: string; ordinal: number }[]
  extras: { field_id: number; value: string | null }[]
  media: string[]
}

// Counted by listening rather than set by a person, so they make no version and a restore leaves them as they are.
const listening = ['play_count', 'skip_count', 'first_played', 'last_played', 'last_skipped', 'bookmark_ms'] as const

const edited_columns = [
  'title', 'album_id', 'year', 'track_number', 'disc_number', 'length_ms', 'compilation', 'bpm', 'mb_recording_id', 'acoustid',
  'identity_source', 'identity_key', 'pinned', 'rating', 'loved', 'rg_track_gain', 'rg_album_gain', 'added', 'primary_media_id'
] as const

// ── Reading and applying ─────────────────────────────────────────────────────

function read_track(database: SqlDatabase, track_id: string): TrackSnapshot | null {
  const track = first_row<TrackState>(
    database,
    `SELECT ${edited_columns.join(', ')}, ${listening.join(', ')}, (SELECT name FROM albums WHERE albums.id = tracks.album_id) AS album
     FROM tracks WHERE id = ?`,
    track_id
  )
  if (!track) return null
  return {
    track: { ...track },
    values: all_rows<TrackSnapshot['values'][number]>(
      database,
      `SELECT track_values.field_id, values_.value, track_values.ordinal FROM track_values JOIN values_ ON values_.id = track_values.value_id
       WHERE track_values.track_id = ? ORDER BY track_values.field_id, track_values.ordinal`,
      track_id
    ).map((row) => ({ ...row })),
    extras: all_rows<TrackSnapshot['extras'][number]>(database, 'SELECT field_id, value FROM track_extras WHERE track_id = ? ORDER BY field_id', track_id).map((row) => ({ ...row })),
    media: all_rows<{ id: string }>(database, 'SELECT id FROM media WHERE track_id = ? ORDER BY id', track_id).map((row) => row.id)
  }
}

const exists = (database: SqlDatabase, table: string, id: string | null): boolean =>
  id !== null && first_row(database, `SELECT 1 FROM ${table} WHERE id = ?`, id) !== undefined

// Puts a track back as the snapshot has it: an album or file that is gone is left out, and files are only claimed, never let go.
function apply_track(database: SqlDatabase, track_id: string, snapshot: TrackSnapshot): void {
  const state = {
    ...snapshot.track,
    album_id: exists(database, 'albums', snapshot.track.album_id) ? snapshot.track.album_id : null,
    primary_media_id: exists(database, 'media', snapshot.track.primary_media_id) ? snapshot.track.primary_media_id : null
  }
  const now = Date.now()

  if (exists(database, 'tracks', track_id)) {
    run(database, `UPDATE tracks SET ${edited_columns.map((column) => `${column} = ?`).join(', ')}, modified = ? WHERE id = ?`, ...edited_columns.map((column) => state[column]), now, track_id)
  } else {
    const columns = [...edited_columns, ...listening]
    run(
      database,
      `INSERT INTO tracks (id, ${columns.join(', ')}, modified) VALUES (?, ${placeholders(columns)}, ?)`,
      track_id,
      ...columns.map((column) => state[column]),
      now
    )
  }

  run(database, 'DELETE FROM track_values WHERE track_id = ?', track_id)
  for (const { field_id, value, ordinal } of snapshot.values) {
    run(database, 'INSERT OR IGNORE INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)', track_id, field_id, intern_value(database, field_id, value), ordinal)
  }
  run(database, 'DELETE FROM track_extras WHERE track_id = ?', track_id)
  for (const { field_id, value } of snapshot.extras) run(database, 'INSERT INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?)', track_id, field_id, value)
  if (snapshot.media.length > 0) run(database, `UPDATE media SET track_id = ? WHERE id IN (${placeholders(snapshot.media)})`, track_id, ...snapshot.media)
}

function without_listening(snapshot: TrackSnapshot): unknown {
  const track: Partial<TrackState> = { ...snapshot.track }
  for (const column of listening) delete track[column]
  return { ...snapshot, track }
}

// ── History ──────────────────────────────────────────────────────────────────

export const track_history = create_history<TrackSnapshot>({
  name: 'track',
  item_table: 'tracks',
  watches: [
    { table: 'tracks', item_columns: ['id'] },
    { table: 'track_values', item_columns: ['track_id'] },
    { table: 'track_extras', item_columns: ['track_id'] },
    { table: 'media', item_columns: ['track_id'] }
  ],
  read: read_track,
  apply: apply_track,
  is_same: (first, second) => JSON.stringify(without_listening(first)) === JSON.stringify(without_listening(second)),
  created_at: (snapshot) => new Date(snapshot.track.added).toISOString()
})

// ── Keeping ──────────────────────────────────────────────────────────────────

export const history_keep_days_key = 'history.keep_days'
export const default_history_keep_days = 365

export function get_history_keep_days(database: SqlDatabase): number {
  const row = first_row<{ value: string }>(database, 'SELECT value FROM settings WHERE key = ?', history_keep_days_key)
  const days = row ? Number(JSON.parse(row.value)) : default_history_keep_days
  return Number.isFinite(days) && days > 0 ? days : default_history_keep_days
}

export function set_history_keep_days(database: SqlDatabase, days: number): void {
  if (!Number.isFinite(days) || days < 1) throw new Error('versions must be kept for at least one day')
  run(database, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', history_keep_days_key, JSON.stringify(Math.round(days)))
  prune_history(database)
}

export function prune_history(database: SqlDatabase, now = Date.now()): void {
  track_history.prune(database, new Date(now - get_history_keep_days(database) * 24 * 60 * 60 * 1000).toISOString())
}

// Run each time the library opens: tables, triggers, a first version of every track that has none, and old versions pruned.
export function install_history(database: SqlDatabase): void {
  in_transaction(database, () => {
    track_history.install(database)
    prune_history(database)
  })
}

const pruned_at = new WeakMap<SqlDatabase, number>()

// Saves a version of every track a write touched; run after each write, however it was made, and prunes once a day.
export function record_history(database: SqlDatabase, now = Date.now()): void {
  in_transaction(database, () => track_history.record(database))
  const last = pruned_at.get(database)
  if (last !== undefined && now - last < 24 * 60 * 60 * 1000) return
  pruned_at.set(database, now)
  prune_history(database, now)
}

// ── Calls ────────────────────────────────────────────────────────────────────

// The history calls the page makes, answered on the database given; a restore is recorded at once.
export function track_history_methods(database: () => SqlDatabase): HistoryMethods<TrackSnapshot> {
  const methods = history_methods(track_history, database)
  return {
    ...methods,
    restore_version: (version_id) => in_transaction(database(), () => methods.restore_version(version_id))
  }
}
