// Field descriptors are data that a library file depends on. A reused field id silently corrupts
// every library already on disk, so these tests are a compatibility lock, not a style check.

import { describe, expect, it } from 'vitest'
import { BUILTIN_FIELDS, field, fieldsWith, ratingToStars, starsToRating } from '@shared/fields'

describe('field catalogue', () => {
  it('has unique field ids', () => {
    const ids = BUILTIN_FIELDS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique numeric fieldIds across multi and extra storage', () => {
    const numeric = BUILTIN_FIELDS.filter((d) => d.fieldId !== undefined).map((d) => d.fieldId!)
    expect(new Set(numeric).size).toBe(numeric.length)
  })

  it('gives every multi and extra field a stable numeric id', () => {
    for (const d of BUILTIN_FIELDS) {
      if (d.storage === 'multi' || d.storage === 'extra') {
        expect(d.fieldId, `${d.id} needs a fieldId`).toBeTypeOf('number')
      }
    }
  })

  it('pins the numeric ids that existing libraries already reference', () => {
    // Changing any of these renumbers data already written to disk.
    expect(field('artist').fieldId).toBe(1)
    expect(field('album_artist').fieldId).toBe(2)
    expect(field('composer').fieldId).toBe(3)
    expect(field('genre').fieldId).toBe(4)
    expect(field('grouping').fieldId).toBe(5)
    expect(field('mood').fieldId).toBe(6)
    expect(field('tags').fieldId).toBe(7)
    expect(field('comment').fieldId).toBe(20)
    expect(field('lyrics').fieldId).toBe(21)
  })

  it('gives every computed field an expression', () => {
    for (const d of BUILTIN_FIELDS) {
      if (d.storage === 'computed') expect(d.expr, `${d.id} needs an expr`).toBeTruthy()
    }
  })

  it('exposes the set of fields a UI can offer per capability', () => {
    expect(fieldsWith('groupable').length).toBeGreaterThan(5)
    expect(fieldsWith('writable').every((d) => d.tags !== undefined)).toBe(true)
  })

  it('throws on an unknown field rather than returning undefined', () => {
    expect(() => field('no_such_field')).toThrow(/unknown field/)
  })
})

describe('rating conversion', () => {
  it('maps five stars onto the 0-100 storage range', () => {
    expect(starsToRating(0)).toBe(0)
    expect(starsToRating(3)).toBe(60)
    expect(starsToRating(5)).toBe(100)
  })

  it('keeps unrated distinct from zero', () => {
    expect(ratingToStars(null)).toBeNull()
    expect(ratingToStars(0)).toBe(0)
  })

  it('round-trips every whole-star value', () => {
    for (let s = 0; s <= 5; s++) expect(ratingToStars(starsToRating(s))).toBe(s)
  })
})
