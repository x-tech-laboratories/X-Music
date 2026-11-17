// Remembered browse state can outlive the fields it names. Restoring it blindly would either crash
// the view or filter the library to nothing for no visible reason, so this drops what it cannot
// recognise rather than trusting what was stored.

import { describe, expect, it } from 'vitest'
import { sanitizePaneField, sanitizePaneValues, sanitizeSortKeys } from '@shared/viewstate'

describe('sanitizeSortKeys', () => {
  it('keeps valid keys and normalises direction', () => {
    expect(sanitizeSortKeys([{ field: 'album', dir: 'desc' }, { field: 'year' }]))
      .toEqual([{ field: 'album', dir: 'desc' }, { field: 'year', dir: 'asc' }])
  })

  it('drops keys naming a field that no longer exists', () => {
    expect(sanitizeSortKeys([{ field: 'album' }, { field: 'a_deleted_user_field' }]))
      .toEqual([{ field: 'album', dir: 'asc' }])
  })

  it('keeps the random pseudo-field, which the catalogue does not contain', () => {
    expect(sanitizeSortKeys([{ field: 'random' }])).toEqual([{ field: 'random', dir: 'asc' }])
  })

  it('drops duplicates, which would make sort priority ambiguous', () => {
    expect(sanitizeSortKeys([{ field: 'album' }, { field: 'album', dir: 'desc' }]))
      .toEqual([{ field: 'album', dir: 'asc' }])
  })

  it('returns nothing for a value of the wrong shape', () => {
    for (const bad of [null, 'album', 42, { field: 'album' }]) {
      expect(sanitizeSortKeys(bad)).toEqual([])
    }
    expect(sanitizeSortKeys([null, 'x', 7])).toEqual([])
  })
})

describe('sanitizePaneValues', () => {
  it('keeps values for known fields', () => {
    expect(sanitizePaneValues({ genre: ['Jazz', 'Blues'] })).toEqual({ genre: ['Jazz', 'Blues'] })
  })

  it('drops unknown fields rather than filtering on something meaningless', () => {
    expect(sanitizePaneValues({ genre: ['Jazz'], gone: ['x'] })).toEqual({ genre: ['Jazz'] })
  })

  it('drops empty selections, which would filter to nothing', () => {
    expect(sanitizePaneValues({ genre: [], album: ['', ''] })).toEqual({})
  })

  it('ignores non-string values', () => {
    expect(sanitizePaneValues({ genre: ['Jazz', 5, null] })).toEqual({ genre: ['Jazz'] })
  })

  it('returns nothing for a value of the wrong shape', () => {
    for (const bad of [null, [], 'genre', 3]) expect(sanitizePaneValues(bad)).toEqual({})
  })
})

describe('sanitizePaneField', () => {
  it('keeps a known field and falls back otherwise', () => {
    expect(sanitizePaneField('album_artist', 'genre')).toBe('album_artist')
    expect(sanitizePaneField('nope', 'genre')).toBe('genre')
    expect(sanitizePaneField(undefined, 'genre')).toBe('genre')
  })
})
