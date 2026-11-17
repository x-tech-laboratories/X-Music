// A library made before ids every device can make must open on the new schema with nothing lost: every row, every
// reference between rows, the statistics, and a merge that can still be undone.

import { describe, expect, it } from 'vitest'

import { legacy_steps } from '@shared/library/legacy_steps'
import { describe_upgrade, is_legacy } from '@shared/library/legacy'
import { unmerge } from '@shared/library/merge'
import { migrations } from '@shared/library/migrations/index'
import { needs_upgrade, open_library } from '@shared/library/store'
import { createUpserter } from '@shared/library/identity'
import { counts, HASH, legacyLibrary, legacySchema, OLD_MERGE_SNAPSHOT } from './legacy.ts'
import { freshDb, type TestDb } from './sqlite.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const one = <Row>(db: TestDb, sql: string, ...params: (string | number | null)[]): Row =>
  db.prepare(sql).get(...params) as Row
const all = <Row>(db: TestDb, sql: string, ...params: (string | number | null)[]): Row[] =>
  db.prepare(sql).all(...params) as Row[]
const trackId = (db: TestDb, title: string): string => one<{ id: string }>(db, 'SELECT id FROM tracks WHERE title = ?', title).id

function upgraded(): { db: TestDb; before: Record<string, number> } {
  const db = legacyLibrary()
  const before = counts(db)
  open_library(db)
  return { db, before }
}

describe('upgrading a library from the old schema', () => {
  it('says an old library needs upgrading, and a new or current one does not', () => {
    expect(needs_upgrade(legacyLibrary())).toBe(true)
    expect(needs_upgrade(freshDb())).toBe(false)
    expect(needs_upgrade(upgraded().db)).toBe(false)
  })

  it('keeps every row of every table', () => {
    const { db, before } = upgraded()

    expect(counts(db)).toEqual(before)
  })

  it('gives every row an id any device could have made', () => {
    const { db } = upgraded()

    for (const table of ['values_', 'albums', 'tracks', 'media', 'play_history', 'tag_writes', 'playlists', 'roots', 'merge_journal', 'artwork']) {
      for (const { id } of all<{ id: unknown }>(db, `SELECT id FROM ${table}`)) expect(id).toMatch(UUID)
    }
  })

  it('keeps a track\'s statistics, identity and loudness as they were', () => {
    const { db } = upgraded()

    expect(one(db, `SELECT title, year, track_number, length_ms, rating, play_count, skip_count, first_played, last_played,
                           last_skipped, bookmark_ms, loved, rg_track_gain, rg_album_gain, pinned, identity_source,
                           mb_recording_id, added, modified FROM tracks WHERE title = 'So What'`)).toEqual({
      title: 'So What', year: 1959, track_number: 1, length_ms: 562000, rating: 100, play_count: 42, skip_count: 2,
      first_played: 500, last_played: 2000, last_skipped: 1500, bookmark_ms: 12000, loved: 1, rg_track_gain: -6.5,
      rg_album_gain: -7.25, pinned: 1, identity_source: 'manual', mb_recording_id: 'rec-1', added: 100, modified: 200
    })
    expect(one(db, "SELECT rating FROM tracks WHERE title = 'Blue in Green'")).toEqual({ rating: null })
  })

  it('points every reference at the row it pointed at before', () => {
    const { db } = upgraded()
    const so_what = trackId(db, 'So What')

    expect(one(db, `SELECT a.name, v.value AS album_artist FROM tracks t JOIN albums a ON a.id = t.album_id
                    JOIN values_ v ON v.id = a.album_artist_id WHERE t.id = ?`, so_what))
      .toEqual({ name: 'Kind of Blue', album_artist: 'Miles Davis' })
    expect(one(db, 'SELECT m.uri FROM tracks t JOIN media m ON m.id = t.primary_media_id WHERE t.id = ?', so_what))
      .toEqual({ uri: '/music/so-what.flac' })
    expect(all(db, 'SELECT uri, present FROM media WHERE track_id = ? ORDER BY uri', so_what))
      .toEqual([{ uri: '/music/so-what.flac', present: 1 }, { uri: '/music/so-what.mp3', present: 0 }])
    expect(all(db, `SELECT tv.field_id, v.value, tv.ordinal FROM track_values tv JOIN values_ v ON v.id = tv.value_id
                    WHERE tv.track_id = ? ORDER BY tv.field_id, tv.ordinal`, so_what)).toEqual([
      { field_id: 1, value: 'Miles Davis', ordinal: 0 },
      { field_id: 2, value: 'Miles Davis', ordinal: 0 },
      { field_id: 4, value: 'Jazz', ordinal: 0 },
      { field_id: 4, value: 'Modal', ordinal: 1 }
    ])
    expect(one(db, 'SELECT value FROM track_extras WHERE track_id = ?', so_what)).toEqual({ value: 'The first track' })
    expect(all(db, `SELECT p.at, p.kind, p.position_ms, m.uri FROM play_history p LEFT JOIN media m ON m.id = p.media_id
                    WHERE p.track_id = ? ORDER BY p.at`, so_what)).toEqual([
      { at: 1000, kind: 0, position_ms: null, uri: '/music/so-what.flac' },
      { at: 1500, kind: 1, position_ms: 4000, uri: null }
    ])
    expect(one(db, `SELECT m.uri, mt.value FROM media_tags mt JOIN media m ON m.id = mt.media_id`))
      .toEqual({ uri: '/music/so-what.flac', value: 'Miles Davis' })
    expect(one(db, `SELECT w.batch_id, w.old_value, w.new_value, m.uri FROM tag_writes w JOIN media m ON m.id = w.media_id`))
      .toEqual({ batch_id: '7', old_value: 'Miles', new_value: 'Miles Davis', uri: '/music/so-what.flac' })
  })

  it('keeps the audio hash, so moved files are still recognised', () => {
    const { db } = upgraded()

    const row = one<{ audio_hash: Uint8Array }>(db, "SELECT audio_hash FROM media WHERE uri = '/music/so-what.flac'")
    expect([...row.audio_hash]).toEqual([...HASH])
  })

  it('keeps playlists in order, with their parents', () => {
    const { db } = upgraded()

    expect(all(db, `SELECT p.name, t.title, pt.position FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
                    JOIN tracks t ON t.id = pt.track_id ORDER BY p.name, pt.position`)).toEqual([
      { name: 'Favourites', title: 'So What', position: 0 },
      { name: 'Favourites', title: 'Blue in Green', position: 1 },
      { name: 'Late night', title: 'Survivor', position: 0 }
    ])
    expect(one(db, 'SELECT parent.name FROM playlists child JOIN playlists parent ON parent.id = child.parent_id'))
      .toEqual({ name: 'Favourites' })
  })

  it('keeps folders, settings and cover art', () => {
    const { db } = upgraded()

    expect(one(db, 'SELECT path, enabled, last_scan FROM roots')).toEqual({ path: '/music', enabled: 1, last_scan: 5000 })
    expect(one(db, "SELECT value FROM settings WHERE key = 'ui.density'")).toEqual({ value: '"compact"' })
    expect(one(db, `SELECT a.name FROM artwork w JOIN albums a ON a.id = w.album_id WHERE w.source = 'embedded'`))
      .toEqual({ name: 'Kind of Blue' })
    expect(one(db, `SELECT t.title FROM artwork w JOIN tracks t ON t.id = w.track_id WHERE w.source = 'none'`))
      .toEqual({ title: 'Survivor' })
  })

  it('rewrites the merge journal so an earlier merge can still be undone', () => {
    const { db } = upgraded()
    const survivor = trackId(db, 'Survivor')

    const snapshot = JSON.parse(one<{ snapshot: string }>(db, 'SELECT snapshot FROM merge_journal').snapshot) as typeof OLD_MERGE_SNAPSHOT
    expect(snapshot.tracks.map((track) => track.id)).toContain(survivor)
    expect(snapshot.tracks.every((track) => UUID.test(String(track.id)))).toBe(true)

    const result = unmerge(db, 'merge-9500-3')

    expect(result.survivor).toBe(survivor)
    const absorbed = result.restored[0]!
    expect(one(db, 'SELECT title, rating, play_count, last_played FROM tracks WHERE id = ?', absorbed))
      .toEqual({ title: 'Absorbed', rating: 80, play_count: 5, last_played: 9000 })
    expect(all(db, 'SELECT uri FROM media WHERE track_id = ?', absorbed)).toEqual([{ uri: '/music/merged-b.flac' }])
    expect(all(db, 'SELECT uri FROM media WHERE track_id = ?', survivor)).toEqual([{ uri: '/music/merged-a.flac' }])
    expect(all(db, 'SELECT at FROM play_history WHERE track_id = ?', absorbed)).toEqual([{ at: 9000 }])
    expect(one(db, 'SELECT track_id FROM playlist_tracks WHERE position = 0 AND track_id IN (?, ?)', absorbed, survivor))
      .toEqual({ track_id: absorbed })
    expect(one(db, 'SELECT a.name FROM tracks t JOIN albums a ON a.id = t.album_id WHERE t.id = ?', absorbed))
      .toEqual({ name: 'Merged album' })
  })

  it('leaves the schema current, whole and with nothing of the old one behind', () => {
    const { db } = upgraded()

    expect(is_legacy(db)).toBe(false)
    expect(one(db, 'PRAGMA user_version')).toEqual({ user_version: legacy_steps.length + 1 })
    expect(one(db, "SELECT version FROM schema_versions WHERE owner = 'library'")).toEqual({ version: migrations.length })
    expect(all(db, "SELECT name FROM sqlite_master WHERE name LIKE 'legacy%'")).toEqual([])
    expect(all(db, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
    expect(one(db, 'PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 })
  })

  it('gives every track a first version in its history', () => {
    const { db } = upgraded()

    expect(all(db, "SELECT kind FROM track_versions WHERE item_id = ?", trackId(db, 'So What'))).toEqual([{ kind: 'first_seen' }])
    expect(one(db, 'SELECT COUNT(*) AS n FROM track_versions')).toEqual({ n: 3 })
  })

  it('still matches a scanned file to its track afterwards, rather than adding a second', () => {
    const { db } = upgraded()
    const so_what = trackId(db, 'So What')

    const result = createUpserter(db)({ title: 'So What' }, { uri: '/music/so-what.flac', audioHash: HASH }, { metadata: false })

    expect(result).toMatchObject({ trackId: so_what, created: false, matchedBy: 'uri' })
    expect(one(db, 'SELECT COUNT(*) AS n FROM tracks')).toEqual({ n: 3 })
  })

  it('opens an upgraded library again without changing it', () => {
    const { db } = upgraded()
    const before = all(db, 'SELECT id, title FROM tracks ORDER BY id')

    open_library(db)

    expect(all(db, 'SELECT id, title FROM tracks ORDER BY id')).toEqual(before)
  })

  it('brings a library from the first old step through the rest before converting it', () => {
    const db = legacySchema(1)
    db.exec(`INSERT INTO tracks (id, title, added, modified) VALUES (1, 'Twice played', 0, 0);
             INSERT INTO play_history (track_id, at, kind) VALUES (1, 100, 0), (1, 100, 0), (1, 200, 0);`)

    open_library(db)

    expect(one(db, 'SELECT COUNT(*) AS n FROM play_history')).toEqual({ n: 2 })
    expect(one(db, "SELECT version FROM schema_versions WHERE owner = 'library'")).toEqual({ version: migrations.length })
  })

  it('changes nothing when a row cannot follow its references', () => {
    const db = legacyLibrary()
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec("INSERT INTO media (id, track_id, kind, uri, added) VALUES (99, 999, 'file', '/music/orphan.flac', 0)")
    const before = counts(db)

    expect(() => open_library(db)).toThrow(/media\.track_id: 1 row points at no tracks row/)

    expect(is_legacy(db)).toBe(true)
    expect(counts(db)).toEqual(before)
    expect(one(db, "SELECT typeof(id) AS type FROM tracks WHERE title = 'So What'")).toEqual({ type: 'integer' })
  })

  it('says which references it emptied because the row they named was gone', () => {
    const db = legacyLibrary()
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec("UPDATE tracks SET album_id = 99 WHERE title = 'Blue in Green'; UPDATE play_history SET media_id = 77 WHERE id = 3")

    const report = open_library(db)

    expect(report?.nulled).toEqual([{ table: 'tracks', column: 'album_id', rows: 1 }, { table: 'play_history', column: 'media_id', rows: 1 }])
    expect(describe_upgrade(report!)[0]).toBe('emptied tracks.album_id in 1 row, which named a row that was gone')
    expect(one(db, "SELECT album_id FROM tracks WHERE title = 'Blue in Green'")).toEqual({ album_id: null })
  })
})

describe('upgrading a merge whose absorbed numbers were reused', () => {
  // The old tables handed a deleted row's number to the next row made, so a merge's snapshot can name a live, unrelated row.
  function reused(): TestDb {
    const db = legacyLibrary()
    db.exec(`
      INSERT INTO tracks (id, title, rating, play_count, added, modified) VALUES (9, 'Unrelated new song', 100, 77, 20000, 20000);
      INSERT INTO media (id, track_id, kind, uri, added) VALUES (6, 9, 'file', '/music/new.flac', 20000);
      INSERT INTO play_history (track_id, at, kind) VALUES (9, 20000, 0);
      INSERT INTO track_values (track_id, field_id, value_id, ordinal) VALUES (9, 1, 1, 0);
      INSERT INTO track_extras (track_id, field_id, value) VALUES (9, 20, 'a note');
      INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (1, 9, 5);`)
    return db
  }

  it('brings the absorbed track back as its own row and leaves the new track alone', () => {
    const db = reused()

    const report = open_library(db)
    const unrelated = trackId(db, 'Unrelated new song')
    const result = unmerge(db, 'merge-9500-3')

    expect(report?.reused).toContainEqual({ batch_id: 'merge-9500-3', kind: 'tracks', old: 9 })
    expect(describe_upgrade(report!)).toEqual(['merge merge-9500-3 named tracks 9, which later rows had taken; undoing it leaves those rows alone'])
    expect(result.restored).not.toContain(unrelated)
    expect(one(db, 'SELECT title, rating, play_count FROM tracks WHERE id = ?', unrelated)).toEqual({ title: 'Unrelated new song', rating: 100, play_count: 77 })
    expect(all(db, 'SELECT uri FROM media WHERE track_id = ?', unrelated)).toEqual([{ uri: '/music/new.flac' }])
    expect(one(db, 'SELECT COUNT(*) AS n FROM play_history WHERE track_id = ?', unrelated)).toEqual({ n: 1 })
    expect(one(db, 'SELECT COUNT(*) AS n FROM track_values WHERE track_id = ?', unrelated)).toEqual({ n: 1 })
    expect(one(db, 'SELECT value FROM track_extras WHERE track_id = ?', unrelated)).toEqual({ value: 'a note' })
    expect(one(db, 'SELECT position FROM playlist_tracks WHERE track_id = ?', unrelated)).toEqual({ position: 5 })
    expect(one(db, 'SELECT title, rating, play_count FROM tracks WHERE id = ?', result.restored[0]!)).toEqual({ title: 'Absorbed', rating: 80, play_count: 5 })
    expect(all(db, 'SELECT uri FROM media WHERE track_id = ?', result.restored[0]!)).toEqual([{ uri: '/music/merged-b.flac' }])
  })

  it('leaves a file or play whose number was reused with the track that has it now', () => {
    const db = legacyLibrary()
    db.exec(`
      DELETE FROM media WHERE id = 5; DELETE FROM play_history WHERE id = 4;
      INSERT INTO media (id, track_id, kind, uri, added) VALUES (5, 2, 'file', '/music/other.flac', 20000);
      INSERT INTO play_history (id, track_id, at, kind) VALUES (4, 2, 20000, 0);`)

    const report = open_library(db)
    const blue = trackId(db, 'Blue in Green')
    const result = unmerge(db, 'merge-9500-3')

    expect(report?.reused).toEqual(expect.arrayContaining([
      { batch_id: 'merge-9500-3', kind: 'media', old: 5 }, { batch_id: 'merge-9500-3', kind: 'play_history', old: 4 }
    ]))
    expect(all(db, 'SELECT uri FROM media WHERE track_id = ? ORDER BY uri', blue)).toEqual([{ uri: '/music/blue.flac' }, { uri: '/music/other.flac' }])
    expect(all(db, 'SELECT at FROM play_history WHERE track_id = ? ORDER BY at', blue)).toEqual([{ at: 3000 }, { at: 20000 }])
    expect(all(db, 'SELECT uri FROM media WHERE track_id = ?', result.restored[0]!)).toEqual([])
  })
})

