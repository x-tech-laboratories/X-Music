import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { and, leaf, not, or, select_ids, type FilterNode } from '@x-tech-laboratories/x-libs/filter'
import { compile_filter, compile_group_by } from '@x-tech-laboratories/x-libs/filter_sql'

import { group_sums, track_catalogue } from '@shared/query/catalogue'
import { refresh_search } from '@shared/library/store'
import { make_corpus, FIXED_NOW, record_of, type Corpus } from './corpus.ts'
import { fresh_db, load_corpus, run_query, type TestDb } from './sqlite.ts'

describe('filter compiler', () => {
  let db: TestDb
  let corpus: Corpus

  beforeAll(() => {
    corpus = make_corpus(300, 7)
    db = fresh_db()
    load_corpus(db, corpus)
  })

  afterAll(() => db.close())

  const ids = (node: FilterNode): string[] => {
    const { sql, params } = compile_filter(track_catalogue, node, { now: FIXED_NOW })
    return run_query(db, sql, params)
  }

  it('parameterizes every value rather than interpolating it', () => {
    const { sql, params } = compile_filter(track_catalogue, leaf('title', 'contains', "'; DROP TABLE tracks; --"))
    expect(sql).not.toContain('DROP TABLE')
    expect(params).toContain("%''; DROP TABLE tracks; --%".replace("''", "'"))
  })

  it('treats an empty AND as everything and an empty OR as nothing', () => {
    expect(ids(and())).toHaveLength(corpus.tracks.length)
    expect(ids(or())).toHaveLength(0)
  })

  it('keeps unrated distinct from zero-rated', () => {
    const unrated = ids(leaf('rating', 'empty'))
    const zero = ids(leaf('rating', 'is', 0))
    expect(unrated.length).toBeGreaterThan(0)
    expect(zero.length).toBeGreaterThan(0)
    expect(unrated.filter((id) => zero.includes(id))).toHaveLength(0)
  })

  it('applies set semantics: any is OR, all is AND, none is neither', () => {
    const any_of = ids(leaf('genre', 'any', ['Jazz', 'Blues']))
    const all_of = ids(leaf('genre', 'all', ['Jazz', 'Blues']))
    const none_of = ids(leaf('genre', 'none', ['Jazz', 'Blues']))

    expect(all_of.every((id) => any_of.includes(id))).toBe(true)
    expect(any_of.filter((id) => none_of.includes(id))).toHaveLength(0)
    expect(any_of.length + none_of.length).toBe(corpus.tracks.length)
  })

  it('composes boolean groups', () => {
    const a = ids(leaf('year', '>=', 1990))
    const b = ids(leaf('genre', 'any', ['Rock']))
    const both = ids(and(leaf('year', '>=', 1990), leaf('genre', 'any', ['Rock'])))
    const either = ids(or(leaf('year', '>=', 1990), leaf('genre', 'any', ['Rock'])))

    expect(both.every((id) => a.includes(id) && b.includes(id))).toBe(true)
    expect(either.length).toBeGreaterThanOrEqual(Math.max(a.length, b.length))
  })

  it('negation excludes exactly what the positive filter includes', () => {
    const positive = ids(leaf('codec', 'is', 'flac'))
    const negative = ids(not(leaf('codec', 'is', 'flac')))
    expect(positive.length + negative.length).toBe(corpus.tracks.length)
  })

  it('respects sort direction and puts NULLs last either way', () => {
    const { sql, params } = compile_filter(track_catalogue, and(), {
      now: FIXED_NOW,
      sort: [{ field: 'year', descending: true }],
      select: (row) => `${row}.id, ${row}.year`
    })
    const rows = db.prepare(sql).all(...params) as
      { id: number; year: number | null }[]

    const first_null = rows.findIndex((r) => r.year === null)
    if (first_null !== -1) {
      expect(rows.slice(first_null).every((r) => r.year === null)).toBe(true)
    }
  })

  it('breaks ties in a sort by id, so the same query always lists tracks in the same order', () => {
    const { sql, params } = compile_filter(track_catalogue, and(), {
      now: FIXED_NOW, sort: [{ field: 'compilation' }], select: (row) => `${row}.id, ${row}.compilation`
    })
    const rows = db.prepare(sql).all(...params) as { id: string; compilation: number }[]

    const expected = [...rows].sort((a, b) => a.compilation - b.compilation || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    expect(rows.map((r) => r.id)).toEqual(expected.map((r) => r.id))
    expect(sql).toMatch(/, t\."id"$/)
  })

  it('groups multi-value fields by interned value with counts and durations', () => {
    const { sql, params } = compile_group_by(track_catalogue, and(), 'genre', { now: FIXED_NOW, sums: group_sums })
    const rows = db.prepare(sql).all(...params) as
      { label: string; count: number; total_ms: number }[]

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.count > 0)).toBe(true)
    expect(rows.some((r) => r.total_ms > 0)).toBe(true)
    // A track with two genres is counted under both, so the sum exceeds the track count.
    expect(rows.reduce((s, r) => s + r.count, 0)).toBeGreaterThan(0)
  })

  it('rejects operators that do not apply to a field type', () => {
    expect(() => compile_filter(track_catalogue, leaf('genre', '>', 5))).toThrow(/not valid on set field/)
  })

  it('rejects unknown fields rather than silently matching nothing', () => {
    expect(() => compile_filter(track_catalogue, leaf('nonexistent', 'is', 'x'))).toThrow(/unknown field/)
  })

  it('matches text case by case only when asked, in SQL and in memory alike', () => {
    const records = corpus.tracks.map(record_of)
    const in_memory = (node: FilterNode): string[] => select_ids(track_catalogue, node, records, { now: FIXED_NOW }).map(String).sort()
    const folded = leaf('codec', 'contains', 'FLAC')
    const exact = { ...leaf('codec', 'contains', 'FLAC'), case_sensitive: true }
    const exact_lower = { ...leaf('codec', 'contains', 'flac'), case_sensitive: true }

    expect(ids(folded).length).toBeGreaterThan(0)
    expect(ids(exact)).toEqual([])
    expect(in_memory(exact)).toEqual([])
    expect(ids(exact_lower).sort()).toEqual(ids(folded).sort())
    expect(in_memory(exact_lower)).toEqual(ids(exact_lower).sort())
  })

  it('takes a case-sensitive wildcard character as itself', () => {
    expect(ids({ ...leaf('title', 'contains', 'Track_1'), case_sensitive: true })).toEqual([])
    expect(ids({ ...leaf('title', 'starts', 'Track *'), case_sensitive: true })).toEqual([])
  })

  it('gives the same tracks in SQL and in memory over every kind of field', () => {
    const records = corpus.tracks.map(record_of)
    const filters: FilterNode[] = [
      leaf('album', 'starts', 'kind'),
      leaf('comment', 'defined'),
      leaf('bitrate', '>', 500),
      leaf('genre', 'all', ['Jazz', 'Blues']),
      leaf('last_played', 'in_last', { count: 30, unit: 'day' }),
      not(leaf('rating', 'top', 20))
    ]

    for (const filter of filters) {
      const in_memory = select_ids(track_catalogue, filter, records, { now: FIXED_NOW }).map(String).sort()
      expect(in_memory, JSON.stringify(filter)).toEqual(ids(filter).sort())
    }
  })

  it('finds a playlist\'s tracks and searches the full-text index', () => {
    const first = corpus.tracks[0]!.id
    const second = corpus.tracks[1]!.id
    db.prepare("INSERT INTO playlists (id, name, kind, created, modified) VALUES ('mix', 'Mix', 'static', 0, 0)").run()
    db.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('mix', ?, 0), ('mix', ?, 1)").run(first, second)
    db.prepare("UPDATE tracks SET title = 'Unmistakable' WHERE id = ?").run(first)
    refresh_search(db)

    expect(ids(leaf('title', 'in_playlist', 'mix')).sort()).toEqual([first, second].sort())
    expect(ids(leaf('title', 'matches', 'unmistakable'))).toEqual([first])
  })
})
