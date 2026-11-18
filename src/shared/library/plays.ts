// What the player reads and writes: a track as it shows it, the files that can play it, and each play or skip.

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, asc, count, desc, eq, sql } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { PlayerTrack } from '../ipc.ts'
import { drizzle_of, first_row, new_id } from './database.ts'
import { media, play_history, tracks } from './schema.ts'

// ── Reading ──────────────────────────────────────────────────────────────────

// Raw because the album and first artist are correlated subqueries, which read plainer as SQL.
export function get_player_track(database: SqlDatabase, track_id: string): PlayerTrack | null {
  const row = first_row<PlayerTrack>(
    database,
    `SELECT t.id, t.title, t.length_ms, t.rating,
       (SELECT a.name FROM albums a WHERE a.id = t.album_id) AS album,
       (SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
         WHERE tv.track_id = t.id AND tv.field_id = 1 ORDER BY tv.ordinal LIMIT 1) AS artist
     FROM tracks t WHERE t.id = ?`,
    track_id
  )
  return row ? { ...row } : null
}

export interface PlayableFile {
  id: string
  uri: string
  present: number
  start_ms: number | null
  end_ms: number | null
  track_gain: number | null
  album_gain: number | null
}

// A track's files, the ones last seen and best first.
export function list_playable_files(database: SqlDatabase, track_id: string): PlayableFile[] {
  return drizzle_of(database)
    .select({
      id: media.id, uri: media.uri, present: media.present, start_ms: media.start_ms, end_ms: media.end_ms,
      track_gain: tracks.rg_track_gain, album_gain: tracks.rg_album_gain
    })
    .from(media).innerJoin(tracks, eq(tracks.id, media.track_id))
    .where(and(eq(media.track_id, track_id), eq(media.kind, 'file')))
    .orderBy(desc(media.present), desc(media.quality_rank), asc(media.added), asc(media.id))
    .all()
}

export function has_any_file(database: SqlDatabase, track_id: string): boolean {
  return drizzle_of(database).select({ total: count() }).from(media).where(and(eq(media.track_id, track_id), eq(media.kind, 'file'))).get()!.total > 0
}

// ── Writing ──────────────────────────────────────────────────────────────────

export function set_file_present(database: SqlDatabase, media_id: string, present: boolean): void {
  drizzle_of(database).update(media).set({ present: present ? 1 : 0 }).where(eq(media.id, media_id)).run()
}

export function count_play(database: SqlDatabase, track_id: string, at: number): void {
  drizzle_of(database).update(tracks)
    .set({ play_count: sql`${tracks.play_count} + 1`, last_played: at, first_played: sql`COALESCE(${tracks.first_played}, ${at})` })
    .where(eq(tracks.id, track_id)).run()
  drizzle_of(database).insert(play_history).values({ id: new_id(), track_id, at, kind: 0 }).onConflictDoNothing().run()
}

export function count_skip(database: SqlDatabase, track_id: string, at: number): void {
  drizzle_of(database).update(tracks).set({ skip_count: sql`${tracks.skip_count} + 1`, last_skipped: at }).where(eq(tracks.id, track_id)).run()
  drizzle_of(database).insert(play_history).values({ id: new_id(), track_id, at, kind: 1 }).onConflictDoNothing().run()
}
