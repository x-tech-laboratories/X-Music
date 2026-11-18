// The finder proposes; merge disposes. What matters is that it explains itself and does not put
// two genuinely different recordings in the same proposal.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { find_duplicates } from '@shared/library/duplicates'
import { field } from '@shared/fields'
import { new_id } from '@shared/library/database'
import { fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb

function make_track(o: {
  title?: string; artist?: string; length_ms?: number | null
  identity_key?: string; mbid?: string; album?: string
} = {}): string {
  let album_id: string | null = null
  if (o.album) {
    db.prepare('INSERT OR IGNORE INTO albums (id, match_key, name, added) VALUES (?, ?, ?, 0)')
      .run(new_id(), o.album, o.album)
    album_id = (db.prepare('SELECT id FROM albums WHERE match_key = ?').get(o.album) as { id: string }).id
  }

  const id = new_id()
  db.prepare(`INSERT INTO tracks (id, title, album_id, length_ms, identity_key, mb_recording_id,
                                  added, modified) VALUES (?, ?, ?, ?, ?, ?, 0, 0)`)
    .run(id, o.title ?? 'Song', album_id, o.length_ms ?? 200_000, o.identity_key ?? null, o.mbid ?? null)

  if (o.artist) {
    const fid = field('artist').field_id!
    db.prepare('INSERT OR IGNORE INTO values_ (id, field_id, value) VALUES (?, ?, ?)').run(new_id(), fid, o.artist)
    const vid = (db.prepare('SELECT id FROM values_ WHERE field_id = ? AND value = ?')
      .get(fid, o.artist) as { id: string }).id
    db.prepare('INSERT INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, 0)')
      .run(id, fid, vid)
  }
  return id
}

const add_media = (track_id: string, uri: string, hash?: string): void => {
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, audio_hash, present, added)
              VALUES (?, ?, 'file', ?, ?, 1, 0)`)
    .run(new_id(), track_id, uri, hash ? Buffer.from(hash, 'hex') : null)
}

beforeEach(() => { db = fresh_db() })
afterEach(() => db.close())

describe('duplicate detection', () => {
  it('finds nothing in a clean library', () => {
    make_track({ title: 'A', artist: 'X' })
    make_track({ title: 'B', artist: 'Y' })
    expect(find_duplicates(db)).toEqual([])
  })

  it('treats identical audio as certain', () => {
    const a = make_track({ title: 'One' })
    const b = make_track({ title: 'Uno' })
    add_media(a, '/a.flac', 'aa'.repeat(16))
    add_media(b, '/b.flac', 'aa'.repeat(16))

    const groups = find_duplicates(db)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.reason).toBe('audio_hash')
    expect(groups[0]!.confidence).toBe('certain')
    expect(groups[0]!.members.map((m) => m.track_id).sort()).toEqual([a, b].sort())
  })

  it('treats a shared MusicBrainz recording id as certain', () => {
    const a = make_track({ mbid: 'rec-1' })
    const b = make_track({ mbid: 'rec-1' })
    const groups = find_duplicates(db, { reasons: ['mb_recording_id'] })
    expect(groups[0]!.confidence).toBe('certain')
    expect(groups[0]!.members).toHaveLength(2)
    expect([a, b]).toHaveLength(2)
  })

  it('treats matching normalised tags as likely', () => {
    make_track({ identity_key: 'k1' })
    make_track({ identity_key: 'k1' })
    const groups = find_duplicates(db, { reasons: ['tags'] })
    expect(groups[0]!.reason).toBe('tags')
    expect(groups[0]!.confidence).toBe('likely')
  })

  it('matches on artist and title across albums, as only possible', () => {
    make_track({ title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', length_ms: 560_000 })
    make_track({ title: 'so what', artist: 'miles davis', album: 'Greatest Hits', length_ms: 561_000 })

    const groups = find_duplicates(db, { reasons: ['fuzzy'] })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.confidence).toBe('possible')
    expect(groups[0]!.explanation).toMatch(/different albums/)
  })

  it('keeps meaningfully different bracketed parts apart', () => {
    // Stripping all bracketed text would call these one recording, which is a wrong merge.
    make_track({ title: 'District Dash [Act 1]', artist: 'Score', length_ms: 3_648_000 })
    make_track({ title: 'District Dash [Act 2]', artist: 'Score', length_ms: 3_648_000 })
    expect(find_duplicates(db, { reasons: ['fuzzy'] })).toEqual([])
  })

  it('still ignores boilerplate suffixes that carry no meaning', () => {
    make_track({ title: 'Runaways', artist: 'MegaEnx', length_ms: 208_000 })
    make_track({ title: 'Runaways [No Copyright Music]', artist: 'MegaEnx', length_ms: 208_500 })
    expect(find_duplicates(db, { reasons: ['fuzzy'] })).toHaveLength(1)
  })

  it('leaves fuzzy matching out unless it is asked for', () => {
    make_track({ title: 'Same', artist: 'A', length_ms: 200_000 })
    make_track({ title: 'Same', artist: 'A', length_ms: 200_000 })
    expect(find_duplicates(db)).toEqual([])
    expect(find_duplicates(db, { reasons: ['fuzzy'] })).toHaveLength(1)
  })

  it('ignores diacritics and featured-artist suffixes', () => {
    make_track({ title: 'Cafe (feat. Someone)', artist: 'Bjork', length_ms: 200_000 })
    make_track({ title: 'Café', artist: 'Björk', length_ms: 200_500 })
    expect(find_duplicates(db, { reasons: ['fuzzy'] })).toHaveLength(1)
  })

  it('does not group two recordings whose durations differ materially', () => {
    make_track({ title: 'Take Five', artist: 'Brubeck', length_ms: 324_000 })
    make_track({ title: 'Take Five', artist: 'Brubeck', length_ms: 800_000 })
    expect(find_duplicates(db, { reasons: ['fuzzy'] })).toEqual([])
  })

  it('honours a wider duration tolerance when asked', () => {
    make_track({ title: 'Drift', artist: 'A', length_ms: 300_000 })
    make_track({ title: 'Drift', artist: 'A', length_ms: 308_000 })

    expect(find_duplicates(db, { reasons: ['fuzzy'] })).toEqual([])
    expect(find_duplicates(db, { reasons: ['fuzzy'], length_tolerance_ms: 10_000 }))
      .toHaveLength(1)
  })

  it('puts a track in only one proposal, strongest evidence first', () => {
    const a = make_track({ title: 'Same', artist: 'A', identity_key: 'k', length_ms: 200_000 })
    const b = make_track({ title: 'Same', artist: 'A', identity_key: 'k', length_ms: 200_000 })
    add_media(a, '/a.flac', 'bb'.repeat(16))
    add_media(b, '/b.flac', 'bb'.repeat(16))

    const groups = find_duplicates(db)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.reason).toBe('audio_hash')
  })

  it('reports what each member brings to the decision', () => {
    const a = make_track({ title: 'X', artist: 'A' })
    add_media(a, '/x.flac', 'cc'.repeat(16))
    const b = make_track({ title: 'X', artist: 'A' })
    add_media(b, '/x.mp3', 'cc'.repeat(16))

    const m = find_duplicates(db)[0]!.members
    expect(m.every((x) => x.media_count === 1)).toBe(true)
    expect(m.map((x) => x.artist)).toEqual(['A', 'A'])
  })

  it('caps the number of proposals when asked', () => {
    for (let i = 0; i < 6; i++) {
      make_track({ identity_key: `k${i}` })
      make_track({ identity_key: `k${i}` })
    }
    expect(find_duplicates(db, { reasons: ['tags'], limit: 2 })).toHaveLength(2)
  })
})
