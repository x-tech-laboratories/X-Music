// Field descriptors are data that a library file depends on. A reused field id silently corrupts
// every library already on disk, so these tests are a compatibility lock, not a style check.

import { describe, expect, it } from 'vitest'
import { BUILTIN_FIELDS, field, fields_with, rating_to_stars, stars_to_rating } from '@shared/fields'

describe('field catalogue', () => {
  it('has unique field ids', () => {
    const ids = BUILTIN_FIELDS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique numeric fieldIds across multi and extra storage', () => {
    const numeric = BUILTIN_FIELDS.filter((d) => d.field_id !== undefined).map((d) => d.field_id!)
    expect(new Set(numeric).size).toBe(numeric.length)
  })

  it('gives every multi and extra field a stable numeric id', () => {
    for (const d of BUILTIN_FIELDS) {
      if (d.storage === 'multi' || d.storage === 'extra') {
        expect(d.field_id, `${d.id} needs a field_id`).toBeTypeOf('number')
      }
    }
  })

  it('pins the numeric ids that existing libraries already reference', () => {
    // Changing any of these renumbers data already written to disk.
    expect(field('artist').field_id).toBe(1)
    expect(field('album_artist').field_id).toBe(2)
    expect(field('composer').field_id).toBe(3)
    expect(field('genre').field_id).toBe(4)
    expect(field('grouping').field_id).toBe(5)
    expect(field('mood').field_id).toBe(6)
    expect(field('tags').field_id).toBe(7)
    expect(field('comment').field_id).toBe(20)
    expect(field('lyrics').field_id).toBe(21)
  })

  it('gives every computed field an expression', () => {
    for (const d of BUILTIN_FIELDS) {
      if (d.storage === 'computed') expect(d.expr, `${d.id} needs an expr`).toBeTruthy()
    }
  })

  it('exposes the set of fields a UI can offer per capability', () => {
    expect(fields_with('groupable').length).toBeGreaterThan(5)
    expect(fields_with('writable').every((d) => d.tags !== undefined)).toBe(true)
  })

  it('throws on an unknown field rather than returning undefined', () => {
    expect(() => field('no_such_field')).toThrow(/unknown field/)
  })
})

describe('rating conversion', () => {
  it('maps five stars onto the 0-100 storage range', () => {
    expect(stars_to_rating(0)).toBe(0)
    expect(stars_to_rating(3)).toBe(60)
    expect(stars_to_rating(5)).toBe(100)
  })

  it('keeps unrated distinct from zero', () => {
    expect(rating_to_stars(null)).toBeNull()
    expect(rating_to_stars(0)).toBe(0)
  })

  it('round-trips every whole-star value', () => {
    for (let s = 0; s <= 5; s++) expect(rating_to_stars(stars_to_rating(s))).toBe(s)
  })
})
