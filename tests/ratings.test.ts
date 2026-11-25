// Setting ratings by hand: any number of tracks at once, unrated as null, each change kept as a version.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { record_history, track_history_methods } from '@shared/library/history'
import { create_upserter } from '@shared/library/identity'
import { set_rating } from '@shared/library/ratings'
import { fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb

beforeEach(() => { db = fresh_db() })
afterEach(() => db.close())

// ============================================================================
// Helpers
// ============================================================================

function track(title: string): string {
  const result = create_upserter(db)({ title, sets: { artist: ['Miles Davis'] } }, { uri: `/music/${title}.flac` }, { metadata: true })
  record_history(db)
  return result.track_id
}

const rating_of = (id: string): number | null =>
  (db.prepare('SELECT rating FROM tracks WHERE id = ?').get(id) as { rating: number | null }).rating

// ============================================================================
// Setting
// ============================================================================

describe('set_rating', () => {
  it('rates every track given and says how many changed', () => {
    const first = track('So What')
    const second = track('Blue in Green')

    const result = set_rating(db, [first, second], 80)

    expect(result).toEqual({ changed: 2 })
    expect(rating_of(first)).toBe(80)
    expect(rating_of(second)).toBe(80)
  })

  it('makes tracks unrated with null, which is not the same as zero', () => {
    const id = track('So What')
    set_rating(db, [id], 0)

    expect(rating_of(id)).toBe(0)
    expect(set_rating(db, [id], null)).toEqual({ changed: 1 })
    expect(rating_of(id)).toBeNull()
  })

  it('leaves tracks that already have the rating alone', () => {
    const rated = track('So What')
    const unrated = track('Blue in Green')
    set_rating(db, [rated], 60)

    const never_rated = track('Flamenco Sketches')

    expect(set_rating(db, [rated, unrated], 60)).toEqual({ changed: 1 })
    expect(set_rating(db, [never_rated], null)).toEqual({ changed: 0 })
  })

  it('changes nothing for no tracks or an unknown id', () => {
    expect(set_rating(db, [], 40)).toEqual({ changed: 0 })
    expect(set_rating(db, ['no-such-track'], 40)).toEqual({ changed: 0 })
  })

  it.each([-1, 101, 2.5, Number.NaN])('refuses %s as a rating', (rating) => {
    const id = track('So What')

    expect(() => set_rating(db, [id], rating)).toThrow(/whole number from 0 to 100/)
    expect(rating_of(id)).toBeNull()
  })
})

// ============================================================================
// History
// ============================================================================

describe('set_rating and the history', () => {
  it('keeps each change as a version, and a restore brings the old rating back', () => {
    const id = track('So What')
    set_rating(db, [id], 100)
    record_history(db)
    set_rating(db, [id], 20)
    record_history(db)

    const history = track_history_methods(() => db)
    const versions = history.list_versions(id)
    expect(versions.map((version) => version.snapshot.track.rating)).toEqual([20, 100, null])

    history.restore_version(versions[1]!.id)
    expect(rating_of(id)).toBe(100)
  })

  it('makes no version when nothing changed', () => {
    const id = track('So What')
    set_rating(db, [id], 60)
    record_history(db)
    set_rating(db, [id], 60)
    record_history(db)

    expect(track_history_methods(() => db).list_versions(id)).toHaveLength(2)
  })
})
