// Merging deletes rows holding ratings and play history that cannot be rebuilt from the files, so
// the round-trip through unmerge is the test that matters most here.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mergePreview, mergeTracks, unmerge } from '@shared/library/merge'
import { field } from '@shared/fields'
import { new_id } from '@shared/library/database'
import { freshDb, type TestDb } from '../helpers/sqlite'

let db: TestDb

interface Spec {
  title?: string | null
  year?: number | null
  rating?: number | null
  playCount?: number
  skipCount?: number
  lastPlayed?: number | null
  album?: string | null
  genres?: string[]
  artist?: string
  comment?: string
}

function makeTrack(s: Spec = {}): string {
  let albumId: string | null = null
  if (s.album) {
    db.prepare('INSERT OR IGNORE INTO albums (id, match_key, name, added) VALUES (?, ?, ?, 0)')
      .run(new_id(), s.album, s.album)
    albumId = (db.prepare('SELECT id FROM albums WHERE match_key = ?').get(s.album) as { id: string }).id
  }

  const id = new_id()
  db.prepare(`INSERT INTO tracks (id, title, album_id, year, rating, play_count, skip_count,
                                  last_played, added, modified)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, 0)`)
    .run(id, s.title ?? 'Song', albumId, s.year ?? null, s.rating ?? null,
         s.playCount ?? 0, s.skipCount ?? 0, s.lastPlayed ?? null)

  const addValue = (fieldId: string, value: string, ordinal: number): void => {
    const fid = field(fieldId).fieldId!
    db.prepare('INSERT OR IGNORE INTO values_ (id, field_id, value) VALUES (?, ?, ?)').run(new_id(), fid, value)
    const vid = (db.prepare('SELECT id FROM values_ WHERE field_id = ? AND value = ?')
      .get(fid, value) as { id: string }).id
    db.prepare('INSERT INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)')
      .run(id, fid, vid, ordinal)
  }

  if (s.artist) addValue('artist', s.artist, 0)
  ;(s.genres ?? []).forEach((g, i) => addValue('genre', g, i))

  if (s.comment) {
    db.prepare('INSERT INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?)')
      .run(id, field('comment').fieldId!, s.comment)
  }

  return id
}

const addMedia = (trackId: string, uri: string, codec = 'flac'): string => {
  const id = new_id()
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, codec, present, added)
              VALUES (?, ?, 'file', ?, ?, 1, 0)`).run(id, trackId, uri, codec)
  return id
}

const addHistory = (trackId: string, at: number): void => {
  db.prepare('INSERT OR IGNORE INTO play_history (id, track_id, at, kind) VALUES (?, ?, ?, 0)')
    .run(new_id(), trackId, at)
}

const addPlaylist = (): string => {
  const id = new_id()
  db.prepare("INSERT INTO playlists (id, name, kind, created, modified) VALUES (?, 'p', 'static', 0, 0)").run(id)
  return id
}

const one = <T>(sql: string, ...args: (string | number)[]): T =>
  db.prepare(sql).get(...args) as T

const count = (sql: string, ...args: (string | number)[]): number =>
  (one<{ n: number }>(sql, ...args)).n

beforeEach(() => { db = freshDb() })
afterEach(() => db.close())

describe('merge preview', () => {
  it('marks agreeing fields as settled and disagreeing ones as conflicts', () => {
    const a = makeTrack({ title: 'So What', year: 1959, artist: 'Miles Davis' })
    const b = makeTrack({ title: 'So What', year: 1997, artist: 'Miles Davis' })

    const p = mergePreview(db, [a, b])
    const title = p.fields.find((f) => f.field === 'title')!
    const year = p.fields.find((f) => f.field === 'year')!

    expect(title.conflict).toBe(false)
    expect(title.value).toBe('So What')
    expect(year.conflict).toBe(true)
    expect(year.options!.map((o) => o.value).sort()).toEqual([1959, 1997])
  })

  it('offers the union of multi-value fields', () => {
    const a = makeTrack({ genres: ['Jazz'] })
    const b = makeTrack({ genres: ['Jazz', 'Modal'] })

    const genre = mergePreview(db, [a, b]).fields.find((f) => f.field === 'genre')!
    expect(genre.multi).toBe(true)
    expect(genre.union!.sort()).toEqual(['Jazz', 'Modal'])
  })

  it('proposes the richest source as the survivor', () => {
    const thin = makeTrack({ playCount: 1 })
    const rich = makeTrack({ playCount: 50 })
    addMedia(rich, '/a.flac')
    addMedia(rich, '/a.mp3', 'mp3')
    addMedia(thin, '/b.flac')

    expect(mergePreview(db, [thin, rich]).survivor).toBe(rich)
  })

  it('sums counts and takes the highest rating', () => {
    const a = makeTrack({ rating: 80, playCount: 10, skipCount: 1 })
    const b = makeTrack({ rating: null, playCount: 5, skipCount: 2 })

    const stats = mergePreview(db, [a, b]).statistics
    expect(stats).toMatchObject({ playCount: 15, skipCount: 3, rating: 80 })
  })

  it('flags pinned sources, since merging overrides a human decision', () => {
    const a = makeTrack()
    const b = makeTrack()
    db.prepare('UPDATE tracks SET pinned = 1 WHERE id = ?').run(b)
    expect(mergePreview(db, [a, b]).pinnedSources).toEqual([b])
  })

  it('refuses fewer than two tracks', () => {
    expect(() => mergePreview(db, [makeTrack()])).toThrow(/at least two/)
  })
})

describe('merging', () => {
  it('moves every media source onto the survivor', () => {
    const a = makeTrack()
    const b = makeTrack()
    addMedia(a, '/a.flac')
    addMedia(b, '/b.mp3', 'mp3')

    const r = mergeTracks(db, { ids: [a, b], survivor: a })

    expect(r.mediaMoved).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM media WHERE track_id = ?', a)).toBe(2)
    expect(count('SELECT COUNT(*) AS n FROM tracks')).toBe(1)
  })

  it('applies per-field resolutions', () => {
    const a = makeTrack({ title: 'so what', year: 1997 })
    const b = makeTrack({ title: 'So What', year: 1959 })

    mergeTracks(db, {
      ids: [a, b], survivor: a,
      resolutions: { title: { kind: 'value', from: b }, year: { kind: 'value', from: b } }
    })

    const t = one<{ title: string; year: number }>('SELECT title, year FROM tracks WHERE id = ?', a)
    expect(t).toEqual({ title: 'So What', year: 1959 })
  })

  it('unions multi-value fields by default', () => {
    const a = makeTrack({ genres: ['Jazz'] })
    const b = makeTrack({ genres: ['Modal', 'Cool'] })

    mergeTracks(db, { ids: [a, b], survivor: a })

    const genres = db.prepare(
      `SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
       WHERE tv.track_id = ? AND tv.field_id = ? ORDER BY vv.value`
    ).all(a, field('genre').fieldId!) as { value: string }[]
    expect(genres.map((g) => g.value)).toEqual(['Cool', 'Jazz', 'Modal'])
  })

  it('can take one source\'s set instead of the union', () => {
    const a = makeTrack({ genres: ['Jazz'] })
    const b = makeTrack({ genres: ['Modal'] })

    mergeTracks(db, {
      ids: [a, b], survivor: a, resolutions: { genre: { kind: 'value', from: b } }
    })

    const genres = db.prepare(
      `SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
       WHERE tv.track_id = ? AND tv.field_id = ?`
    ).all(a, field('genre').fieldId!) as { value: string }[]
    expect(genres.map((g) => g.value)).toEqual(['Modal'])
  })

  it('sums play counts and keeps the highest rating', () => {
    const a = makeTrack({ rating: 40, playCount: 3 })
    const b = makeTrack({ rating: 100, playCount: 9 })

    mergeTracks(db, { ids: [a, b], survivor: a })

    expect(one<{ rating: number; play_count: number }>(
      'SELECT rating, play_count FROM tracks WHERE id = ?', a))
      .toEqual({ rating: 100, play_count: 12 })
  })

  it('unions play history and drops exact duplicates', () => {
    const a = makeTrack()
    const b = makeTrack()
    addHistory(a, 1000); addHistory(a, 2000)
    addHistory(b, 2000); addHistory(b, 3000)

    mergeTracks(db, { ids: [a, b], survivor: a })

    const at = db.prepare('SELECT at FROM play_history WHERE track_id = ? ORDER BY at')
      .all(a) as { at: number }[]
    expect(at.map((r) => r.at)).toEqual([1000, 2000, 3000])
  })

  it('repoints playlist entries without listing the survivor twice', () => {
    const a = makeTrack()
    const b = makeTrack()
    const pl = addPlaylist()
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 0)').run(pl, a)
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 1)').run(pl, b)

    mergeTracks(db, { ids: [a, b], survivor: a })

    expect(count('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?', pl)).toBe(1)
  })

  it('pins the survivor so an automated pass cannot re-split it', () => {
    const a = makeTrack()
    const b = makeTrack()
    mergeTracks(db, { ids: [a, b], survivor: a })

    const t = one<{ pinned: number; identity_source: string }>(
      'SELECT pinned, identity_source FROM tracks WHERE id = ?', a)
    expect(t).toEqual({ pinned: 1, identity_source: 'manual' })
  })

  it('refuses a survivor that is not part of the merge', () => {
    const a = makeTrack()
    const b = makeTrack()
    expect(() => mergeTracks(db, { ids: [a, b], survivor: 'no-such-track' })).toThrow(/survivor/)
  })
})

describe('unmerge', () => {
  it('restores tracks, media, statistics and history exactly', () => {
    const a = makeTrack({ title: 'A', rating: 40, playCount: 3, genres: ['Jazz'], comment: 'first' })
    const b = makeTrack({ title: 'B', rating: 100, playCount: 9, genres: ['Modal'] })
    addMedia(a, '/a.flac')
    addMedia(b, '/b.mp3', 'mp3')
    addHistory(a, 1000)
    addHistory(b, 2000)

    const snapshot = {
      tracks: db.prepare('SELECT id, title, rating, play_count FROM tracks ORDER BY id').all(),
      media: db.prepare('SELECT id, track_id FROM media ORDER BY id').all(),
      history: db.prepare('SELECT track_id, at FROM play_history ORDER BY track_id, at').all(),
      values: db.prepare('SELECT track_id, field_id, value_id FROM track_values ORDER BY track_id, field_id').all(),
      extras: db.prepare('SELECT track_id, field_id, value FROM track_extras ORDER BY track_id').all()
    }

    const result = mergeTracks(db, { ids: [a, b], survivor: a })
    expect(count('SELECT COUNT(*) AS n FROM tracks')).toBe(1)

    const undone = unmerge(db, result.batchId)
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
    const a = makeTrack()
    const b = makeTrack()
    addHistory(a, 5000)
    addHistory(b, 5000)

    const r = mergeTracks(db, { ids: [a, b], survivor: a })
    expect(count('SELECT COUNT(*) AS n FROM play_history')).toBe(1)

    unmerge(db, r.batchId)
    expect(count('SELECT COUNT(*) AS n FROM play_history')).toBe(2)
  })

  it('restores playlist membership', () => {
    const a = makeTrack()
    const b = makeTrack()
    const pl = addPlaylist()
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 0)').run(pl, a)
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 1)').run(pl, b)

    const r = mergeTracks(db, { ids: [a, b], survivor: a })
    unmerge(db, r.batchId)

    expect(db.prepare('SELECT track_id, position FROM playlist_tracks ORDER BY position').all())
      .toEqual([{ track_id: a, position: 0 }, { track_id: b, position: 1 }])
  })

  it('refuses to undo the same merge twice', () => {
    const a = makeTrack()
    const b = makeTrack()
    const r = mergeTracks(db, { ids: [a, b], survivor: a })
    unmerge(db, r.batchId)
    expect(() => unmerge(db, r.batchId)).toThrow(/already been undone/)
  })

  it('rejects an unknown batch', () => {
    expect(() => unmerge(db, 'nope')).toThrow(/no merge recorded/)
  })

  it('refuses to bring a track back over a different track that has its id', () => {
    const a = makeTrack({ title: 'Keeper' })
    const b = makeTrack({ title: 'Duplicate' })
    const r = mergeTracks(db, { ids: [a, b], survivor: a })
    db.prepare("INSERT INTO tracks (id, title, rating, added, modified) VALUES (?, 'Someone else', 100, 5000, 0)").run(b)

    expect(() => unmerge(db, r.batchId)).toThrow(/would overwrite a track this merge did not take/)
    expect(one<{ title: string; rating: number }>('SELECT title, rating FROM tracks WHERE id = ?', b)).toEqual({ title: 'Someone else', rating: 100 })
  })
})

