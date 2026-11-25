// Playlists: static ones hold tracks in an order, smart ones a saved filter; both are browsed as a filter on the library.

// ── Imports ──────────────────────────────────────────────────────────────────

import { asc, count, drizzle_of, eq, max } from '@x-tech-laboratories/x-libs/drizzle'
import { leaf, type FilterNode } from '@x-tech-laboratories/x-libs/filter'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { upgrade_definition } from '../filter_shapes.ts'
import type { PlaylistRow } from '../ipc.ts'
import { new_id } from './database.ts'
import { playlist_tracks, playlists } from './schema.ts'

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

function write_tracks(database: SqlDatabase, playlist_id: string, track_ids: readonly string[]): void {
  const db = drizzle_of(database)
  db.delete(playlist_tracks).where(eq(playlist_tracks.playlist_id, playlist_id)).run()
  track_ids.forEach((track_id, position) => db.insert(playlist_tracks).values({ playlist_id, track_id, position }).run())
}
