// A library as X-Music kept it before ids every device can make: the old schema at a given step, with a row of every
// kind a real library holds, including a merge that can still be undone.

import { migrate } from '@x-tech-laboratories/x-libs/sql'

import { legacy_steps } from '@shared/library/legacy_steps'
import { bareDb, type TestDb } from './sqlite.ts'

export const HASH = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02])

const track = (id: number, title: string, album: number | null, extra: Record<string, number | string | null> = {}) => ({
  id, title, album_id: album, year: 1959, track_number: id, disc_number: 1, length_ms: 300_000 + id, compilation: 0, bpm: null,
  rating: null, play_count: 0, skip_count: 0, first_played: null, last_played: null, last_skipped: null, added: 1_000 + id,
  pinned: 0, mb_recording_id: null, album: album === null ? null : 'Merged album', ...extra
})

// The snapshot the old merge wrote when track 9 was merged into track 3.
export const OLD_MERGE_SNAPSHOT = {
  tracks: [
    track(3, 'Survivor', 2, { rating: 60, play_count: 3 }),
    track(9, 'Absorbed', 2, { rating: 80, play_count: 5, last_played: 9_000 })
  ],
  sets: [
    { track_id: 3, field_id: 1, value: 'Bill Evans', ordinal: 0 },
    { track_id: 9, field_id: 1, value: 'Bill Evans Trio', ordinal: 0 }
  ],
  extras: [{ track_id: 9, field_id: 20, value: 'from the absorbed copy' }],
  media: [{ id: 4, track_id: 3 }, { id: 5, track_id: 9 }],
  history: [{ id: 4, track_id: 9 }],
  historyDeleted: [],
  playlists: [{ playlist_id: 2, track_id: 9, position: 0 }]
}

// Builds the old schema up to the step given, without any rows.
export function legacySchema(steps = legacy_steps.length, path = ':memory:'): TestDb {
  const db = bareDb(path)
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db, legacy_steps.slice(0, steps))
  return db
}

// A library at the last old step with a row in every table.
export function legacyLibrary(path = ':memory:'): TestDb {
  const db = legacySchema(legacy_steps.length, path)
  db.exec(`
    INSERT INTO values_ (id, field_id, value) VALUES (1, 1, 'Miles Davis'), (2, 4, 'Jazz'), (3, 2, 'Miles Davis'), (4, 4, 'Modal'), (5, 1, 'Bill Evans');
    INSERT INTO albums (id, match_key, name, album_artist_id, year, mb_release_id, added)
      VALUES (1, 'a' || char(31) || 'miles davis' || char(31) || 'kind of blue' || char(31) || '1959' || char(31), 'Kind of Blue', 3, 1959, 'mb-release', 10),
             (2, 'a' || char(31) || 'bill evans' || char(31) || 'merged album' || char(31) || '1959' || char(31), 'Merged album', NULL, 1959, NULL, 11);
    INSERT INTO tracks (id, title, album_id, year, track_number, length_ms, rating, play_count, skip_count, first_played, last_played,
                        last_skipped, bookmark_ms, loved, rg_track_gain, rg_album_gain, pinned, identity_source, identity_key, mb_recording_id,
                        added, modified)
      VALUES (1, 'So What', 1, 1959, 1, 562000, 100, 42, 2, 500, 2000, 1500, 12000, 1, -6.5, -7.25, 1, 'manual', 'mbid' || char(31) || 'rec-1', 'rec-1', 100, 200),
             (2, 'Blue in Green', 1, 1959, 3, 337000, NULL, 7, 0, NULL, 3000, NULL, NULL, 0, NULL, NULL, 0, 'heuristic', NULL, NULL, 101, 201),
             (3, 'Survivor', 2, 1959, 3, 300003, 80, 8, 0, NULL, 9000, NULL, NULL, 0, NULL, NULL, 1, 'manual', NULL, NULL, 1003, 300);
    INSERT INTO media (id, track_id, kind, uri, audio_hash, audio_hash_algo, codec, bitrate, present, quality_rank, added)
      VALUES (1, 1, 'file', '/music/so-what.flac', X'DEADBEEF0102', 'flac-streaminfo-md5', 'flac', 900, 1, 10900, 100),
             (2, 1, 'file', '/music/so-what.mp3', NULL, NULL, 'mp3', 320, 0, 320, 101),
             (3, 2, 'file', '/music/blue.flac', NULL, NULL, 'flac', 880, 1, 10880, 102),
             (4, 3, 'file', '/music/merged-a.flac', NULL, NULL, 'flac', 800, 1, 10800, 103),
             (5, 3, 'file', '/music/merged-b.flac', NULL, NULL, 'flac', 700, 1, 10700, 104);
    UPDATE tracks SET primary_media_id = 1 WHERE id = 1;
    INSERT INTO media_tags (media_id, field_id, ordinal, value) VALUES (1, 1, 0, 'Miles Davis');
    INSERT INTO track_values (track_id, field_id, value_id, ordinal)
      VALUES (1, 1, 1, 0), (1, 4, 2, 0), (1, 4, 4, 1), (1, 2, 3, 0), (2, 1, 1, 0), (3, 1, 5, 0);
    INSERT INTO track_extras (track_id, field_id, value) VALUES (1, 20, 'The first track');
    INSERT INTO play_history (id, track_id, media_id, at, kind, position_ms)
      VALUES (1, 1, 1, 1000, 0, NULL), (2, 1, NULL, 1500, 1, 4000), (3, 2, 3, 3000, 0, NULL), (4, 3, NULL, 9000, 0, NULL);
    INSERT INTO tag_writes (id, batch_id, media_id, field_id, old_value, new_value, at, applied) VALUES (1, 7, 1, 1, 'Miles', 'Miles Davis', 400, 1);
    INSERT INTO playlists (id, name, kind, definition, parent_id, position, created, modified)
      VALUES (1, 'Favourites', 'static', NULL, NULL, 0, 10, 20), (2, 'Late night', 'static', NULL, 1, 1, 11, 21);
    INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (1, 1, 0), (1, 2, 1), (2, 3, 0);
    INSERT INTO roots (id, path, slow, enabled, last_scan) VALUES (1, '/music', 0, 1, 5000);
    INSERT INTO settings (key, value) VALUES ('ui.density', '"compact"');
    INSERT INTO artwork (id, album_id, track_id, source, origin, hash, path, width, height, bytes, found_at)
      VALUES (1, 1, NULL, 'embedded', '/music/so-what.flac', 'abc', '/cache/ab/abc.jpg', 600, 600, 1234, 50),
             (2, NULL, 3, 'none', NULL, NULL, NULL, NULL, NULL, NULL, 60);
  `)
  db.prepare('INSERT INTO merge_journal (id, batch_id, at, survivor_id, snapshot, undone) VALUES (1, ?, 9500, 3, ?, 0)')
    .run('merge-9500-3', JSON.stringify(OLD_MERGE_SNAPSHOT))
  return db
}

export const LEGACY_TABLES = [
  'values_', 'albums', 'tracks', 'media', 'media_tags', 'track_values', 'track_extras', 'play_history', 'tag_writes',
  'playlists', 'playlist_tracks', 'roots', 'settings', 'merge_journal', 'artwork'
] as const

export function counts(db: TestDb): Record<string, number> {
  return Object.fromEntries(LEGACY_TABLES.map((table) => [table, (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]))
}
