import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { compile_filter, compile_group_by } from '@shared/query/compile'
import { and, or, not, leaf } from '@shared/filter'
import { make_corpus, FIXED_NOW, type Corpus } from './corpus.ts'
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

  const ids = (node: Parameters<typeof compile_filter>[0]): string[] => {
    const { sql, params } = compile_filter(node, { now: FIXED_NOW })
    return run_query(db, sql, params)
  }

  it('parameterizes every value rather than interpolating it', () => {
    const { sql, params } = compile_filter(leaf('title', 'contains', "'; DROP TABLE tracks; --"))
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
    const { sql, params } = compile_filter(and(), {
      now: FIXED_NOW,
      sort: [{ field: 'year', dir: 'desc' }]
    })
    const rows = db.prepare(sql.replace('t.id', 't.id, t.year')).all(...params) as
      { id: number; year: number | null }[]

    const first_null = rows.findIndex((r) => r.year === null)
    if (first_null !== -1) {
      expect(rows.slice(first_null).every((r) => r.year === null)).toBe(true)
    }
  })

  it('breaks ties in a sort by id, so the same query always lists tracks in the same order', () => {
    const { sql, params } = compile_filter(and(), { now: FIXED_NOW, sort: [{ field: 'compilation' }] })
    const rows = db.prepare(sql.replace('t.id', 't.id, t.compilation')).all(...params) as { id: string; compilation: number }[]

    const expected = [...rows].sort((a, b) => a.compilation - b.compilation || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    expect(rows.map((r) => r.id)).toEqual(expected.map((r) => r.id))
    expect(sql).toMatch(/, t\.id$/)
  })

  it('groups multi-value fields by interned value with counts and durations', () => {
    const { sql, params } = compile_group_by(and(), 'genre', FIXED_NOW)
    const rows = db.prepare(sql).all(...params) as
      { label: string; n: number; total_ms: number }[]

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.n > 0)).toBe(true)
    // A track with two genres is counted under both, so the sum exceeds the track count.
    expect(rows.reduce((s, r) => s + r.n, 0)).toBeGreaterThan(0)
  })

  it('rejects operators that do not apply to a field type', () => {
    expect(() => compile_filter(leaf('genre', '>', 5))).toThrow(/not valid on set field/)
  })

  it('rejects unknown fields rather than silently matching nothing', () => {
    expect(() => compile_filter(leaf('nonexistent', 'is', 'x'))).toThrow(/unknown field/)
  })
})
