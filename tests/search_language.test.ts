// The search bar's language over the real library: field names and units as X-Music reads them, and each kind of
// term run as SQL against a library, plain words through the full-text index.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { field } from '@shared/fields'
import { create_upserter } from '@shared/library/identity'
import { query_tracks } from '@shared/library/store'
import { write_set } from '@shared/library/values'
import { full_text, parse_length, parse_rating, parse_search, search_fields, set_fields_named } from '@shared/query/search'
import { fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb

beforeEach(() => { db = fresh_db() })
afterEach(() => db.close())

// ============================================================================
// Reading values
// ============================================================================

describe('values in the search bar', () => {
  it('reads ratings up to 5 as stars and above that as stored', () => {
    expect(parse_rating('3')).toBe(60)
    expect(parse_rating('4.5')).toBe(90)
    expect(parse_rating('80')).toBe(80)
    expect(parse_rating('101')).toBeNull()
    expect(parse_rating('lots')).toBeNull()
  })

  it('reads lengths as clock times, spelled out or plain seconds, in milliseconds', () => {
    expect(parse_length('4:05')).toBe(245_000)
    expect(parse_length('1:02:03')).toBe(3_723_000)
    expect(parse_length('4m')).toBe(240_000)
    expect(parse_length('1m30s')).toBe(90_000)
    expect(parse_length('90')).toBe(90_000)
    expect(parse_length('')).toBeNull()
    expect(parse_length('soon')).toBeNull()
  })

  it('knows each field by its id, its name and the short names people type', () => {
    const names = (id: string) => search_fields().find((entry) => entry.field === id)!.names

    expect(names('last_played')).toEqual(expect.arrayContaining(['last_played', 'played']))
    expect(names('album_artist')).toEqual(expect.arrayContaining(['album_artist', 'albumartist']))
    expect(names('tags')).toEqual(expect.arrayContaining(['labels', 'label']))
  })

  it('quotes words for the full-text index, matching the last as a prefix', () => {
    expect(full_text('say "hi"')).toEqual({ field: 'title', op: 'matches', value: '"say ""hi"""*' })
  })

  it('names the set fields a search uses, so their values can be fetched first', () => {
    expect(set_fields_named('blue Genre:jazz -artist=miles rating:>3 genre:soul')).toEqual(['genre', 'artist'])
  })
})

// ============================================================================
// Against a library
// ============================================================================

function track(title: string, columns: Record<string, number | null>, sets: Record<string, string[]>): string {
  const id = create_upserter(db)({ title, sets: { artist: sets.artist ?? [] } }, { uri: `/music/${title}.flac` }, { metadata: true }).track_id
  for (const [name, values] of Object.entries(sets)) write_set(db, id, field(name).field_id!, values)
  const names = Object.keys(columns)
  if (names.length > 0) db.prepare(`UPDATE tracks SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(columns), id)
  return id
}

describe('searching a library', () => {
  it('finds tracks by words, fields, units and negation, as one filter', () => {
    const so_what = track('So What', { rating: 100, year: 1959, length_ms: 545_000 }, { artist: ['Miles Davis'], genre: ['Jazz'] })
    const live = track('Live at the Fillmore', { rating: 60, year: 1968, length_ms: 200_000 }, { artist: ['The Allman Brothers'], genre: ['Blues'] })
    const groove = track('Groove Live', { rating: null, year: 1994, length_ms: 300_000 }, { artist: ['Us3'], genre: ['Acid Jazz'] })
    const values = { genre: ['Jazz', 'Blues', 'Acid Jazz'], artist: ['Miles Davis', 'The Allman Brothers', 'Us3'] }
    const found = (text: string) => query_tracks(db, { filter: parse_search(text, values).node }).map((row) => row.id).sort()

    expect(found('live')).toEqual([live, groove].sort())
    expect(found('mil')).toEqual([so_what])
    expect(found('live -genre:blues')).toEqual([groove])
    expect(found('genre:jazz')).toEqual([so_what, groove].sort())
    expect(found('genre=JAZZ')).toEqual([so_what])
    expect(found('rating:>=3 year:1950..1970')).toEqual([so_what, live].sort())
    expect(found('length:>4:00')).toEqual([so_what, groove].sort())
    expect(found('artist:"miles davis"')).toEqual([so_what])
    expect(found('')).toEqual([so_what, live, groove].sort())
  })
})
