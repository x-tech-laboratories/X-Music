// Every change to a track kept as a version through X-Libs history: its tags, rating, album, set fields and files, so
// any version can be restored and a track a merge took away brought back. Plays are a log rather than an edit, so a
// play alone makes no version.

// ── Imports ──────────────────────────────────────────────────────────────────

import { asc, drizzle_of, eq, inArray } from '@x-tech-laboratories/x-libs/drizzle'
import { create_history, history_methods, type HistoryMethods } from '@x-tech-laboratories/x-libs/history'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { album_name } from './database.ts'
import { albums, media, settings, track_extras, track_values, tracks, values_ } from './schema.ts'
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

// In this order, since versions are compared by their JSON.
const state_select = {
  ...Object.fromEntries([...edited_columns, ...listening].map((column) => [column, tracks[column]])),
  album: album_name
}

function read_track(database: SqlDatabase, track_id: string): TrackSnapshot | null {
  const db = drizzle_of(database)
  const track = db.select(state_select).from(tracks).where(eq(tracks.id, track_id)).get() as TrackState | undefined
  if (!track) return null
  return {
    track,
    values: db.select({ field_id: track_values.field_id, value: values_.value, ordinal: track_values.ordinal })
      .from(track_values).innerJoin(values_, eq(values_.id, track_values.value_id))
      .where(eq(track_values.track_id, track_id)).orderBy(asc(track_values.field_id), asc(track_values.ordinal)).all(),
    extras: db.select({ field_id: track_extras.field_id, value: track_extras.value }).from(track_extras)
      .where(eq(track_extras.track_id, track_id)).orderBy(asc(track_extras.field_id)).all(),
    media: db.select({ id: media.id }).from(media).where(eq(media.track_id, track_id)).orderBy(asc(media.id)).all().map((row) => row.id)
  }
}

const keyed = { albums, media, tracks }

const exists = (database: SqlDatabase, table: keyof typeof keyed, id: string | null): boolean =>
  id !== null && drizzle_of(database).select({ id: keyed[table].id }).from(keyed[table]).where(eq(keyed[table].id, id)).get() !== undefined

// Puts a track back as the snapshot has it: an album or file that is gone is left out, and files are only claimed, never let go.
function apply_track(database: SqlDatabase, track_id: string, snapshot: TrackSnapshot): void {
  const state = {
    ...snapshot.track,
    album_id: exists(database, 'albums', snapshot.track.album_id) ? snapshot.track.album_id : null,
    primary_media_id: exists(database, 'media', snapshot.track.primary_media_id) ? snapshot.track.primary_media_id : null
  }
  const now = Date.now()
  const db = drizzle_of(database)
  const columns_of = <Column extends keyof typeof state>(columns: readonly Column[]) => Object.fromEntries(columns.map((column) => [column, state[column]])) as Pick<typeof state, Column>

  if (exists(database, 'tracks', track_id)) {
    db.update(tracks).set({ ...columns_of(edited_columns), modified: now }).where(eq(tracks.id, track_id)).run()
  } else {
    db.insert(tracks).values({ id: track_id, ...columns_of([...edited_columns, ...listening]), modified: now }).run()
  }

  db.delete(track_values).where(eq(track_values.track_id, track_id)).run()
  for (const { field_id, value, ordinal } of snapshot.values) {
    db.insert(track_values).values({ track_id, field_id, value_id: intern_value(database, field_id, value), ordinal }).onConflictDoNothing().run()
  }
  db.delete(track_extras).where(eq(track_extras.track_id, track_id)).run()
  for (const { field_id, value } of snapshot.extras) db.insert(track_extras).values({ track_id, field_id, value }).run()
  if (snapshot.media.length > 0) db.update(media).set({ track_id }).where(inArray(media.id, snapshot.media)).run()
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
  const row = drizzle_of(database).select({ value: settings.value }).from(settings).where(eq(settings.key, history_keep_days_key)).get()
  const days = row ? Number(JSON.parse(row.value)) : default_history_keep_days
  return Number.isFinite(days) && days > 0 ? days : default_history_keep_days
}

export function set_history_keep_days(database: SqlDatabase, days: number): void {
  if (!Number.isFinite(days) || days < 1) throw new Error('versions must be kept for at least one day')
  const value = JSON.stringify(Math.round(days))
  drizzle_of(database).insert(settings).values({ key: history_keep_days_key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
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
