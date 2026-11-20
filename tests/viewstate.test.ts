// Remembered browse state can outlive the fields it names. Restoring it blindly would either crash
// the view or filter the library to nothing for no visible reason, so this drops what it cannot
// recognise rather than trusting what was stored.

import { describe, expect, it } from 'vitest'
import { sanitize_pane_field, sanitize_pane_values, sanitize_sort_keys, seed_random_sort } from '@shared/viewstate'

describe('sanitizeSortKeys', () => {
  it('keeps valid keys and normalises direction', () => {
    expect(sanitize_sort_keys([{ field: 'album', descending: true }, { field: 'year' }]))
      .toEqual([{ field: 'album', descending: true }, { field: 'year', descending: false }])
  })

  it('reads keys an earlier version saved with dir', () => {
    expect(sanitize_sort_keys([{ field: 'album', dir: 'desc' }, { field: 'year', dir: 'asc' }]))
      .toEqual([{ field: 'album', descending: true }, { field: 'year', descending: false }])
  })

  it('keeps a random sort\'s seed', () => {
    expect(sanitize_sort_keys([{ field: 'random', seed: 7 }])).toEqual([{ field: 'random', descending: false, seed: 7 }])
  })

  it('drops keys naming a field that no longer exists', () => {
    expect(sanitize_sort_keys([{ field: 'album' }, { field: 'a_deleted_user_field' }]))
      .toEqual([{ field: 'album', descending: false }])
  })

  it('keeps the random pseudo-field, which the catalogue does not contain', () => {
    expect(sanitize_sort_keys([{ field: 'random' }])).toEqual([{ field: 'random', descending: false }])
  })

  it('drops duplicates, which would make sort priority ambiguous', () => {
    expect(sanitize_sort_keys([{ field: 'album' }, { field: 'album', descending: true }]))
      .toEqual([{ field: 'album', descending: false }])
  })

  it('returns nothing for a value of the wrong shape', () => {
    for (const bad of [null, 'album', 42, { field: 'album' }]) {
      expect(sanitize_sort_keys(bad)).toEqual([])
    }
    expect(sanitize_sort_keys([null, 'x', 7])).toEqual([])
  })
})

describe('sanitizePaneValues', () => {
  it('keeps values for known fields', () => {
    expect(sanitize_pane_values({ genre: ['Jazz', 'Blues'] })).toEqual({ genre: ['Jazz', 'Blues'] })
  })

  it('drops unknown fields rather than filtering on something meaningless', () => {
    expect(sanitize_pane_values({ genre: ['Jazz'], gone: ['x'] })).toEqual({ genre: ['Jazz'] })
  })

  it('drops empty selections, which would filter to nothing', () => {
    expect(sanitize_pane_values({ genre: [], album: ['', ''] })).toEqual({})
  })

  it('ignores non-string values', () => {
    expect(sanitize_pane_values({ genre: ['Jazz', 5, null] })).toEqual({ genre: ['Jazz'] })
  })

  it('returns nothing for a value of the wrong shape', () => {
    for (const bad of [null, [], 'genre', 3]) expect(sanitize_pane_values(bad)).toEqual({})
  })
})

describe('sanitizePaneField', () => {
  it('keeps a known field and falls back otherwise', () => {
    expect(sanitize_pane_field('album_artist', 'genre')).toBe('album_artist')
    expect(sanitize_pane_field('nope', 'genre')).toBe('genre')
    expect(sanitize_pane_field(undefined, 'genre')).toBe('genre')
  })
})

describe('seed_random_sort', () => {
  it('gives a random key without a seed a new one', () => {
    expect(seed_random_sort([{ field: 'album' }, { field: 'random' }], [], () => 99))
      .toEqual([{ field: 'album' }, { field: 'random', seed: 99 }])
  })

  it('keeps the seed the sort already had, so the shuffle stays the same', () => {
    expect(seed_random_sort([{ field: 'random', descending: true }], [{ field: 'random', seed: 5 }], () => 99))
      .toEqual([{ field: 'random', descending: true, seed: 5 }])
  })

  it('leaves a key that has a seed, and every other key, as it is', () => {
    const keys = [{ field: 'random', seed: 3 }, { field: 'year', descending: true }]
    expect(seed_random_sort(keys, [{ field: 'random', seed: 5 }], () => 99)).toEqual(keys)
  })
})
