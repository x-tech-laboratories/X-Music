// The recorded answer to where a track's cover art is: found for its album, or for the track when it has none, and
// remembered when nothing was found so the search is not repeated.

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, asc, count, desc, drizzle_of, eq, or, sql } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { new_id } from './database.ts'
import { artwork, media, tracks } from './schema.ts'

// ── Shapes ───────────────────────────────────────────────────────────────────

export type ArtSource = 'embedded' | 'folder' | 'none'

export interface Artwork {
  source: ArtSource
  // The cached image, or null when nothing was found.
  path: string | null
  origin: string | null
  width: number | null
  height: number | null
  hash: string | null
}

export const no_artwork: Artwork = { source: 'none', path: null, origin: null, width: null, height: null, hash: null }

// ── Reading ──────────────────────────────────────────────────────────────────

// The recorded answer for a track, the track's own before its album's, if one exists.
export function lookup_artwork(database: SqlDatabase, track_id: string): Artwork | null {
  const row = drizzle_of(database)
    .select({ source: artwork.source, path: artwork.path, origin: artwork.origin, width: artwork.width, height: artwork.height, hash: artwork.hash })
    .from(tracks)
    .innerJoin(artwork, or(eq(artwork.album_id, tracks.album_id), eq(artwork.track_id, tracks.id)))
    .where(eq(tracks.id, track_id))
    .orderBy(sql`${artwork.track_id} IS NULL`)
    .limit(1)
    .get()
  return row ? { ...row, source: row.source as ArtSource } : null
}

export function album_of(database: SqlDatabase, track_id: string): { album_id: string | null } | undefined {
  return drizzle_of(database).select({ album_id: tracks.album_id }).from(tracks).where(eq(tracks.id, track_id)).get()
}

// The paths of a track's files that are there, best first.
export function present_file_paths(database: SqlDatabase, track_id: string): string[] {
  return drizzle_of(database)
    .select({ uri: media.uri })
    .from(media)
    .where(and(eq(media.track_id, track_id), eq(media.kind, 'file'), eq(media.present, 1)))
    .orderBy(desc(media.quality_rank), asc(media.added), asc(media.id))
    .all()
    .map((row) => row.uri)
}

// ── Writing ──────────────────────────────────────────────────────────────────

// Records what was found, against the album when there is one so every track on it shares the answer.
export function record_artwork(database: SqlDatabase, track_id: string, album_id: string | null, found: Artwork, bytes: number | null, at: number): void {
  drizzle_of(database)
    .insert(artwork)
    .values({
      id: new_id(),
      album_id,
      track_id: album_id === null ? track_id : null,
      source: found.source,
      origin: found.origin,
      hash: found.hash,
      path: found.path,
      width: found.width,
      height: found.height,
      bytes,
      found_at: at
    })
    .onConflictDoNothing()
    .run()
}

// Clears recorded misses, so a newly added cover is picked up without wiping real entries.
export function forget_misses(database: SqlDatabase): number {
  const db = drizzle_of(database)
  const misses = db.select({ total: count() }).from(artwork).where(eq(artwork.source, 'none')).get()!.total
  db.delete(artwork).where(eq(artwork.source, 'none')).run()
  return misses
}
