// Merging deletes rows holding ratings and play history that cannot be rebuilt from the files, so
// the round-trip through unmerge is the test that matters most here.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { list_recent_merges, merge_preview, merge_tracks, unmerge } from '@shared/library/merge'
import { field } from '@shared/fields'
import { new_id } from '@shared/library/database'
import { fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb

interface Spec {
  title?: string | null
  year?: number | null
  rating?: number | null
  play_count?: number
  skip_count?: number
  last_played?: number | null
  album?: string | null
  genres?: string[]
  artist?: string
  comment?: string
}

function make_track(s: Spec = {}): string {
  let album_id: string | null = null
  if (s.album) {
    db.prepare('INSERT OR IGNORE INTO albums (id, match_key, name, added) VALUES (?, ?, ?, 0)')
      .run(new_id(), s.album, s.album)
    album_id = (db.prepare('SELECT id FROM albums WHERE match_key = ?').get(s.album) as { id: string }).id
  }

  const id = new_id()
  db.prepare(`INSERT INTO tracks (id, title, album_id, year, rating, play_count, skip_count,
                                  last_played, added, modified)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, 0)`)
    .run(id, s.title ?? 'Song', album_id, s.year ?? null, s.rating ?? null,
         s.play_count ?? 0, s.skip_count ?? 0, s.last_played ?? null)

  const add_value = (field_id: string, value: string, ordinal: number): void => {
    const fid = field(field_id).field_id!
    db.prepare('INSERT OR IGNORE INTO values_ (id, field_id, value) VALUES (?, ?, ?)').run(new_id(), fid, value)
    const vid = (db.prepare('SELECT id FROM values_ WHERE field_id = ? AND value = ?')
      .get(fid, value) as { id: string }).id
    db.prepare('INSERT INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)')
      .run(id, fid, vid, ordinal)
  }

  if (s.artist) add_value('artist', s.artist, 0)
  ;(s.genres ?? []).forEach((g, i) => add_value('genre', g, i))

  if (s.comment) {
    db.prepare('INSERT INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?)')
      .run(id, field('comment').field_id!, s.comment)
  }

  return id
}

const add_media = (track_id: string, uri: string, codec = 'flac'): string => {
  const id = new_id()
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, codec, present, added)
              VALUES (?, ?, 'file', ?, ?, 1, 0)`).run(id, track_id, uri, codec)
  return id
}

const add_history = (track_id: string, at: number): void => {
  db.prepare('INSERT OR IGNORE INTO play_history (id, track_id, at, kind) VALUES (?, ?, ?, 0)')
    .run(new_id(), track_id, at)
}

const add_playlist = (): string => {
  const id = new_id()
  db.prepare("INSERT INTO playlists (id, name, kind, created, modified) VALUES (?, 'p', 'static', 0, 0)").run(id)
  return id
}

const one = <T>(sql: string, ...args: (string | number)[]): T =>
  db.prepare(sql).get(...args) as T

const count = (sql: string, ...args: (string | number)[]): number =>
  (one<{ n: number }>(sql, ...args)).n

beforeEach(() => { db = fresh_db() })
afterEach(() => db.close())

describe('merge preview', () => {
  it('marks agreeing fields as settled and disagreeing ones as conflicts', () => {
    const a = make_track({ title: 'So What', year: 1959, artist: 'Miles Davis' })
    const b = make_track({ title: 'So What', year: 1997, artist: 'Miles Davis' })

    const p = merge_preview(db, [a, b])
    const title = p.fields.find((f) => f.field === 'title')!
    const year = p.fields.find((f) => f.field === 'year')!

    expect(title.conflict).toBe(false)
    expect(title.value).toBe('So What')
    expect(year.conflict).toBe(true)
    expect(year.options!.map((o) => o.value).sort()).toEqual([1959, 1997])
  })

  it('offers the union of multi-value fields', () => {
    const a = make_track({ genres: ['Jazz'] })
    const b = make_track({ genres: ['Jazz', 'Modal'] })

    const genre = merge_preview(db, [a, b]).fields.find((f) => f.field === 'genre')!
    expect(genre.multi).toBe(true)
    expect(genre.union!.sort()).toEqual(['Jazz', 'Modal'])
  })

  it('proposes the richest source as the survivor', () => {
    const thin = make_track({ play_count: 1 })
    const rich = make_track({ play_count: 50 })
    add_media(rich, '/a.flac')
    add_media(rich, '/a.mp3', 'mp3')
    add_media(thin, '/b.flac')

    expect(merge_preview(db, [thin, rich]).survivor).toBe(rich)
  })

  it('sums counts and takes the highest rating', () => {
    const a = make_track({ rating: 80, play_count: 10, skip_count: 1 })
    const b = make_track({ rating: null, play_count: 5, skip_count: 2 })

    const stats = merge_preview(db, [a, b]).statistics
    expect(stats).toMatchObject({ play_count: 15, skip_count: 3, rating: 80 })
  })

  it('flags pinned sources, since merging overrides a human decision', () => {
    const a = make_track()
    const b = make_track()
    db.prepare('UPDATE tracks SET pinned = 1 WHERE id = ?').run(b)
    expect(merge_preview(db, [a, b]).pinned_sources).toEqual([b])
  })

  it('refuses fewer than two tracks', () => {
    expect(() => merge_preview(db, [make_track()])).toThrow(/at least two/)
  })
})

describe('merging', () => {
  it('moves every media source onto the survivor', () => {
    const a = make_track()
    const b = make_track()
    add_media(a, '/a.flac')
    add_media(b, '/b.mp3', 'mp3')

    const r = merge_tracks(db, { ids: [a, b], survivor: a })

    expect(r.media_moved).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM media WHERE track_id = ?', a)).toBe(2)
    expect(count('SELECT COUNT(*) AS n FROM tracks')).toBe(1)
  })

  it('applies per-field resolutions', () => {
    const a = make_track({ title: 'so what', year: 1997 })
    const b = make_track({ title: 'So What', year: 1959 })

    merge_tracks(db, {
      ids: [a, b], survivor: a,
      resolutions: { title: { kind: 'value', from: b }, year: { kind: 'value', from: b } }
    })

    const t = one<{ title: string; year: number }>('SELECT title, year FROM tracks WHERE id = ?', a)
    expect(t).toEqual({ title: 'So What', year: 1959 })
  })

  it('unions multi-value fields by default', () => {
    const a = make_track({ genres: ['Jazz'] })
    const b = make_track({ genres: ['Modal', 'Cool'] })

    merge_tracks(db, { ids: [a, b], survivor: a })

    const genres = db.prepare(
      `SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
       WHERE tv.track_id = ? AND tv.field_id = ? ORDER BY vv.value`
    ).all(a, field('genre').field_id!) as { value: string }[]
    expect(genres.map((g) => g.value)).toEqual(['Cool', 'Jazz', 'Modal'])
  })

  it('can take one source\'s set instead of the union', () => {
    const a = make_track({ genres: ['Jazz'] })
    const b = make_track({ genres: ['Modal'] })

    merge_tracks(db, {
      ids: [a, b], survivor: a, resolutions: { genre: { kind: 'value', from: b } }
    })

    const genres = db.prepare(
      `SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
       WHERE tv.track_id = ? AND tv.field_id = ?`
    ).all(a, field('genre').field_id!) as { value: string }[]
    expect(genres.map((g) => g.value)).toEqual(['Modal'])
  })

  it('sums play counts and keeps the highest rating', () => {
    const a = make_track({ rating: 40, play_count: 3 })
    const b = make_track({ rating: 100, play_count: 9 })

    merge_tracks(db, { ids: [a, b], survivor: a })

    expect(one<{ rating: number; play_count: number }>(
      'SELECT rating, play_count FROM tracks WHERE id = ?', a))
      .toEqual({ rating: 100, play_count: 12 })
  })

  it('unions play history and drops exact duplicates', () => {
    const a = make_track()
    const b = make_track()
    add_history(a, 1000); add_history(a, 2000)
    add_history(b, 2000); add_history(b, 3000)

    merge_tracks(db, { ids: [a, b], survivor: a })

    const at = db.prepare('SELECT at FROM play_history WHERE track_id = ? ORDER BY at')
      .all(a) as { at: number }[]
    expect(at.map((r) => r.at)).toEqual([1000, 2000, 3000])
  })

  it('repoints playlist entries without listing the survivor twice', () => {
    const a = make_track()
    const b = make_track()
    const pl = add_playlist()
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 0)').run(pl, a)
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 1)').run(pl, b)

    merge_tracks(db, { ids: [a, b], survivor: a })

    expect(count('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?', pl)).toBe(1)
  })

  it('pins the survivor so an automated pass cannot re-split it', () => {
    const a = make_track()
    const b = make_track()
    merge_tracks(db, { ids: [a, b], survivor: a })

    const t = one<{ pinned: number; identity_source: string }>(
      'SELECT pinned, identity_source FROM tracks WHERE id = ?', a)
    expect(t).toEqual({ pinned: 1, identity_source: 'manual' })
  })

  it('refuses a survivor that is not part of the merge', () => {
    const a = make_track()
    const b = make_track()
    expect(() => merge_tracks(db, { ids: [a, b], survivor: 'no-such-track' })).toThrow(/survivor/)
  })
})

describe('unmerge', () => {
  it('restores tracks, media, statistics and history exactly', () => {
    const a = make_track({ title: 'A', rating: 40, play_count: 3, genres: ['Jazz'], comment: 'first' })
    const b = make_track({ title: 'B', rating: 100, play_count: 9, genres: ['Modal'] })
    add_media(a, '/a.flac')
    add_media(b, '/b.mp3', 'mp3')
    add_history(a, 1000)
    add_history(b, 2000)

    const snapshot = {
      tracks: db.prepare('SELECT id, title, rating, play_count FROM tracks ORDER BY id').all(),
      media: db.prepare('SELECT id, track_id FROM media ORDER BY id').all(),
      history: db.prepare('SELECT track_id, at FROM play_history ORDER BY track_id, at').all(),
      values: db.prepare('SELECT track_id, field_id, value_id FROM track_values ORDER BY track_id, field_id').all(),
      extras: db.prepare('SELECT track_id, field_id, value FROM track_extras ORDER BY track_id').all()
    }

    const result = merge_tracks(db, { ids: [a, b], survivor: a })
    expect(count('SELECT COUNT(*) AS n FROM tracks')).toBe(1)

    const undone = unmerge(db, result.batch_id)
    expect(undone.restored).toEqual([b])

    expect(db.prepare('SELECT id, title, rating, play_count FROM tracks ORDER BY id').all())
      .toEqual(snapshot.tracks)
    expect(db.prepare('SELECT id, track_id FROM media ORDER BY id').all()).toEqual(snapshot.media)
    expect(db.prepare('SELECT track_id, at FROM play_history ORDER BY track_id, at').all())
      .toEqual(snapshot.history)
    expect(db.prepare('SELECT track_id, field_id, value_id FROM track_values ORDER BY track_id, field_id').all())
      .toEqual(snapshot.values)
    expect(db.prepare('SELECT track_id, field_id, value FROM track_extras ORDER BY track_id').all())
      .toEqual(snapshot.extras)
  })

  it('restores history that was dropped as a duplicate', () => {
    const a = make_track()
    const b = make_track()
    add_history(a, 5000)
    add_history(b, 5000)

    const r = merge_tracks(db, { ids: [a, b], survivor: a })
    expect(count('SELECT COUNT(*) AS n FROM play_history')).toBe(1)

    unmerge(db, r.batch_id)
    expect(count('SELECT COUNT(*) AS n FROM play_history')).toBe(2)
  })

  it('restores playlist membership', () => {
    const a = make_track()
    const b = make_track()
    const pl = add_playlist()
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 0)').run(pl, a)
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 1)').run(pl, b)

    const r = merge_tracks(db, { ids: [a, b], survivor: a })
    unmerge(db, r.batch_id)

    expect(db.prepare('SELECT track_id, position FROM playlist_tracks ORDER BY position').all())
      .toEqual([{ track_id: a, position: 0 }, { track_id: b, position: 1 }])
  })

  it('refuses to undo the same merge twice', () => {
    const a = make_track()
    const b = make_track()
    const r = merge_tracks(db, { ids: [a, b], survivor: a })
    unmerge(db, r.batch_id)
    expect(() => unmerge(db, r.batch_id)).toThrow(/already been undone/)
  })

  it('rejects an unknown batch', () => {
    expect(() => unmerge(db, 'nope')).toThrow(/no merge recorded/)
  })

  it('refuses to bring a track back over a different track that has its id', () => {
    const a = make_track({ title: 'Keeper' })
    const b = make_track({ title: 'Duplicate' })
    const r = merge_tracks(db, { ids: [a, b], survivor: a })
    db.prepare("INSERT INTO tracks (id, title, rating, added, modified) VALUES (?, 'Someone else', 100, 5000, 0)").run(b)

    expect(() => unmerge(db, r.batch_id)).toThrow(/would overwrite a track this merge did not take/)
    expect(one<{ title: string; rating: number }>('SELECT title, rating FROM tracks WHERE id = ?', b)).toEqual({ title: 'Someone else', rating: 100 })
  })
})


describe('listing merges', () => {
  it('lists the latest merges newest first, with the tracks each took and whether it was undone', () => {
    const keeper = make_track({ title: 'So What' })
    const copy = make_track({ title: 'So What (copy)' })
    const other = make_track({ title: 'Blue in Green' })
    const other_copy = make_track({ title: 'Blue in Green' })
    const first = merge_tracks(db, { ids: [keeper, copy], survivor: keeper })
    const second = merge_tracks(db, { ids: [other, other_copy], survivor: other })
    db.prepare('UPDATE merge_journal SET at = 1000 WHERE batch_id = ?').run(first.batch_id)
    db.prepare('UPDATE merge_journal SET at = 2000 WHERE batch_id = ?').run(second.batch_id)
    unmerge(db, first.batch_id)

    expect(list_recent_merges(db, 10)).toEqual([
      { batch_id: second.batch_id, at: 2000, survivor_id: other, survivor_title: 'Blue in Green', absorbed: [{ id: other_copy, title: 'Blue in Green' }], undone: false },
      { batch_id: first.batch_id, at: 1000, survivor_id: keeper, survivor_title: 'So What', absorbed: [{ id: copy, title: 'So What (copy)' }], undone: true }
    ])
    expect(list_recent_merges(db, 1).map((merge) => merge.batch_id)).toEqual([second.batch_id])
  })

  it('names a survivor that is gone by its title before the merge', () => {
    const keeper = make_track({ title: 'Freddie Freeloader' })
    const copy = make_track({ title: 'Freddie Freeloader' })
    merge_tracks(db, { ids: [keeper, copy], survivor: keeper })
    db.prepare('DELETE FROM tracks WHERE id = ?').run(keeper)

    expect(list_recent_merges(db, 10)[0]!.survivor_title).toBe('Freddie Freeloader')
  })
})
