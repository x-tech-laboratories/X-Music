// The non-negotiable test (DESIGN-SPEC §13): for any generated filter over any generated library,
// the SQL compiler and the native predicate must return identical id sets. This is the only thing
// that keeps the fast path honest as it diverges from the durable one.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fc from 'fast-check'

import { compileFilter } from '@shared/query/compile'
import { selectIds } from '@shared/query/evaluate'
import { filterArb } from './arbitraries'
import { makeCorpus, type Corpus } from './corpus'
import { freshDb, loadCorpus, runQuery, type TestDb } from './sqlite'

describe('filter AST: SQL and native predicate agree', () => {
  let db: TestDb
  let corpus: Corpus

  beforeAll(() => {
    corpus = makeCorpus(400, 1337)
    db = freshDb()
    loadCorpus(db, corpus)
  })

  afterAll(() => db.close())

  it('returns identical id sets for arbitrary filters', () => {
    fc.assert(
      fc.property(filterArb, (filter) => {
        const { sql, params } = compileFilter(filter, { now: corpus.now })
        const viaSql = runQuery(db, sql, params).sort()
        const viaNative = selectIds(filter, corpus.tracks, { now: corpus.now }).sort()

        expect(viaNative).toEqual(viaSql)
      }),
      { numRuns: 500 }
    )
  })

  it('serialization round-trips without changing results', () => {
    fc.assert(
      fc.property(filterArb, (filter) => {
        const revived = JSON.parse(JSON.stringify(filter))
        const a = compileFilter(filter, { now: corpus.now })
        const b = compileFilter(revived, { now: corpus.now })
        expect(b.sql).toEqual(a.sql)
        expect(b.params).toEqual(a.params)
      }),
      { numRuns: 200 }
    )
  })
})
