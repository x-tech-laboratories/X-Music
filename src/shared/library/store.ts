// The library store: one SQLite database brought up to date when it opens, with the calls the main process answers on
// it. It runs on any X-Libs SqlDatabase, so nothing here reaches the disk or Electron itself.

// ── Imports ──────────────────────────────────────────────────────────────────

import { asc, count, drizzle_of, eq, isNotNull, sum } from '@x-tech-laboratories/x-libs/drizzle'
import { migrate_drizzle } from '@x-tech-laboratories/x-libs/drizzle'
import { compile_filter, compile_group_by } from '@x-tech-laboratories/x-libs/filter_sql'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { upgrade_definition } from '../filter_shapes.ts'
import type { GroupRow, LibraryStats, QueryRequest, Root, TrackRow } from '../ipc.ts'
import { group_sums, track_catalogue } from '../query/catalogue.ts'
import { all_rows, first_row, new_id, run } from './database.ts'
import { install_history, track_history } from './history.ts'
import { is_legacy, upgrade_legacy, type UpgradeReport } from './legacy.ts'
import { migrations } from './migrations/index.ts'
import {
  albums, artwork, media, media_tags, merge_journal, play_history, playlist_tracks, playlists, roots, tag_writes,
  track_extras, track_values, tracks, values_
} from './schema.ts'

// ── Opening ──────────────────────────────────────────────────────────────────

export const library_owner = 'library'

// Raw because sqlite_master and the migration log are SQLite's and X-Libs' own tables, not in the schema.
function schema_version(database: SqlDatabase): number {
  const has_versions = first_row(database, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_versions'") !== undefined
  if (!has_versions) return 0
  return first_row<{ version: number }>(database, 'SELECT version FROM schema_versions WHERE owner = ?', library_owner)?.version ?? 0
}

// Whether opening would change the schema of a library that already holds data, so it can be backed up first.
export function needs_upgrade(database: SqlDatabase): boolean {
  if (is_legacy(database)) return true
  const version = schema_version(database)
  return version > 0 && version < migrations.length
}

export type { UpgradeReport }

// Rewrites each smart playlist's saved filter that an earlier version wrote into today's shape; a definition that is not JSON is left alone.
export function upgrade_playlist_definitions(database: SqlDatabase): number {
  const db = drizzle_of(database)
  let upgraded = 0
  for (const playlist of db.select({ id: playlists.id, definition: playlists.definition }).from(playlists).where(isNotNull(playlists.definition)).all()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(playlist.definition!)
    } catch {
      continue
    }
    const definition = JSON.stringify(upgrade_definition(parsed))
    if (definition === JSON.stringify(parsed)) continue
    db.update(playlists).set({ definition }).where(eq(playlists.id, playlist.id)).run()
    upgraded++
  }
  return upgraded
}

// Brings an open connection up to date and starts the track history; run once each time the library opens. Gives back what converting an older library did, when it was one.
export function open_library(database: SqlDatabase): UpgradeReport | null {
  // SQLite changes a schema with foreign keys off and checks them after; PRAGMAs stay raw, since Drizzle builds none.
  database.exec('PRAGMA foreign_keys = OFF')
  const report = is_legacy(database) ? upgrade_legacy(database) : null
  migrate_drizzle(database, library_owner, migrations)
  upgrade_playlist_definitions(database)
  const broken = all_rows(database, 'PRAGMA foreign_key_check')
  if (broken.length > 0) throw new Error(`the library has ${broken.length} broken references`)
  database.exec('PRAGMA foreign_keys = ON')
  install_history(database)
  return report
}

// ── Reading ──────────────────────────────────────────────────────────────────

export function library_stats(database: SqlDatabase, path: string): LibraryStats {
  const db = drizzle_of(database)
  return {
    tracks: db.select({ total: count() }).from(tracks).get()!.total,
    media: db.select({ total: count() }).from(media).get()!.total,
    albums: db.select({ total: count() }).from(albums).get()!.total,
    missing: db.select({ total: count() }).from(media).where(eq(media.present, 0)).get()!.total,
    total_ms: Number(db.select({ total: sum(tracks.length_ms) }).from(tracks).get()!.total ?? 0),
    schema_version: schema_version(database),
    path
  }
}

// Album lives on the albums table and artist in track_values, so a row resolves both; raw, since the compiled filter around it is SQL.
const track_columns = (row: string): string => `
  ${row}.id, ${row}.title, ${row}.year, ${row}.track_number, ${row}.length_ms, ${row}.rating, ${row}.play_count,
  (SELECT a.name FROM albums a WHERE a.id = ${row}.album_id) AS album,
  (SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
    WHERE tv.track_id = ${row}.id AND tv.field_id = 1 ORDER BY tv.ordinal LIMIT 1) AS artist`

// ── Searching ────────────────────────────────────────────────────────────────

const search_columns = 'title, artist, album, album_artist, genre, comment, lyrics'

// Rebuilds the search rows of tracks changed since the last search, in one pass; raw because the search tables are kept by triggers, not in the schema.
export function refresh_search(database: SqlDatabase): void {
  if (first_row(database, 'SELECT 1 FROM track_search_stale LIMIT 1') === undefined) return
  in_transaction(database, () => {
    run(database, `INSERT INTO track_search (track_id, ${search_columns})
      SELECT track_id, ${search_columns} FROM track_search_source WHERE track_id IN (SELECT track_id FROM track_search_stale)
      ON CONFLICT(track_id) DO UPDATE SET title = excluded.title, artist = excluded.artist, album = excluded.album,
        album_artist = excluded.album_artist, genre = excluded.genre, comment = excluded.comment, lyrics = excluded.lyrics`)
    run(database, 'DELETE FROM track_search_stale')
  })
}

// The tracks a filter picks, as the song list shows them; the filter compiles to SQL, which Drizzle cannot build.
export function query_tracks(database: SqlDatabase, request: QueryRequest): TrackRow[] {
  refresh_search(database)
  const { sql, params } = compile_filter(track_catalogue, request.filter, {
    sort: request.sort, limit: request.limit, offset: request.offset, select: track_columns
  })
  return all_rows<TrackRow>(database, sql, ...params).map((row) => ({ ...row }))
}

// Raw because the filter and the grouping compile to SQL.
export function group_tracks(database: SqlDatabase, request: { filter: QueryRequest['filter']; field: string }): GroupRow[] {
  refresh_search(database)
  const { sql, params } = compile_group_by(track_catalogue, request.filter, request.field, { sums: group_sums })
  return all_rows<GroupRow>(database, sql, ...params).map((row) => ({ ...row }))
}

// ── Folders ──────────────────────────────────────────────────────────────────

const as_root = (row: typeof roots.$inferSelect): Root => ({
  id: row.id,
  path: row.path,
  enabled: row.enabled === 1,
  slow: row.slow === 1,
  last_scan: row.last_scan
})

export function list_roots(database: SqlDatabase): Root[] {
  return drizzle_of(database).select().from(roots).orderBy(asc(roots.path)).all().map(as_root)
}

// Adds a music folder, or gives back the one already kept for that path.
export function add_root(database: SqlDatabase, path: string): Root {
  const db = drizzle_of(database)
  db.insert(roots).values({ id: new_id(), path, enabled: 1 }).onConflictDoNothing().run()
  return as_root(db.select().from(roots).where(eq(roots.path, path)).get()!)
}

export function remove_root(database: SqlDatabase, id: string): void {
  drizzle_of(database).delete(roots).where(eq(roots.id, id)).run()
}

export function enabled_root_paths(database: SqlDatabase): string[] {
  return drizzle_of(database).select({ path: roots.path }).from(roots).where(eq(roots.enabled, 1)).orderBy(asc(roots.path)).all().map((row) => row.path)
}

export function mark_roots_scanned(database: SqlDatabase, at: number): void {
  drizzle_of(database).update(roots).set({ last_scan: at }).where(eq(roots.enabled, 1)).run()
}

// ── Clearing ─────────────────────────────────────────────────────────────────

// Empties the library of tracks and everything hanging off them, keeping the music folders and settings; the caller backs up first. The track history and merge journal go too, since nothing is left for them to bring back.
export function clear_library(database: SqlDatabase): void {
  in_transaction(database, () => {
    const db = drizzle_of(database)
    for (const table of [playlist_tracks, playlists, play_history, track_values, track_extras, tag_writes, media_tags, media, artwork, tracks, albums, values_, merge_journal]) {
      db.delete(table).run()
    }
    // Raw because the search table and the versions table are kept by triggers and X-Libs history, not in the schema.
    run(database, 'DELETE FROM track_search')
    run(database, 'DELETE FROM track_search_stale')
    track_history.forget_touched(database)
    run(database, 'DELETE FROM track_versions')
  })
}
