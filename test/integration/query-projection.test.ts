// The song list's row projection is SQL written by hand, outside the compiler, so it can drift
// from the schema without any typecheck noticing. This test is what catches that.

import { describe, expect, it } from 'vitest'
import { and, leaf } from '@shared/filter'
import { group_tracks, query_tracks } from '@shared/library/store'
import { makeCorpus } from '../helpers/corpus'
import { freshDb, loadCorpus } from '../helpers/sqlite'

describe('song list row projection', () => {
  it('resolves every displayed column against the real schema', () => {
    const corpus = makeCorpus(50, 9)
    const db = freshDb()
    loadCorpus(db, corpus)

    const rows = query_tracks(db, {
      filter: and(),
      sort: [{ field: 'album' }, { field: 'track_number' }],
      limit: { count: 10 }
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
    const corpus = makeCorpus(50, 11)
    const db = freshDb()
    loadCorpus(db, corpus)

    expect(() => query_tracks(db, { filter: and(leaf('genre', 'any', ['Jazz', 'Rock']), leaf('codec', 'is', 'flac')) })).not.toThrow()
    db.close()
  })

  it('pages with an offset and groups a set field by its values', () => {
    const corpus = makeCorpus(50, 13)
    const db = freshDb()
    loadCorpus(db, corpus)

    const all = query_tracks(db, { filter: and(), sort: [{ field: 'title' }] })
    const page = query_tracks(db, { filter: and(), sort: [{ field: 'title' }], limit: { count: 5 }, offset: 5 })
    const groups = group_tracks(db, { filter: and(), field: 'genre' })

    expect(page.map((row) => row.id)).toEqual(all.slice(5, 10).map((row) => row.id))
    expect(groups.map((group) => group.label)).toContain('Jazz')
    expect(typeof groups[0]!.gid).toBe('string')
    db.close()
  })
})
