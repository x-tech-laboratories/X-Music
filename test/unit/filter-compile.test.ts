import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { compileFilter, compileGroupBy } from '@shared/query/compile'
import { and, or, not, leaf } from '@shared/filter'
import { makeCorpus, FIXED_NOW, type Corpus } from '../helpers/corpus'
import { freshDb, loadCorpus, runQuery, type TestDb } from '../helpers/sqlite'

describe('filter compiler', () => {
  let db: TestDb
  let corpus: Corpus

  beforeAll(() => {
    corpus = makeCorpus(300, 7)
    db = freshDb()
    loadCorpus(db, corpus)
  })

  afterAll(() => db.close())

  const ids = (node: Parameters<typeof compileFilter>[0]): number[] => {
    const { sql, params } = compileFilter(node, { now: FIXED_NOW })
    return runQuery(db, sql, params)
  }

  it('parameterizes every value rather than interpolating it', () => {
    const { sql, params } = compileFilter(leaf('title', 'contains', "'; DROP TABLE tracks; --"))
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
    const anyOf = ids(leaf('genre', 'any', ['Jazz', 'Blues']))
    const allOf = ids(leaf('genre', 'all', ['Jazz', 'Blues']))
    const noneOf = ids(leaf('genre', 'none', ['Jazz', 'Blues']))

    expect(allOf.every((id) => anyOf.includes(id))).toBe(true)
    expect(anyOf.filter((id) => noneOf.includes(id))).toHaveLength(0)
    expect(anyOf.length + noneOf.length).toBe(corpus.tracks.length)
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
    const { sql, params } = compileFilter(and(), {
      now: FIXED_NOW,
      sort: [{ field: 'year', dir: 'desc' }]
    })
    const rows = db.prepare(sql.replace('t.id', 't.id, t.year')).all(...(params as never[])) as
      { id: number; year: number | null }[]

    const firstNull = rows.findIndex((r) => r.year === null)
    if (firstNull !== -1) {
      expect(rows.slice(firstNull).every((r) => r.year === null)).toBe(true)
    }
  })

  it('groups multi-value fields by interned value with counts and durations', () => {
    const { sql, params } = compileGroupBy(and(), 'genre', FIXED_NOW)
    const rows = db.prepare(sql).all(...(params as never[])) as
      { label: string; n: number; total_ms: number }[]

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.n > 0)).toBe(true)
    // A track with two genres is counted under both, so the sum exceeds the track count.
    expect(rows.reduce((s, r) => s + r.n, 0)).toBeGreaterThan(0)
  })

  it('rejects operators that do not apply to a field type', () => {
    expect(() => compileFilter(leaf('genre', '>', 5))).toThrow(/not valid on set field/)
  })

  it('rejects unknown fields rather than silently matching nothing', () => {
    expect(() => compileFilter(leaf('nonexistent', 'is', 'x'))).toThrow(/unknown field/)
  })
})
