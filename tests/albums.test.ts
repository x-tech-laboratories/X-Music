// Album identity (DESIGN-SPEC §17.1): which tracks share an album row, and that the rows stay put
// across rescans instead of multiplying.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { album_match_key, regroup_albums } from '@shared/library/albums'
import { new_id } from '@shared/library/database'
import { create_upserter, type TrackCandidate } from '@shared/library/identity'
import { fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb
let upsert: ReturnType<typeof create_upserter>

const albums = (): number => (db.prepare('SELECT COUNT(*) AS n FROM albums').get() as { n: number }).n
const album_of = (track_id: string): string =>
  (db.prepare('SELECT album_id AS a FROM tracks WHERE id = ?').get(track_id) as { a: string }).a

// Imports one track at `uri`, returning its track id.
function add(t: TrackCandidate, uri: string): string {
  const sets = { artist: t.artist ? [t.artist] : [], album_artist: t.album_artist ? [t.album_artist] : [] }
  return upsert({ sets, ...t }, { uri }, { metadata: true }).track_id
}

beforeEach(() => {
  db = fresh_db()
  upsert = create_upserter(db)
})

afterEach(() => db.close())

describe('album match key', () => {
  it('ignores case, diacritics, spacing and edition notes', () => {
    const a = album_match_key({ album: 'Café  Tacvba', artist: 'X', year: 1994 })
    const b = album_match_key({ album: 'cafe tacvba (Remastered)', artist: 'x', year: 1994 })
    const c = album_match_key({ album: 'Cafe Tacvba [Deluxe Edition]', artist: 'X', year: 1994 })
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('keeps different years apart, so a remaster is its own album', () => {
    expect(album_match_key({ album: 'A', artist: 'X', year: 1973 }))
      .not.toBe(album_match_key({ album: 'A', artist: 'X', year: 2011 }))
  })

  it('agrees whether the artist tag was split or not, as the importer and scanner differ', () => {
    expect(album_match_key({ album: 'A', artist: 'X; Y' })).toBe(album_match_key({ album: 'A', artist: 'X' }))
    expect(album_match_key({ album: 'A', artist: 'X feat. Z' })).toBe(album_match_key({ album: 'A', artist: 'X' }))
  })

  it('prefers the album artist over the track artist', () => {
    expect(album_match_key({ album: 'A', artist: 'Guest', album_artist: 'Band' }))
      .toBe(album_match_key({ album: 'A', artist: 'Band' }))
  })

  it('uses the MusicBrainz release id when there is one', () => {
    expect(album_match_key({ album: 'A', artist: 'X', mb_release_id: 'r1' }))
      .toBe(album_match_key({ album: 'Other', artist: 'Y', mb_release_id: 'r1' }))
  })

  it('separates generic album names by folder', () => {
    expect(album_match_key({ album: 'CD1', artist: 'X' }, '/m/one/a.mp3'))
      .not.toBe(album_match_key({ album: 'CD1', artist: 'X' }, '/m/two/a.mp3'))
    expect(album_match_key({ album: 'Real Name', artist: 'X' }, '/m/one/a.mp3'))
      .toBe(album_match_key({ album: 'Real Name', artist: 'X' }, '/m/two/a.mp3'))
  })

  it('has no album for a track with no album name', () => {
    expect(album_match_key({ album: '  ', artist: 'X' })).toBeNull()
  })
})

describe('regrouping', () => {
  it('files three artists with no album artist under one compilation', () => {
    const ids = ['P', 'Q', 'R'].map((artist, i) => add({ album: 'Soundtrack', artist, year: 2000 }, `/m/${i}.mp3`))
    expect(new Set(ids.map(album_of)).size).toBe(3)

    const r = regroup_albums(db)
    expect(r.compilations_found).toBe(1)
    expect(new Set(ids.map(album_of)).size).toBe(1)
    expect(albums()).toBe(1)
    expect((db.prepare('SELECT is_compilation AS c FROM albums').get() as { c: number }).c).toBe(1)
  })

  it('leaves two artists on separate albums', () => {
    add({ album: 'Split', artist: 'P', year: 2000 }, '/m/1.mp3')
    add({ album: 'Split', artist: 'Q', year: 2000 }, '/m/2.mp3')
    expect(regroup_albums(db).compilations_found).toBe(0)
    expect(albums()).toBe(2)
  })

  it('does not treat tracks with an album artist as a compilation', () => {
    for (const [i, artist] of ['P', 'Q', 'R'].entries()) {
      add({ album: 'Hits', artist, album_artist: 'Band', year: 2000 }, `/m/${i}.mp3`)
    }
    expect(regroup_albums(db).compilations_found).toBe(0)
    expect(albums()).toBe(1)
  })

  it('files a tagged compilation together without waiting for a regroup', () => {
    const a = add({ album: 'Mix', artist: 'P', compilation: true }, '/m/1.mp3')
    const b = add({ album: 'Mix', artist: 'Q', compilation: true }, '/m/2.mp3')
    expect(album_of(a)).toBe(album_of(b))
  })

  it('keeps album ids stable when the same files are read again', () => {
    const tracks = [
      { album: 'Soundtrack', artist: 'P', year: 2000 },
      { album: 'Soundtrack', artist: 'Q', year: 2000 },
      { album: 'Soundtrack', artist: 'R', year: 2000 },
      { album: 'Solo', artist: 'S; T', year: 1990 }
    ]
    const ids = tracks.map((t, i) => add(t, `/m/${i}.mp3`))
    regroup_albums(db)
    const before = ids.map(album_of)
    const count = albums()

    // A rescan reads the split artist tag differently from the importer.
    tracks.forEach((t, i) => add({ ...t, artist: t.artist.split(';')[0]! }, `/m/${i}.mp3`))
    regroup_albums(db)

    expect(ids.map(album_of)).toEqual(before)
    expect(albums()).toBe(count)
  })

  it('deletes albums no track points at', () => {
    const id = add({ album: 'Old Name', artist: 'P' }, '/m/1.mp3')
    add({ album: 'New Name', artist: 'P' }, '/m/1.mp3')
    expect(albums()).toBe(2)

    expect(regroup_albums(db).albums_removed).toBe(1)
    expect(albums()).toBe(1)
    expect(album_of(id)).not.toBeNull()
  })

  it('keeps an empty album that is pinned or that an undoable merge refers to', () => {
    db.prepare("INSERT INTO albums (id, match_key, name, pinned, added) VALUES (?, 'pinned', 'P', 1, 0)").run(new_id())
    const journaled = new_id()
    db.prepare("INSERT INTO albums (id, match_key, name, added) VALUES (?, 'journaled', 'J', 0)").run(journaled)
    db.prepare("INSERT INTO albums (id, match_key, name, added) VALUES (?, 'orphan', 'O', 0)").run(new_id())
    db.prepare('INSERT INTO merge_journal (id, batch_id, at, survivor_id, snapshot) VALUES (?, ?, 0, ?, ?)')
      .run(new_id(), 'b1', new_id(), JSON.stringify({ tracks: [{ id: new_id(), album_id: journaled }] }))

    regroup_albums(db)
    const keys = (db.prepare('SELECT match_key AS k FROM albums ORDER BY k').all() as { k: string }[]).map((r) => r.k)
    expect(keys).toEqual(['journaled', 'pinned'])
  })

  it('never moves a track off a pinned album', () => {
    const id = add({ album: 'Arranged', artist: 'P' }, '/m/1.mp3')
    const album = album_of(id)
    db.prepare('UPDATE albums SET pinned = 1 WHERE id = ?').run(album)

    add({ album: 'Retagged', artist: 'P' }, '/m/1.mp3')
    expect(album_of(id)).toBe(album)
  })
})
