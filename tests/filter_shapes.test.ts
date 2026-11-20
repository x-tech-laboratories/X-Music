// Filters, sorts and limits an earlier version saved still work: they are read into today's shapes, and a smart
// playlist's saved filter is rewritten when the library opens.

import { describe, expect, it } from 'vitest'

import { upgrade_definition, upgrade_filter, upgrade_limit, upgrade_sort } from '@shared/filter_shapes'
import { open_library, upgrade_playlist_definitions } from '@shared/library/store'
import { fresh_db } from './sqlite.ts'

// ============================================================================
// Shapes
// ============================================================================

const old_filter = {
  op: 'and',
  children: [
    { field: 'title', op: 'contains', value: 'Blue', cs: true },
    { op: 'not', children: [{ field: 'last_played', op: 'in_last', value: { n: 30, unit: 'day' } }] }
  ]
}

const new_filter = {
  op: 'and',
  children: [
    { field: 'title', op: 'contains', value: 'Blue', case_sensitive: true },
    { op: 'not', children: [{ field: 'last_played', op: 'in_last', value: { count: 30, unit: 'day' } }] }
  ]
}

describe('saved filter shapes', () => {
  it('reads an earlier filter tree into today\'s shape', () => {
    expect(upgrade_filter(old_filter)).toEqual(new_filter)
  })

  it('leaves a filter already in today\'s shape as it is', () => {
    expect(upgrade_filter(new_filter)).toEqual(new_filter)
  })

  it('reads sort keys with dir, and limits as a count', () => {
    expect(upgrade_sort([{ field: 'year', dir: 'desc' }, { field: 'random' }]))
      .toEqual([{ field: 'year', descending: true }, { field: 'random', descending: false }])
    expect(upgrade_limit({ count: 25 })).toBe(25)
    expect(upgrade_limit({ count: 25, by: 'tracks' })).toBe(25)
    expect(upgrade_limit({ count: 3_600_000, by: 'duration' })).toEqual({ count: 3_600_000, by: 'duration' })
    expect(upgrade_limit(25)).toBe(25)
  })

  it('keeps a random sort\'s seed, turning an earlier text seed into the same whole number each time', () => {
    expect(upgrade_sort([{ field: 'random', seed: 42 }])).toEqual([{ field: 'random', descending: false, seed: 42 }])

    const [first] = upgrade_sort([{ field: 'random', seed: 'x' }])
    const [again] = upgrade_sort([{ field: 'random', seed: 'x' }])
    const [other] = upgrade_sort([{ field: 'random', seed: 'y' }])
    expect(Number.isInteger(first!.seed)).toBe(true)
    expect(again).toEqual(first)
    expect(other!.seed).not.toBe(first!.seed)
  })

  it('drops a seed that is not a whole number or text', () => {
    expect(upgrade_sort([{ field: 'random', seed: 1.5 }, { field: 'year', seed: null }]))
      .toEqual([{ field: 'random', descending: false }, { field: 'year', descending: false }])
  })

  it('reads a definition holding a filter with its sort and limit', () => {
    expect(upgrade_definition({ filter: old_filter, sort: [{ field: 'year', dir: 'desc' }], limit: { count: 10 } }))
      .toEqual({ filter: new_filter, sort: [{ field: 'year', descending: true }], limit: 10 })
  })
})

// ============================================================================
// Smart playlists
// ============================================================================

describe('smart playlists saved by an earlier version', () => {
  function add_playlist(db: ReturnType<typeof fresh_db>, id: string, definition: string | null): void {
    db.prepare("INSERT INTO playlists (id, name, kind, definition, created, modified) VALUES (?, ?, 'smart', ?, 0, 0)").run(id, id, definition)
  }

  const definition_of = (db: ReturnType<typeof fresh_db>, id: string): string | null =>
    (db.prepare('SELECT definition FROM playlists WHERE id = ?').get(id) as { definition: string | null }).definition

  it('are rewritten into today\'s shape when the library opens, once', () => {
    const db = fresh_db()
    add_playlist(db, 'old', JSON.stringify(old_filter))
    add_playlist(db, 'new', JSON.stringify(new_filter))
    add_playlist(db, 'broken', '{not json')
    add_playlist(db, 'empty', null)

    open_library(db)

    expect(JSON.parse(definition_of(db, 'old')!)).toEqual(new_filter)
    expect(JSON.parse(definition_of(db, 'new')!)).toEqual(new_filter)
    expect(definition_of(db, 'broken')).toBe('{not json')
    expect(definition_of(db, 'empty')).toBeNull()
    expect(upgrade_playlist_definitions(db)).toBe(0)
    db.close()
  })
})
