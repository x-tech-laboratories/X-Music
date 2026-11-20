// The song list's row projection is SQL written by hand, outside the compiler, so it can drift
// from the schema without any typecheck noticing. This test is what catches that.

import { describe, expect, it } from 'vitest'
import { and, leaf } from '@x-tech-laboratories/x-libs/filter'
import { group_tracks, query_tracks } from '@shared/library/store'
import { make_corpus } from './corpus.ts'
import { fresh_db, load_corpus } from './sqlite.ts'

describe('song list row projection', () => {
  it('resolves every displayed column against the real schema', () => {
    const corpus = make_corpus(50, 9)
    const db = fresh_db()
    load_corpus(db, corpus)

    const rows = query_tracks(db, {
      filter: and(),
      sort: [{ field: 'album' }, { field: 'track_number' }],
      limit: 10
    })
    expect(rows.length).toBeGreaterThan(0)

    for (const key of ['id', 'title', 'album', 'artist', 'year', 'track_number',
                       'length_ms', 'rating', 'play_count']) {
      expect(Object.hasOwn(rows[0]!, key), `projection is missing ${key}`).toBe(true)
    }

    // Album and artist must actually resolve, not come back null for everything.
    expect(rows.some((r) => r.album !== null)).toBe(true)
    expect(rows.some((r) => r.artist !== null)).toBe(true)
    db.close()
  })

  it('still projects correctly under a filter that joins other tables', () => {
    const corpus = make_corpus(50, 11)
    const db = fresh_db()
    load_corpus(db, corpus)

    expect(() => query_tracks(db, { filter: and(leaf('genre', 'any', ['Jazz', 'Rock']), leaf('codec', 'is', 'flac')) })).not.toThrow()
    db.close()
  })

  it('pages with an offset and groups a set field by its values', () => {
    const corpus = make_corpus(50, 13)
    const db = fresh_db()
    load_corpus(db, corpus)

    const all = query_tracks(db, { filter: and(), sort: [{ field: 'title' }] })
    const page = query_tracks(db, { filter: and(), sort: [{ field: 'title' }], limit: 5, offset: 5 })
    const groups = group_tracks(db, { filter: and(), field: 'genre' })

    expect(page.map((row) => row.id)).toEqual(all.slice(5, 10).map((row) => row.id))
    expect(groups.map((group) => group.label)).toContain('Jazz')
    expect(typeof groups[0]!.group_id).toBe('string')
    db.close()
  })

  it('lists a seeded random sort in the same order every time, and a new seed in another', () => {
    const corpus = make_corpus(50, 17)
    const db = fresh_db()
    load_corpus(db, corpus)

    const order = (seed: number): string[] => query_tracks(db, { filter: and(), sort: [{ field: 'random', seed }] }).map((row) => row.id)

    expect(order(1234)).toEqual(order(1234))
    expect(order(1234)).toHaveLength(50)
    expect(order(1234)).not.toEqual(order(4321))
    db.close()
  })

  it('sorts by a field with several values, by each track\'s first value, both ways, with tracks that have none last', () => {
    const corpus = make_corpus(200, 19)
    const db = fresh_db()
    load_corpus(db, corpus)
    const first_value = new Map(corpus.tracks.map((track) => [track.id, track]))

    for (const [field, field_id] of [['artist', 1], ['album_artist', 2], ['genre', 4], ['mood', 6]] as const) {
      for (const descending of [false, true]) {
        const listed = query_tracks(db, { filter: and(), sort: [{ field, descending }] })
          .map((row) => first_value.get(row.id)!.sets[field_id]![0] ?? null)
        const present = listed.filter((value) => value !== null)
        const expected = [...present].sort()
        if (descending) expected.reverse()

        expect(listed, `${field} ${descending ? 'descending' : 'ascending'}`).toEqual([...expected, ...listed.filter((value) => value === null)])
        expect(new Set(present).size, `${field} has several values to sort`).toBeGreaterThan(1)
      }
    }
    db.close()
  })
})
