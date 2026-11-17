// The finder proposes; merge disposes. What matters is that it explains itself and does not put
// two genuinely different recordings in the same proposal.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { findDuplicates } from '@shared/library/duplicates'
import { field } from '@shared/fields'
import { new_id } from '@shared/library/database'
import { freshDb, type TestDb } from './sqlite'

let db: TestDb

function makeTrack(o: {
  title?: string; artist?: string; lengthMs?: number | null
  identityKey?: string; mbid?: string; album?: string
} = {}): string {
  let albumId: string | null = null
  if (o.album) {
    db.prepare('INSERT OR IGNORE INTO albums (id, match_key, name, added) VALUES (?, ?, ?, 0)')
      .run(new_id(), o.album, o.album)
    albumId = (db.prepare('SELECT id FROM albums WHERE match_key = ?').get(o.album) as { id: string }).id
  }

  const id = new_id()
  db.prepare(`INSERT INTO tracks (id, title, album_id, length_ms, identity_key, mb_recording_id,
                                  added, modified) VALUES (?, ?, ?, ?, ?, ?, 0, 0)`)
    .run(id, o.title ?? 'Song', albumId, o.lengthMs ?? 200_000, o.identityKey ?? null, o.mbid ?? null)

  if (o.artist) {
    const fid = field('artist').fieldId!
    db.prepare('INSERT OR IGNORE INTO values_ (id, field_id, value) VALUES (?, ?, ?)').run(new_id(), fid, o.artist)
    const vid = (db.prepare('SELECT id FROM values_ WHERE field_id = ? AND value = ?')
      .get(fid, o.artist) as { id: string }).id
    db.prepare('INSERT INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, 0)')
      .run(id, fid, vid)
  }
  return id
}

const addMedia = (trackId: string, uri: string, hash?: string): void => {
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, audio_hash, present, added)
              VALUES (?, ?, 'file', ?, ?, 1, 0)`)
    .run(new_id(), trackId, uri, hash ? Buffer.from(hash, 'hex') : null)
}

beforeEach(() => { db = freshDb() })
afterEach(() => db.close())

describe('duplicate detection', () => {
  it('finds nothing in a clean library', () => {
    makeTrack({ title: 'A', artist: 'X' })
    makeTrack({ title: 'B', artist: 'Y' })
    expect(findDuplicates(db)).toEqual([])
  })

  it('treats identical audio as certain', () => {
    const a = makeTrack({ title: 'One' })
    const b = makeTrack({ title: 'Uno' })
    addMedia(a, '/a.flac', 'aa'.repeat(16))
    addMedia(b, '/b.flac', 'aa'.repeat(16))

    const groups = findDuplicates(db)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.reason).toBe('audio_hash')
    expect(groups[0]!.confidence).toBe('certain')
    expect(groups[0]!.members.map((m) => m.trackId).sort()).toEqual([a, b].sort())
  })

  it('treats a shared MusicBrainz recording id as certain', () => {
    const a = makeTrack({ mbid: 'rec-1' })
    const b = makeTrack({ mbid: 'rec-1' })
    const groups = findDuplicates(db, { reasons: ['mb_recording_id'] })
    expect(groups[0]!.confidence).toBe('certain')
    expect(groups[0]!.members).toHaveLength(2)
    expect([a, b]).toHaveLength(2)
  })

  it('treats matching normalised tags as likely', () => {
    makeTrack({ identityKey: 'k1' })
    makeTrack({ identityKey: 'k1' })
    const groups = findDuplicates(db, { reasons: ['tags'] })
    expect(groups[0]!.reason).toBe('tags')
    expect(groups[0]!.confidence).toBe('likely')
  })

  it('matches on artist and title across albums, as only possible', () => {
    makeTrack({ title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', lengthMs: 560_000 })
    makeTrack({ title: 'so what', artist: 'miles davis', album: 'Greatest Hits', lengthMs: 561_000 })

    const groups = findDuplicates(db, { reasons: ['fuzzy'] })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.confidence).toBe('possible')
    expect(groups[0]!.explanation).toMatch(/different albums/)
  })

  it('keeps meaningfully different bracketed parts apart', () => {
    // Stripping all bracketed text would call these one recording, which is a wrong merge.
    makeTrack({ title: 'District Dash [Act 1]', artist: 'Score', lengthMs: 3_648_000 })
    makeTrack({ title: 'District Dash [Act 2]', artist: 'Score', lengthMs: 3_648_000 })
    expect(findDuplicates(db, { reasons: ['fuzzy'] })).toEqual([])
  })

  it('still ignores boilerplate suffixes that carry no meaning', () => {
    makeTrack({ title: 'Runaways', artist: 'MegaEnx', lengthMs: 208_000 })
    makeTrack({ title: 'Runaways [No Copyright Music]', artist: 'MegaEnx', lengthMs: 208_500 })
    expect(findDuplicates(db, { reasons: ['fuzzy'] })).toHaveLength(1)
  })

  it('leaves fuzzy matching out unless it is asked for', () => {
    makeTrack({ title: 'Same', artist: 'A', lengthMs: 200_000 })
    makeTrack({ title: 'Same', artist: 'A', lengthMs: 200_000 })
    expect(findDuplicates(db)).toEqual([])
    expect(findDuplicates(db, { reasons: ['fuzzy'] })).toHaveLength(1)
  })

  it('ignores diacritics and featured-artist suffixes', () => {
    makeTrack({ title: 'Cafe (feat. Someone)', artist: 'Bjork', lengthMs: 200_000 })
    makeTrack({ title: 'Café', artist: 'Björk', lengthMs: 200_500 })
    expect(findDuplicates(db, { reasons: ['fuzzy'] })).toHaveLength(1)
  })

  it('does not group two recordings whose durations differ materially', () => {
    makeTrack({ title: 'Take Five', artist: 'Brubeck', lengthMs: 324_000 })
    makeTrack({ title: 'Take Five', artist: 'Brubeck', lengthMs: 800_000 })
    expect(findDuplicates(db, { reasons: ['fuzzy'] })).toEqual([])
  })

  it('honours a wider duration tolerance when asked', () => {
    makeTrack({ title: 'Drift', artist: 'A', lengthMs: 300_000 })
    makeTrack({ title: 'Drift', artist: 'A', lengthMs: 308_000 })

    expect(findDuplicates(db, { reasons: ['fuzzy'] })).toEqual([])
    expect(findDuplicates(db, { reasons: ['fuzzy'], lengthToleranceMs: 10_000 }))
      .toHaveLength(1)
  })

  it('puts a track in only one proposal, strongest evidence first', () => {
    const a = makeTrack({ title: 'Same', artist: 'A', identityKey: 'k', lengthMs: 200_000 })
    const b = makeTrack({ title: 'Same', artist: 'A', identityKey: 'k', lengthMs: 200_000 })
    addMedia(a, '/a.flac', 'bb'.repeat(16))
    addMedia(b, '/b.flac', 'bb'.repeat(16))

    const groups = findDuplicates(db)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.reason).toBe('audio_hash')
  })

  it('reports what each member brings to the decision', () => {
    const a = makeTrack({ title: 'X', artist: 'A' })
    addMedia(a, '/x.flac', 'cc'.repeat(16))
    const b = makeTrack({ title: 'X', artist: 'A' })
    addMedia(b, '/x.mp3', 'cc'.repeat(16))

    const m = findDuplicates(db)[0]!.members
    expect(m.every((x) => x.mediaCount === 1)).toBe(true)
    expect(m.map((x) => x.artist)).toEqual(['A', 'A'])
  })

  it('caps the number of proposals when asked', () => {
    for (let i = 0; i < 6; i++) {
      makeTrack({ identityKey: `k${i}` })
      makeTrack({ identityKey: `k${i}` })
    }
    expect(findDuplicates(db, { reasons: ['tags'], limit: 2 })).toHaveLength(2)
  })
})
