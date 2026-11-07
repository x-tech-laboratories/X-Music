// The entity model is the load-bearing decision: a track is a piece of music, not a file. These
// tests pin the invariants that follow from that (DESIGN-SPEC §3).

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from '../helpers/sqlite'

let db: TestDb

const lastId = (): number =>
  (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id

const addMedia = (trackId: number, uri: string, opts: Partial<{
  kind: string; codec: string; subtrack: number; start: number | null; end: number | null
}> = {}): number => {
  db.prepare(`INSERT INTO media (track_id, kind, uri, codec, subtrack_index, start_ms, end_ms, added)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(trackId, opts.kind ?? 'file', uri, opts.codec ?? 'flac',
         opts.subtrack ?? 0, opts.start ?? null, opts.end ?? null)
  return lastId()
}

beforeEach(() => { db = freshDb() })
afterEach(() => db.close())

describe('track and media', () => {
  it('a track can exist with no media at all', () => {
    db.prepare('INSERT INTO tracks (title, added, modified) VALUES (?, 0, 0)').run('Wishlist item')
    const id = lastId()
    const media = db.prepare('SELECT COUNT(*) AS n FROM media WHERE track_id = ?').get(id) as { n: number }
    expect(media.n).toBe(0)
  })

  it('one track can have several media in different formats', () => {
    db.prepare('INSERT INTO tracks (title, added, modified) VALUES (?, 0, 0)').run('Blue in Green')
    const t = lastId()
    addMedia(t, '/music/blue.flac', { codec: 'flac' })
    addMedia(t, '/music/blue.mp3', { codec: 'mp3' })
    addMedia(t, 'subsonic://server/42', { kind: 'stream', codec: 'opus' })

    const rows = db.prepare('SELECT kind, codec FROM media WHERE track_id = ? ORDER BY id').all(t)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => (r as { kind: string }).kind)).toEqual(['file', 'file', 'stream'])
  })

  it('deleting a media row leaves the track and its statistics intact', () => {
    db.prepare('INSERT INTO tracks (title, rating, play_count, added, modified) VALUES (?, 80, 12, 0, 0)')
      .run('So What')
    const t = lastId()
    const m = addMedia(t, '/music/sowhat.flac')

    db.prepare('DELETE FROM media WHERE id = ?').run(m)

    const row = db.prepare('SELECT rating, play_count FROM tracks WHERE id = ?').get(t) as
      { rating: number; play_count: number }
    expect(row.rating).toBe(80)
    expect(row.play_count).toBe(12)
  })

  it('deleting a track cascades to its media', () => {
    db.prepare('INSERT INTO tracks (title, added, modified) VALUES (?, 0, 0)').run('Flamenco Sketches')
    const t = lastId()
    addMedia(t, '/music/flamenco.flac')

    db.prepare('DELETE FROM tracks WHERE id = ?').run(t)
    const n = db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }
    expect(n.n).toBe(0)
  })

  it('CUE ranges are ordinary media rows addressing one container', () => {
    db.prepare('INSERT INTO tracks (title, added, modified) VALUES (?, 0, 0)').run('Side A track 1')
    const t1 = lastId()
    db.prepare('INSERT INTO tracks (title, added, modified) VALUES (?, 0, 0)').run('Side A track 2')
    const t2 = lastId()

    addMedia(t1, '/music/live.flac', { subtrack: 1, start: 0, end: 240_000 })
    addMedia(t2, '/music/live.flac', { subtrack: 2, start: 240_000, end: 511_000 })

    const rows = db.prepare('SELECT COUNT(*) AS n FROM media WHERE uri = ?').get('/music/live.flac') as
      { n: number }
    expect(rows.n).toBe(2)
  })

  it('refuses two media rows for the same range of the same file', () => {
    db.prepare('INSERT INTO tracks (title, added, modified) VALUES (?, 0, 0)').run('dupe')
    const t = lastId()
    addMedia(t, '/music/x.flac', { subtrack: 0 })
    expect(() => addMedia(t, '/music/x.flac', { subtrack: 0 })).toThrow()
  })

  it('a missing file is flagged, not deleted', () => {
    db.prepare('INSERT INTO tracks (title, added, modified) VALUES (?, 0, 0)').run('On an external drive')
    const t = lastId()
    const m = addMedia(t, '/mnt/usb/track.flac')

    db.prepare('UPDATE media SET present = 0 WHERE id = ?').run(m)

    const row = db.prepare('SELECT present FROM media WHERE id = ?').get(m) as { present: number }
    expect(row.present).toBe(0)
    const track = db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE id = ?').get(t) as { n: number }
    expect(track.n).toBe(1)
  })

  it('a pinned identity is recorded so automated passes can skip it', () => {
    db.prepare(`INSERT INTO tracks (title, pinned, identity_source, added, modified)
                VALUES (?, 1, 'manual', 0, 0)`).run('Manually merged')
    const row = db.prepare('SELECT pinned, identity_source FROM tracks WHERE id = ?')
      .get(lastId()) as { pinned: number; identity_source: string }
    expect(row.pinned).toBe(1)
    expect(row.identity_source).toBe('manual')
  })
})

describe('albums', () => {
  it('keeps a stable id while the derived match key changes', () => {
    db.prepare("INSERT INTO albums (match_key, name, added) VALUES ('a\\x1fb\\x1f1959', 'Kind of Blue', 0)").run()
    const id = lastId()

    db.prepare('UPDATE albums SET match_key = ? WHERE id = ?').run('mbid:abc-123', id)

    const row = db.prepare('SELECT id, match_key FROM albums WHERE id = ?').get(id) as
      { id: number; match_key: string }
    expect(row.id).toBe(id)
    expect(row.match_key).toBe('mbid:abc-123')
  })

  it('refuses two albums with the same match key', () => {
    db.prepare("INSERT INTO albums (match_key, added) VALUES ('dup', 0)").run()
    expect(() => db.prepare("INSERT INTO albums (match_key, added) VALUES ('dup', 0)").run()).toThrow()
  })
})

describe('schema hygiene', () => {
  it('enforces foreign keys', () => {
    expect(() =>
      db.prepare(`INSERT INTO media (track_id, kind, uri, added) VALUES (9999, 'file', '/x', 0)`).run()
    ).toThrow()
  })

  it('uses STRICT tables so a type error is caught at write time', () => {
    expect(() =>
      db.prepare('INSERT INTO tracks (title, year, added, modified) VALUES (?, ?, 0, 0)')
        .run('x', 'not a number')
    ).toThrow()
  })
})
