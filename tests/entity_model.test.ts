// The entity model is the load-bearing decision: a track is a piece of music, not a file. These
// tests pin the invariants that follow from that (DESIGN-SPEC §3).

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { new_id } from '@shared/library/database'
import { addTrack, freshDb, type TestDb } from './sqlite.ts'

let db: TestDb

const addMedia = (trackId: string, uri: string, opts: Partial<{
  kind: string; codec: string; subtrack: number; start: number | null; end: number | null
}> = {}): string => {
  const id = new_id()
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, codec, subtrack_index, start_ms, end_ms, added)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(id, trackId, opts.kind ?? 'file', uri, opts.codec ?? 'flac',
         opts.subtrack ?? 0, opts.start ?? null, opts.end ?? null)
  return id
}

beforeEach(() => { db = freshDb() })
afterEach(() => db.close())

describe('track and media', () => {
  it('a track can exist with no media at all', () => {
    const id = addTrack(db, { title: 'Wishlist item' })
    const media = db.prepare('SELECT COUNT(*) AS n FROM media WHERE track_id = ?').get(id) as { n: number }
    expect(media.n).toBe(0)
  })

  it('one track can have several media in different formats', () => {
    const t = addTrack(db, { title: 'Blue in Green' })
    addMedia(t, '/music/blue.flac', { codec: 'flac' })
    addMedia(t, '/music/blue.mp3', { codec: 'mp3' })
    addMedia(t, 'subsonic://server/42', { kind: 'stream', codec: 'opus' })

    const rows = db.prepare('SELECT kind, codec FROM media WHERE track_id = ? ORDER BY rowid').all(t)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => (r as { kind: string }).kind)).toEqual(['file', 'file', 'stream'])
  })

  it('deleting a media row leaves the track and its statistics intact', () => {
    const t = addTrack(db, { title: 'So What', rating: 80, play_count: 12 })
    const m = addMedia(t, '/music/sowhat.flac')

    db.prepare('DELETE FROM media WHERE id = ?').run(m)

    const row = db.prepare('SELECT rating, play_count FROM tracks WHERE id = ?').get(t) as
      { rating: number; play_count: number }
    expect(row.rating).toBe(80)
    expect(row.play_count).toBe(12)
  })

  it('deleting a track cascades to its media', () => {
    const t = addTrack(db, { title: 'Flamenco Sketches' })
    addMedia(t, '/music/flamenco.flac')

    db.prepare('DELETE FROM tracks WHERE id = ?').run(t)
    const n = db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }
    expect(n.n).toBe(0)
  })

  it('CUE ranges are ordinary media rows addressing one container', () => {
    const t1 = addTrack(db, { title: 'Side A track 1' })
    const t2 = addTrack(db, { title: 'Side A track 2' })

    addMedia(t1, '/music/live.flac', { subtrack: 1, start: 0, end: 240_000 })
    addMedia(t2, '/music/live.flac', { subtrack: 2, start: 240_000, end: 511_000 })

    const rows = db.prepare('SELECT COUNT(*) AS n FROM media WHERE uri = ?').get('/music/live.flac') as
      { n: number }
    expect(rows.n).toBe(2)
  })

  it('refuses two media rows for the same range of the same file', () => {
    const t = addTrack(db, { title: 'dupe' })
    addMedia(t, '/music/x.flac', { subtrack: 0 })
    expect(() => addMedia(t, '/music/x.flac', { subtrack: 0 })).toThrow()
  })

  it('a missing file is flagged, not deleted', () => {
    const t = addTrack(db, { title: 'On an external drive' })
    const m = addMedia(t, '/mnt/usb/track.flac')

    db.prepare('UPDATE media SET present = 0 WHERE id = ?').run(m)

    const row = db.prepare('SELECT present FROM media WHERE id = ?').get(m) as { present: number }
    expect(row.present).toBe(0)
    const track = db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE id = ?').get(t) as { n: number }
    expect(track.n).toBe(1)
  })

  it('a pinned identity is recorded so automated passes can skip it', () => {
    const id = addTrack(db, { title: 'Manually merged', pinned: 1, identity_source: 'manual' })
    const row = db.prepare('SELECT pinned, identity_source FROM tracks WHERE id = ?')
      .get(id) as { pinned: number; identity_source: string }
    expect(row.pinned).toBe(1)
    expect(row.identity_source).toBe('manual')
  })
})

describe('albums', () => {
  it('keeps a stable id while the derived match key changes', () => {
    const id = new_id()
    db.prepare("INSERT INTO albums (id, match_key, name, added) VALUES (?, 'a\\x1fb\\x1f1959', 'Kind of Blue', 0)").run(id)

    db.prepare('UPDATE albums SET match_key = ? WHERE id = ?').run('mbid:abc-123', id)

    const row = db.prepare('SELECT id, match_key FROM albums WHERE id = ?').get(id) as
      { id: string; match_key: string }
    expect(row.id).toBe(id)
    expect(row.match_key).toBe('mbid:abc-123')
  })

  it('refuses two albums with the same match key', () => {
    db.prepare("INSERT INTO albums (id, match_key, added) VALUES (?, 'dup', 0)").run(new_id())
    expect(() => db.prepare("INSERT INTO albums (id, match_key, added) VALUES (?, 'dup', 0)").run(new_id())).toThrow()
  })
})

describe('schema hygiene', () => {
  it('enforces foreign keys', () => {
    expect(() =>
      db.prepare(`INSERT INTO media (id, track_id, kind, uri, added) VALUES (?, 'no-such-track', 'file', '/x', 0)`).run(new_id())
    ).toThrow()
  })

  it('refuses a row without an id, which SQLite would otherwise allow for a text key', () => {
    for (const table of ['tracks', 'albums', 'values_', 'media', 'play_history', 'playlists', 'roots', 'artwork']) {
      const row = db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table) as { sql: string }
      expect(row.sql, table).toContain('IS NOT NULL')
    }
    expect(() => db.prepare('INSERT INTO tracks (id, title, added, modified) VALUES (NULL, ?, 0, 0)').run('x')).toThrow(/CHECK/)
    expect(() => db.prepare("INSERT INTO roots (id, path) VALUES (NULL, '/music')").run()).toThrow(/CHECK/)
  })
})
