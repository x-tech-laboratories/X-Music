// The performance budget from DESIGN-SPEC §12, expressed as runnable benchmarks. These exist so a
// regression shows up as a number rather than as a vague feeling that the app got slower.

import { test } from 'vitest'

import { compile_filter, compile_group_by } from '@shared/query/compile'
import { select_ids } from '@shared/query/evaluate'
import { and, or, leaf, not } from '@shared/filter'
import { make_corpus, FIXED_NOW } from '../tests/corpus.ts'
import { fresh_db, load_corpus } from '../tests/sqlite.ts'

const SIZE = Number(process.env.X_MUSIC_BENCH_SIZE ?? 50_000)

const corpus = make_corpus(SIZE, 2024)
const db = fresh_db()
load_corpus(db, corpus)

const SIMPLE = leaf('rating', '>=', 80)
const COMPOUND = and(
  leaf('rating', '>=', 60),
  leaf('genre', 'any', ['Jazz', 'Blues']),
  leaf('last_played', 'not_in_last', { n: 30, unit: 'day' }),
  or(leaf('year', 'between', [1955, 1975]), leaf('tags', 'any', ['essential'])),
  not(leaf('codec', 'is', 'mp3'))
)

const run = (node: Parameters<typeof compile_filter>[0]): void => {
  const { sql, params } = compile_filter(node, { now: FIXED_NOW })
  db.prepare(sql).all(...params)
}

// Each test times its benchmarks side by side through vitest's bench fixture.
test(`SQL filter over ${SIZE.toLocaleString()} tracks (budget: 100ms)`, async ({ bench }) => {
  await bench.compare(
    bench('simple scalar predicate', () => run(SIMPLE)),
    bench('compound predicate with sets, dates and negation', () => run(COMPOUND)),
    bench('full-library scan', () => run(and()))
  )
})

test(`native predicate over ${SIZE.toLocaleString()} tracks (budget: 100ms)`, async ({ bench }) => {
  await bench.compare(
    bench('simple scalar predicate', () => {
      select_ids(SIMPLE, corpus.tracks, { now: FIXED_NOW })
    }),
    bench('compound predicate with sets, dates and negation', () => {
      select_ids(COMPOUND, corpus.tracks, { now: FIXED_NOW })
    })
  )
})

test(`group-by over ${SIZE.toLocaleString()} tracks (budget: 100ms)`, async ({ bench }) => {
  await bench.compare(
    bench('group by genre (multi-value)', () => {
      const { sql, params } = compile_group_by(and(), 'genre', FIXED_NOW)
      db.prepare(sql).all(...params)
    }),
    bench('group by year (scalar)', () => {
      const { sql, params } = compile_group_by(and(), 'year', FIXED_NOW)
      db.prepare(sql).all(...params)
    })
  )
})

test(`sort over ${SIZE.toLocaleString()} tracks (budget: 150ms)`, async ({ bench }) => {
  await bench('sort by album then track number', () => {
    const { sql, params } = compile_filter(and(), {
      now: FIXED_NOW,
      sort: [{ field: 'album' }, { field: 'track_number' }]
    })
    db.prepare(sql).all(...params)
  }).run()
})
