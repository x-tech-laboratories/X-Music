// Ratings set by hand: 0 to 100 on any number of tracks at once, or null to make them unrated.

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, drizzle_of, inArray, isNotNull, isNull, ne, or } from '@x-tech-laboratories/x-libs/drizzle'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { tracks } from './schema.ts'

// ── Checking ─────────────────────────────────────────────────────────────────

export function check_rating(rating: number | null): void {
  if (rating === null) return
  if (!Number.isInteger(rating) || rating < 0 || rating > 100) throw new Error(`a rating is a whole number from 0 to 100, or null; got ${rating}`)
}

// ── Setting ──────────────────────────────────────────────────────────────────

// Changes only the tracks whose rating differs, so the history gains no empty versions; gives how many changed.
export function set_rating(database: SqlDatabase, track_ids: readonly string[], rating: number | null, now = Date.now()): { changed: number } {
  check_rating(rating)
  if (track_ids.length === 0) return { changed: 0 }

  const differs = rating === null ? isNotNull(tracks.rating) : or(isNull(tracks.rating), ne(tracks.rating, rating))

  return in_transaction(database, () => {
    const changed = drizzle_of(database).update(tracks)
      .set({ rating, modified: now })
      .where(and(inArray(tracks.id, [...track_ids]), differs))
      .returning({ id: tracks.id }).all()
    return { changed: changed.length }
  })
}
