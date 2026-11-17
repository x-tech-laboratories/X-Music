// The library store: one SQLite database brought up to date when it opens, with the calls the main process answers on
// it. It runs on any X-Libs SqlDatabase, so nothing here reaches the disk or Electron itself.

// ── Imports ──────────────────────────────────────────────────────────────────

import { asc, count, eq, sum } from '@x-tech-laboratories/x-libs/drizzle'
import { migrate_drizzle } from '@x-tech-laboratories/x-libs/drizzle'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { GroupRow, LibraryStats, QueryRequest, Root, TrackRow } from '../ipc.ts'
import { compile_filter, compile_group_by } from '../query/compile.ts'
import { all_rows, drizzle_of, first_row, new_id, run } from './database.ts'
import { install_history, track_history } from './history.ts'
import { is_legacy, upgrade_legacy, type UpgradeReport } from './legacy.ts'
import { migrations } from './migrations/index.ts'
import { albums, media, roots, tracks } from './schema.ts'

// ── Opening ──────────────────────────────────────────────────────────────────

export const library_owner = 'library'

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

// Brings an open connection up to date and starts the track history; run once each time the library opens. Gives back what converting an older library did, when it was one.
export function open_library(database: SqlDatabase): UpgradeReport | null {
  // SQLite changes a schema with foreign keys off and checks them after.
  database.exec('PRAGMA foreign_keys = OFF')
  const report = is_legacy(database) ? upgrade_legacy(database) : null
  migrate_drizzle(database, library_owner, migrations)
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
    totalMs: Number(db.select({ total: sum(tracks.length_ms) }).from(tracks).get()!.total ?? 0),
    schemaVersion: schema_version(database),
    path
  }
}

// Album lives on the albums table and artist in track_values, so a row resolves both.
const track_columns = `
  t.id, t.title, t.year, t.track_number, t.length_ms, t.rating, t.play_count,
  (SELECT a.name FROM albums a WHERE a.id = t.album_id) AS album,
  (SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
    WHERE tv.track_id = t.id AND tv.field_id = 1 ORDER BY tv.ordinal LIMIT 1) AS artist`

// The tracks a filter picks, as the song list shows them; the filter compiles to SQL, which Drizzle cannot build.
export function query_tracks(database: SqlDatabase, request: QueryRequest): TrackRow[] {
  const { sql, params } = compile_filter(request.filter, { sort: request.sort, limit: request.limit, select: track_columns })
  const paged = request.offset ? `${sql} OFFSET ${Number(request.offset)}` : sql
  return all_rows<TrackRow>(database, paged, ...params).map((row) => ({ ...row }))
}

export function group_tracks(database: SqlDatabase, request: { filter: QueryRequest['filter']; field: string }): GroupRow[] {
  const { sql, params } = compile_group_by(request.filter, request.field)
  return all_rows<GroupRow>(database, sql, ...params).map((row) => ({ ...row }))
}

// ── Folders ──────────────────────────────────────────────────────────────────

const as_root = (row: typeof roots.$inferSelect): Root => ({
  id: row.id,
  path: row.path,
  enabled: row.enabled === 1,
  slow: row.slow === 1,
  lastScan: row.last_scan
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
    for (const table of ['playlist_tracks', 'playlists', 'play_history', 'track_values', 'track_extras', 'tag_writes', 'media_tags', 'media', 'artwork', 'tracks', 'albums', 'values_', 'merge_journal', 'tracks_fts']) {
      run(database, `DELETE FROM ${table}`)
    }
    track_history.forget_touched(database)
    run(database, 'DELETE FROM track_versions')
  })
}
