// Remembered browse state can outlive the fields it names. Restoring it blindly would either crash
// the view or filter the library to nothing for no visible reason, so this drops what it cannot
// recognise rather than trusting what was stored.

import { describe, expect, it } from 'vitest'
import { sanitize_pane_field, sanitize_pane_values, sanitize_sort_keys } from '@shared/viewstate'

describe('sanitizeSortKeys', () => {
  it('keeps valid keys and normalises direction', () => {
    expect(sanitize_sort_keys([{ field: 'album', dir: 'desc' }, { field: 'year' }]))
      .toEqual([{ field: 'album', dir: 'desc' }, { field: 'year', dir: 'asc' }])
  })

  it('drops keys naming a field that no longer exists', () => {
    expect(sanitize_sort_keys([{ field: 'album' }, { field: 'a_deleted_user_field' }]))
      .toEqual([{ field: 'album', dir: 'asc' }])
  })

  it('keeps the random pseudo-field, which the catalogue does not contain', () => {
    expect(sanitize_sort_keys([{ field: 'random' }])).toEqual([{ field: 'random', dir: 'asc' }])
  })

  it('drops duplicates, which would make sort priority ambiguous', () => {
    expect(sanitize_sort_keys([{ field: 'album' }, { field: 'album', dir: 'desc' }]))
      .toEqual([{ field: 'album', dir: 'asc' }])
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
