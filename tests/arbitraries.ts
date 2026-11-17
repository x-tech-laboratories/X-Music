// Generators for the AST-agreement property test. The shapes here define what "any filter" means,
// so anything the UI can build should be reachable from these arbitraries.

import fc from 'fast-check'
import type { FilterNode, LeafNode } from '@shared/filter'

const STRING_FIELDS = ['title', 'album', 'codec'] as const
const NUMERIC_FIELDS = ['year', 'rating', 'play_count', 'skip_count', 'bpm', 'bitrate', 'length'] as const
const SET_FIELDS = ['artist', 'album_artist', 'genre', 'mood', 'tags'] as const
const DATE_FIELDS = ['last_played', 'added'] as const
const EXTRA_FIELDS = ['comment'] as const

const GENRES = ['Rock', 'Jazz', 'Blues', 'Electronic', 'Classical', 'Folk', 'Nonexistent']
const MOODS = ['calm', 'energetic', 'melancholy']
const ARTISTS = ['Miles Davis', 'The Beatles', 'Aphex Twin', 'Nina Simone', 'Bill Evans']
const ALBUMS = ['Kind of Blue', 'Revolver', 'Selected Ambient Works', 'Pastel Blues']

const string_leaf: fc.Arbitrary<LeafNode> = fc.record({
  field: fc.constantFrom(...STRING_FIELDS, ...EXTRA_FIELDS),
  op: fc.constantFrom('is', 'not_is', 'contains', 'starts', 'ends', 'empty', 'defined'),
  value: fc.oneof(
    fc.constantFrom(...ALBUMS, 'Track 1', 'flac', 'mp3', 'blue', 'BLUE', 'x'),
    fc.string({ maxLength: 6 })
  )
}).map((r) => (r.op === 'empty' || r.op === 'defined' ? { field: r.field, op: r.op } : r) as LeafNode)

const numeric_leaf: fc.Arbitrary<LeafNode> = fc.oneof(
  fc.record({
    field: fc.constantFrom(...NUMERIC_FIELDS),
    op: fc.constantFrom('is', 'not_is', '>', '<', '>=', '<='),
    value: fc.integer({ min: 0, max: 2100 })
  }),
  fc.record({
    field: fc.constantFrom(...NUMERIC_FIELDS),
    op: fc.constantFrom('between', 'not_between'),
    value: fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 2100 }))
      .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const)
  }),
  fc.record({
    field: fc.constantFrom(...NUMERIC_FIELDS),
    op: fc.constantFrom('empty', 'defined')
  })
) as fc.Arbitrary<LeafNode>

const set_leaf: fc.Arbitrary<LeafNode> = fc.oneof(
  fc.record({
    field: fc.constantFrom(...SET_FIELDS),
    op: fc.constantFrom('any', 'all', 'none'),
    value: fc.uniqueArray(fc.constantFrom(...GENRES, ...MOODS, ...ARTISTS, 'essential'),
                          { minLength: 1, maxLength: 3 })
  }),
  fc.record({
    field: fc.constantFrom(...SET_FIELDS),
    op: fc.constantFrom('count'),
    value: fc.integer({ min: 0, max: 3 })
  }),
  fc.record({
    field: fc.constantFrom(...SET_FIELDS),
    op: fc.constantFrom('empty', 'defined')
  })
) as fc.Arbitrary<LeafNode>

const date_leaf: fc.Arbitrary<LeafNode> = fc.record({
  field: fc.constantFrom(...DATE_FIELDS),
  op: fc.constantFrom('in_last', 'not_in_last'),
  value: fc.record({
    n: fc.integer({ min: 1, max: 400 }),
    unit: fc.constantFrom('hour', 'day', 'week', 'month', 'year')
  })
}) as fc.Arbitrary<LeafNode>

export const leaf_arb: fc.Arbitrary<LeafNode> =
  fc.oneof(string_leaf, numeric_leaf, set_leaf, date_leaf)

export const filter_arb: fc.Arbitrary<FilterNode> = fc.letrec<{ node: FilterNode }>((tie) => ({
  node: fc.oneof(
    { weight: 5, arbitrary: leaf_arb },
    {
      weight: 2,
      arbitrary: fc.record({
        op: fc.constantFrom('and', 'or'),
        children: fc.array(tie('node'), { minLength: 1, maxLength: 3 })
      }) as fc.Arbitrary<FilterNode>
    },
    {
      weight: 1,
      arbitrary: fc.record({
        op: fc.constant('not'),
        children: fc.tuple(tie('node')).map((t) => [...t])
      }) as fc.Arbitrary<FilterNode>
    }
  )
})).node
