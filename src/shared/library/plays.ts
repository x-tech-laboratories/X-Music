// What the player reads and writes: a track as it shows it, the files that can play it, and each play or skip.

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, count, eq } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { PlayerTrack } from '../ipc.ts'
import { all_rows, drizzle_of, first_row, new_id, run } from './database.ts'
import { media, play_history } from './schema.ts'

// ── Reading ──────────────────────────────────────────────────────────────────

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
  return all_rows<PlayableFile>(
    database,
    `SELECT m.id, m.uri, m.present, m.start_ms, m.end_ms,
            t.rg_track_gain AS track_gain, t.rg_album_gain AS album_gain
     FROM media m JOIN tracks t ON t.id = m.track_id
     WHERE m.track_id = ? AND m.kind = 'file'
     ORDER BY m.present DESC, m.quality_rank DESC, m.added, m.id`,
    track_id
  ).map((row) => ({ ...row }))
}

export function has_any_file(database: SqlDatabase, track_id: string): boolean {
  return drizzle_of(database).select({ total: count() }).from(media).where(and(eq(media.track_id, track_id), eq(media.kind, 'file'))).get()!.total > 0
}

// ── Writing ──────────────────────────────────────────────────────────────────

export function set_file_present(database: SqlDatabase, media_id: string, present: boolean): void {
  drizzle_of(database).update(media).set({ present: present ? 1 : 0 }).where(eq(media.id, media_id)).run()
}

export function count_play(database: SqlDatabase, track_id: string, at: number): void {
  run(database, 'UPDATE tracks SET play_count = play_count + 1, last_played = ?, first_played = COALESCE(first_played, ?) WHERE id = ?', at, at, track_id)
  drizzle_of(database).insert(play_history).values({ id: new_id(), track_id, at, kind: 0 }).onConflictDoNothing().run()
}

export function count_skip(database: SqlDatabase, track_id: string, at: number): void {
  run(database, 'UPDATE tracks SET skip_count = skip_count + 1, last_skipped = ? WHERE id = ?', at, track_id)
  drizzle_of(database).insert(play_history).values({ id: new_id(), track_id, at, kind: 1 }).onConflictDoNothing().run()
}
