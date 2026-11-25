// The full-text index kept in step with the library by triggers: a track is found by its title, artists, album, album
// artist, genres, comment and lyrics as soon as any of them changes, and is gone from it once deleted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { leaf } from '@x-tech-laboratories/x-libs/filter'
import { field } from '@shared/fields'
import { create_upserter } from '@shared/library/identity'
import { clear_library, group_tracks, open_library, query_tracks } from '@shared/library/store'
import { set_extra, write_set } from '@shared/library/values'
import { legacy_library } from './legacy.ts'
import { fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb

beforeEach(() => { db = fresh_db() })
afterEach(() => db.close())

// ============================================================================
// Helpers
// ============================================================================

function found(database: TestDb, words: string): string[] {
  return query_tracks(database, { filter: leaf('title', 'matches', words) }).map((row) => row.id)
}

function track(title: string, album: string | null = null, artists: string[] = ['Miles Davis']): string {
  return create_upserter(db)({ title, album, artist: artists[0] ?? null, sets: { artist: artists } }, { uri: `/music/${title}.flac` }, { metadata: true }).track_id
}

const id_of = (name: string): number => field(name).field_id!

// ============================================================================
// Keeping in step
// ============================================================================

describe('the search index', () => {
  it('finds a new track by its title, artist and album', () => {
    const id = track('So What', 'Kind of Blue')

    expect(found(db, 'what')).toEqual([id])
    expect(found(db, 'davis')).toEqual([id])
    expect(found(db, 'kind')).toEqual([id])
  })

  it('follows a changed title, and forgets the old one', () => {
    const id = track('So What')
    db.prepare("UPDATE tracks SET title = 'Freddie Freeloader' WHERE id = ?").run(id)

    expect(found(db, 'freeloader')).toEqual([id])
    expect(found(db, 'what')).toEqual([])
  })

  it('follows genres, album artists and artists as they are set and taken away', () => {
    const id = track('So What', null, ['Miles Davis'])
    write_set(db, id, id_of('genre'), ['Modal Jazz'])
    write_set(db, id, id_of('album_artist'), ['Columbia Sextet'])

    expect(found(db, 'modal')).toEqual([id])
    expect(found(db, 'sextet')).toEqual([id])

    write_set(db, id, id_of('genre'), [])
    write_set(db, id, id_of('artist'), ['John Coltrane'])

    expect(found(db, 'modal')).toEqual([])
    expect(found(db, 'davis')).toEqual([])
    expect(found(db, 'coltrane')).toEqual([id])
  })

  it('follows comments and lyrics, and nothing else kept beside the track', () => {
    const id = track('So What')
    set_extra(db, id, id_of('comment'), 'recorded in one take')
    set_extra(db, id, id_of('lyrics'), 'no words at all')

    expect(found(db, 'take')).toEqual([id])
    expect(found(db, 'words')).toEqual([id])

    set_extra(db, id, id_of('comment'), null)
    expect(found(db, 'take')).toEqual([])
  })

  it('follows an album renamed, for every track on it', () => {
    const first = track('So What', 'Kind of Blue')
    const second = track('Blue in Green', 'Kind of Blue')
    db.prepare("UPDATE albums SET name = 'Sketches' WHERE name = 'Kind of Blue'").run()

    expect(found(db, 'sketches').sort()).toEqual([first, second].sort())
  })

  it('forgets a deleted track, and everything when the library is cleared', () => {
    const kept = track('So What')
    const deleted = track('So Long')
    db.prepare('DELETE FROM tracks WHERE id = ?').run(deleted)

    expect(found(db, 'so')).toEqual([kept])

    clear_library(db)
    expect(found(db, 'so')).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM tracks_fts').get()).toEqual({ n: 0 })
  })

  it('folds case and accents', () => {
    const id = track('Café Society')

    expect(found(db, 'CAFE')).toEqual([id])
  })
})

// ============================================================================
// Upgrading
// ============================================================================

describe('the search index of an upgraded library', () => {
  it('holds the tracks that were there before the upgrade', () => {
    const old = legacy_library()
    open_library(old)

    expect(found(old, 'survivor')).toHaveLength(1)
    old.close()
  })
})

describe('rebuilding stale search rows', () => {
  it('rebuilds a changed track once, when the library is next searched', () => {
    const id = track('So What', 'Kind of Blue', ['Miles Davis', 'John Coltrane'])
    const stale = () => (db.prepare('SELECT COUNT(*) AS n FROM track_search_stale').get() as { n: number }).n

    expect(stale()).toBe(1)
    expect(found(db, 'coltrane')).toEqual([id])
    expect(stale()).toBe(0)
  })

  it('rebuilds them before a pane counts its values too', () => {
    const id = track('So What')
    db.prepare("UPDATE tracks SET title = 'Freddie Freeloader' WHERE id = ?").run(id)

    expect(group_tracks(db, { filter: leaf('title', 'matches', 'freeloader'), field: 'year' }).reduce((total, group) => total + group.count, 0)).toBe(1)
  })
})
