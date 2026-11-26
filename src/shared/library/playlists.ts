// Playlists: static ones hold tracks in an order, smart ones a saved filter; both are browsed as a filter on the library.

// ── Imports ──────────────────────────────────────────────────────────────────

import { asc, count, drizzle_of, eq, max } from '@x-tech-laboratories/x-libs/drizzle'
import { leaf, type FilterNode } from '@x-tech-laboratories/x-libs/filter'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { upgrade_definition } from '../filter_shapes.ts'
import type { PlaylistEntry } from '../import/playlist_files.ts'
import type { PlaylistRow } from '../ipc.ts'
import { new_id } from './database.ts'
import { get_player_track, list_playable_files } from './plays.ts'
import { media, playlist_tracks, playlists } from './schema.ts'
import { query_tracks } from './store.ts'

// ── Reading ──────────────────────────────────────────────────────────────────

// A smart playlist's filter from its definition, a bare filter or one with its sort and limit; null when unreadable.
function filter_of(definition: string | null): FilterNode | null {
  if (definition === null) return null
  try {
    const parsed = upgrade_definition(JSON.parse(definition)) as Record<string, unknown>
    return ('filter' in parsed ? parsed.filter : parsed) as FilterNode
  } catch {
    return null
  }
}

// Every playlist by name, with how many tracks a static one holds and the filter a smart one keeps.
export function list_playlists(database: SqlDatabase): PlaylistRow[] {
  const db = drizzle_of(database)
  const counts = new Map(db.select({ id: playlist_tracks.playlist_id, tracks: count() }).from(playlist_tracks).groupBy(playlist_tracks.playlist_id).all()
    .map((row) => [row.id, row.tracks]))
  return db.select().from(playlists).orderBy(asc(playlists.position), asc(playlists.name), asc(playlists.id)).all().map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind === 'smart' ? 'smart' : 'static',
    tracks: row.kind === 'smart' ? null : counts.get(row.id) ?? 0,
    filter: row.kind === 'smart' ? filter_of(row.definition) : null
  }))
}

// What browsing a playlist shows: a static one's tracks, or a smart one's filter.
export function playlist_filter(playlist: Pick<PlaylistRow, 'id' | 'kind' | 'filter'>): FilterNode {
  return playlist.kind === 'smart' ? playlist.filter ?? leaf('title', 'in_playlist', playlist.id) : leaf('title', 'in_playlist', playlist.id)
}

export function playlist_track_ids(database: SqlDatabase, playlist_id: string): string[] {
  return drizzle_of(database).select({ id: playlist_tracks.track_id }).from(playlist_tracks)
    .where(eq(playlist_tracks.playlist_id, playlist_id)).orderBy(asc(playlist_tracks.position)).all().map((row) => row.id)
}

// ── Writing ──────────────────────────────────────────────────────────────────

function checked_name(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('a playlist needs a name')
  return trimmed
}

function existing(database: SqlDatabase, playlist_id: string): typeof playlists.$inferSelect {
  const row = drizzle_of(database).select().from(playlists).where(eq(playlists.id, playlist_id)).get()
  if (!row) throw new Error(`there is no playlist ${playlist_id}`)
  return row
}

// A static playlist of these tracks, in this order, or a smart one keeping this filter.
export function create_playlist(database: SqlDatabase, name: string, contents: { track_ids?: readonly string[]; filter?: FilterNode }, now = Date.now()): PlaylistRow {
  const id = new_id()
  const smart = contents.filter !== undefined
  in_transaction(database, () => {
    drizzle_of(database).insert(playlists).values({
      id, name: checked_name(name), kind: smart ? 'smart' : 'static',
      definition: smart ? JSON.stringify(contents.filter) : null, created: now, modified: now
    }).run()
    if (!smart) write_tracks(database, id, contents.track_ids ?? [])
  })
  return list_playlists(database).find((row) => row.id === id)!
}

export function rename_playlist(database: SqlDatabase, playlist_id: string, name: string, now = Date.now()): void {
  existing(database, playlist_id)
  drizzle_of(database).update(playlists).set({ name: checked_name(name), modified: now }).where(eq(playlists.id, playlist_id)).run()
}

export function delete_playlist(database: SqlDatabase, playlist_id: string): void {
  existing(database, playlist_id)
  drizzle_of(database).delete(playlists).where(eq(playlists.id, playlist_id)).run()
}

function static_playlist(database: SqlDatabase, playlist_id: string): void {
  if (existing(database, playlist_id).kind === 'smart') throw new Error('a smart playlist keeps a filter, not tracks')
}

// Puts the tracks at the end of the playlist; gives how many it holds now.
export function add_to_playlist(database: SqlDatabase, playlist_id: string, track_ids: readonly string[], now = Date.now()): { tracks: number } {
  static_playlist(database, playlist_id)
  return in_transaction(database, () => {
    const db = drizzle_of(database)
    const last = db.select({ last: max(playlist_tracks.position) }).from(playlist_tracks).where(eq(playlist_tracks.playlist_id, playlist_id)).get()?.last ?? -1
    track_ids.forEach((track_id, index) => db.insert(playlist_tracks).values({ playlist_id, track_id, position: last + 1 + index }).run())
    db.update(playlists).set({ modified: now }).where(eq(playlists.id, playlist_id)).run()
    return { tracks: playlist_track_ids(database, playlist_id).length }
  })
}

// Takes every entry of these tracks out of the playlist, keeping the rest in order; gives how many it holds now.
export function remove_from_playlist(database: SqlDatabase, playlist_id: string, track_ids: readonly string[], now = Date.now()): { tracks: number } {
  static_playlist(database, playlist_id)
  const leaving = new Set(track_ids)
  return in_transaction(database, () => {
    const kept = playlist_track_ids(database, playlist_id).filter((id) => !leaving.has(id))
    write_tracks(database, playlist_id, kept)
    drizzle_of(database).update(playlists).set({ modified: now }).where(eq(playlists.id, playlist_id)).run()
    return { tracks: kept.length }
  })
}

// Moves the tracks, in the order given, to just before an entry of another track, or to the end with null; a moved track keeps one entry.
export function move_in_playlist(database: SqlDatabase, playlist_id: string, track_ids: readonly string[], before_track_id: string | null, now = Date.now()): string[] {
  static_playlist(database, playlist_id)
  const moving = [...new Set(track_ids)]
  const moved = new Set(moving)
  return in_transaction(database, () => {
    const entries = playlist_track_ids(database, playlist_id)
    if (moving.length === 0 || (before_track_id !== null && moved.has(before_track_id))) return entries
    const kept = entries.filter((id) => !moved.has(id))
    const at = before_track_id === null ? -1 : kept.indexOf(before_track_id)
    const order = at < 0 ? [...kept, ...moving] : [...kept.slice(0, at), ...moving, ...kept.slice(at)]
    write_tracks(database, playlist_id, order)
    drizzle_of(database).update(playlists).set({ modified: now }).where(eq(playlists.id, playlist_id)).run()
    return order
  })
}

function write_tracks(database: SqlDatabase, playlist_id: string, track_ids: readonly string[]): void {
  const db = drizzle_of(database)
  db.delete(playlist_tracks).where(eq(playlist_tracks.playlist_id, playlist_id)).run()
  track_ids.forEach((track_id, position) => db.insert(playlist_tracks).values({ playlist_id, track_id, position }).run())
}

// ── Files ────────────────────────────────────────────────────────────────────

export interface PlaylistImport {
  playlist: PlaylistRow
  matched: number
  // The entries no track in the library plays from, in the file's order.
  missing: string[]
}

// A static playlist of the tracks whose files the entries name, in their order; entries the library does not hold are listed.
export function import_playlist_entries(database: SqlDatabase, name: string, entries: readonly string[], now = Date.now()): PlaylistImport {
  const db = drizzle_of(database)
  const track_ids: string[] = []
  const missing: string[] = []
  for (const entry of entries) {
    const found = db.select({ track_id: media.track_id }).from(media).where(eq(media.uri, entry)).orderBy(asc(media.subtrack_index)).get()
    if (found) track_ids.push(found.track_id)
    else missing.push(entry)
  }
  return { playlist: create_playlist(database, name, { track_ids }, now), matched: track_ids.length, missing }
}

export interface PlaylistExport {
  name: string
  entries: PlaylistEntry[]
  // Tracks left out because no file of theirs is on disk.
  skipped: number
}

// A playlist's tracks by their best file on disk: a static one in its order, a smart one by album, disc and track.
export function export_entries(database: SqlDatabase, playlist_id: string): PlaylistExport {
  const playlist = list_playlists(database).find((row) => row.id === playlist_id)
  if (!playlist) throw new Error(`there is no playlist ${playlist_id}`)
  const track_ids = playlist.kind === 'static'
    ? playlist_track_ids(database, playlist_id)
    : query_tracks(database, { filter: playlist_filter(playlist), sort: [{ field: 'album' }, { field: 'disc_number' }, { field: 'track_number' }] }).map((row) => row.id)

  const entries: PlaylistEntry[] = []
  let skipped = 0
  for (const track_id of track_ids) {
    const file = list_playable_files(database, track_id).find((candidate) => candidate.present === 1 && candidate.start_ms === null)
    const track = get_player_track(database, track_id)
    if (!file || !track) {
      skipped++
      continue
    }
    entries.push({ path: file.uri, title: track.title, artist: track.artist, length_ms: track.length_ms })
  }
  return { name: playlist.name, entries, skipped }
}
