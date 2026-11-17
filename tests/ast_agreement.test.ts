// The non-negotiable test (DESIGN-SPEC §13): for any generated filter over any generated library,
// the SQL compiler and the native predicate must return identical id sets. This is the only thing
// that keeps the fast path honest as it diverges from the durable one.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fc from 'fast-check'

import { compile_filter } from '@shared/query/compile'
import { select_ids } from '@shared/query/evaluate'
import { filter_arb } from './arbitraries.ts'
import { make_corpus, type Corpus } from './corpus.ts'
import { fresh_db, load_corpus, run_query, type TestDb } from './sqlite.ts'

describe('filter AST: SQL and native predicate agree', () => {
  let db: TestDb
  let corpus: Corpus

  beforeAll(() => {
    corpus = make_corpus(400, 1337)
    db = fresh_db()
    load_corpus(db, corpus)
  })

  afterAll(() => db.close())

  it('returns identical id sets for arbitrary filters', () => {
    fc.assert(
      fc.property(filter_arb, (filter) => {
        const { sql, params } = compile_filter(filter, { now: corpus.now })
        const via_sql = run_query(db, sql, params).sort()
        const via_native = select_ids(filter, corpus.tracks, { now: corpus.now }).sort()

        expect(via_native).toEqual(via_sql)
      }),
      { numRuns: 500 }
    )
  })

  it('serialization round-trips without changing results', () => {
    fc.assert(
      fc.property(filter_arb, (filter) => {
        const revived = JSON.parse(JSON.stringify(filter))
        const a = compile_filter(filter, { now: corpus.now })
        const b = compile_filter(revived, { now: corpus.now })
        expect(b.sql).toEqual(a.sql)
        expect(b.params).toEqual(a.params)
      }),
      { numRuns: 200 }
    )
  })
})
