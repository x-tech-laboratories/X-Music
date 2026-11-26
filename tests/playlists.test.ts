// Playlists: static ones keep tracks in order, smart ones a filter, and browsing either is a filter on the library.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { leaf } from '@x-tech-laboratories/x-libs/filter'
import {
  add_to_playlist, create_playlist, delete_playlist, export_entries, import_playlist_entries, list_playlists, move_in_playlist, playlist_filter, playlist_track_ids, remove_from_playlist, rename_playlist
} from '@shared/library/playlists'
import { query_tracks } from '@shared/library/store'
import { add_track, fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb

beforeEach(() => { db = fresh_db() })
afterEach(() => db.close())

// ============================================================================
// Static playlists
// ============================================================================

describe('static playlists', () => {
  it('keeps tracks in the order given, adds at the end, and counts them', () => {
    const [first, second, third] = [add_track(db), add_track(db), add_track(db)]
    const made = create_playlist(db, '  Late night  ', { track_ids: [second, first] })

    expect(made).toMatchObject({ name: 'Late night', kind: 'static', tracks: 2, filter: null })
    expect(add_to_playlist(db, made.id, [third, second])).toEqual({ tracks: 4 })
    expect(playlist_track_ids(db, made.id)).toEqual([second, first, third, second])
  })

  it('takes every entry of a track out and keeps the rest in order', () => {
    const [first, second, third] = [add_track(db), add_track(db), add_track(db)]
    const made = create_playlist(db, 'Mix', { track_ids: [first, second, third, second] })

    expect(remove_from_playlist(db, made.id, [second])).toEqual({ tracks: 2 })
    expect(playlist_track_ids(db, made.id)).toEqual([first, third])
    expect(add_to_playlist(db, made.id, [second])).toEqual({ tracks: 3 })
  })

  it('is browsed as the tracks it holds', () => {
    const [first, , third] = [add_track(db), add_track(db), add_track(db)]
    const made = create_playlist(db, 'Mix', { track_ids: [third, first] })

    expect(query_tracks(db, { filter: playlist_filter(made) }).map((row) => row.id).sort()).toEqual([first, third].sort())
  })

  it('loses a deleted track from its entries', () => {
    const [first, second] = [add_track(db), add_track(db)]
    create_playlist(db, 'Mix', { track_ids: [first, second] })
    db.prepare('DELETE FROM tracks WHERE id = ?').run(first)

    expect(list_playlists(db)[0]!.tracks).toBe(1)
  })
})

describe('moving within a static playlist', () => {
  it('moves tracks before another, in the order given, or to the end', () => {
    const [a, b, c, d] = [add_track(db), add_track(db), add_track(db), add_track(db)]
    const made = create_playlist(db, 'Mix', { track_ids: [a, b, c, d] })

    expect(move_in_playlist(db, made.id, [d, c], b)).toEqual([a, d, c, b])
    expect(move_in_playlist(db, made.id, [a], null)).toEqual([d, c, b, a])
    expect(playlist_track_ids(db, made.id)).toEqual([d, c, b, a])
  })

  it('keeps one entry of a moved track, and leaves the order alone when moved onto itself', () => {
    const [a, b, c] = [add_track(db), add_track(db), add_track(db)]
    const made = create_playlist(db, 'Mix', { track_ids: [a, b, a, c] })

    expect(move_in_playlist(db, made.id, [b], b)).toEqual([a, b, a, c])
    expect(move_in_playlist(db, made.id, [a], c)).toEqual([b, a, c])
  })

  it('refuses a smart playlist', () => {
    const made = create_playlist(db, 'Loved', { filter: leaf('rating', '>=', 80) })

    expect(() => move_in_playlist(db, made.id, [add_track(db)], null)).toThrow(/keeps a filter/)
  })
})

// ============================================================================
// Smart playlists
// ============================================================================

describe('smart playlists', () => {
  it('keeps a filter and is browsed as it', () => {
    const loved = add_track(db, { rating: 100 })
    add_track(db, { rating: 20 })
    const made = create_playlist(db, 'Loved', { filter: leaf('rating', '>=', 80) })

    expect(made).toMatchObject({ kind: 'smart', tracks: null, filter: leaf('rating', '>=', 80) })
    expect(query_tracks(db, { filter: playlist_filter(made) }).map((row) => row.id)).toEqual([loved])
  })

  it('reads a definition kept with its sort and limit, as gmusicbrowser\'s import and older versions wrote it', () => {
    db.prepare("INSERT INTO playlists (id, name, kind, definition, created, modified) VALUES ('old', 'Old', 'smart', ?, 0, 0)")
      .run(JSON.stringify({ filter: leaf('year', '<', 1970), sort: [{ field: 'year' }], limit: 10 }))

    expect(list_playlists(db)[0]!.filter).toEqual(leaf('year', '<', 1970))
  })

  it('refuses tracks', () => {
    const made = create_playlist(db, 'Loved', { filter: leaf('rating', '>=', 80) })

    expect(() => add_to_playlist(db, made.id, [add_track(db)])).toThrow(/smart playlist keeps a filter/)
  })
})

// ============================================================================
// Naming and deleting
// ============================================================================

describe('naming and deleting playlists', () => {
  it('lists playlists by name, renames them and deletes them without touching their tracks', () => {
    const track = add_track(db)
    const zed = create_playlist(db, 'Zed', { track_ids: [track] })
    create_playlist(db, 'Alpha', { track_ids: [] })

    expect(list_playlists(db).map((row) => row.name)).toEqual(['Alpha', 'Zed'])
    rename_playlist(db, zed.id, 'Beta')
    expect(list_playlists(db).map((row) => row.name)).toEqual(['Alpha', 'Beta'])

    delete_playlist(db, zed.id)
    expect(list_playlists(db).map((row) => row.name)).toEqual(['Alpha'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: 1 })
  })

  it('refuses an empty name and a playlist that is not there', () => {
    expect(() => create_playlist(db, '   ', { track_ids: [] })).toThrow(/needs a name/)
    expect(() => rename_playlist(db, 'nope', 'Name')).toThrow(/no playlist nope/)
    expect(() => delete_playlist(db, 'nope')).toThrow(/no playlist nope/)
  })
})

// ============================================================================
// Files
// ============================================================================

function track_at(title: string, uri: string, extra: { present?: number; start_ms?: number | null } = {}): string {
  const id = add_track(db, { title, length_ms: 200_000 })
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, present, subtrack_index, start_ms, added) VALUES (?, ?, 'file', ?, ?, ?, ?, 0)`)
    .run(`${id}-media`, id, uri, extra.present ?? 1, extra.start_ms === undefined || extra.start_ms === null ? 0 : 1, extra.start_ms ?? null)
  return id
}

describe('playlist files', () => {
  it('imports the tracks a file lists, in its order, and names what the library does not hold', () => {
    const so_what = track_at('So What', '/music/so-what.flac')
    const blue = track_at('Blue in Green', '/music/blue.flac')

    const imported = import_playlist_entries(db, 'Kind of Blue', ['/music/blue.flac', '/elsewhere/gone.mp3', '/music/so-what.flac'])

    expect(imported).toMatchObject({ playlist: { name: 'Kind of Blue', kind: 'static', tracks: 2 }, matched: 2, missing: ['/elsewhere/gone.mp3'] })
    expect(playlist_track_ids(db, imported.playlist.id)).toEqual([blue, so_what])
  })

  it('exports a static playlist in its order by each track\'s file on disk, leaving out tracks with none', () => {
    const so_what = track_at('So What', '/music/so-what.flac')
    const gone = track_at('Gone', '/music/gone.flac', { present: 0 })
    const blue = track_at('Blue in Green', '/music/blue.flac')
    const made = create_playlist(db, 'Mix', { track_ids: [blue, gone, so_what] })

    expect(export_entries(db, made.id)).toEqual({
      name: 'Mix',
      entries: [
        { path: '/music/blue.flac', title: 'Blue in Green', artist: null, length_ms: 200_000 },
        { path: '/music/so-what.flac', title: 'So What', artist: null, length_ms: 200_000 }
      ],
      skipped: 1
    })
  })

  it('exports a smart playlist\'s tracks, and refuses a playlist that is not there', () => {
    track_at('So What', '/music/so-what.flac')
    db.prepare("UPDATE tracks SET rating = 100 WHERE title = 'So What'").run()
    track_at('Other', '/music/other.flac')
    const made = create_playlist(db, 'Loved', { filter: leaf('rating', '>=', 80) })

    expect(export_entries(db, made.id).entries.map((entry) => entry.path)).toEqual(['/music/so-what.flac'])
    expect(() => export_entries(db, 'nope')).toThrow(/no playlist nope/)
  })
})
