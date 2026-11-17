// Re-running an import or a scan must not duplicate anything. This test exists to prove it, and
// initially to prove that it did not.

import { describe, expect, it } from 'vitest'
import { parseGmbrc } from '@shared/import/gmbrc'
import { importGmbrc } from '@shared/import/gmb_import'
import { createUpserter } from '@shared/library/identity'
import { freshDb } from './sqlite.ts'

const HEADER = [
  'added', 'album', 'album_artist_raw', 'artist', 'bitrate', 'channel', 'comment', 'compilation',
  'disc', 'file', 'filetype', 'genre', 'grouping', 'label', 'lastplay', 'lastskip', 'length',
  'length_estimated', 'missing', 'modif', 'path', 'playcount', 'playhistory', 'rating',
  'replaygain_album_gain', 'replaygain_album_peak', 'replaygain_track_gain',
  'replaygain_track_peak', 'samprate', 'size', 'skipcount', 'title', 'track', 'version', 'year'
].join('\t')

const row = (id: number, over: Record<string, string> = {}): string => {
  const base: Record<string, string> = {
    added: '1557634244', album: 'Kind of Blue', album_artist_raw: 'Miles Davis',
    artist: 'Miles Davis', bitrate: '500', channel: '2', comment: '', compilation: '0',
    disc: '1', file: `track${id}.flac`, filetype: 'flac', genre: 'Jazz', grouping: '',
    label: '', lastplay: '1783048616', lastskip: '0', length: '562', length_estimated: '0',
    missing: '0', modif: '1785683459', path: '/music/miles', playcount: '12',
    playhistory: '1557762781 1558323959', rating: '80', replaygain_album_gain: '-8.81',
    replaygain_album_peak: '1.0', replaygain_track_gain: '-3.72', replaygain_track_peak: '0.86',
    samprate: '44100', size: '6420149', skipcount: '2', title: `Track ${id}`, track: String(id),
    version: '', year: '1959', ...over
  }
  return [String(id), ...HEADER.split('\t').map((c) => base[c] ?? '')].join('\t')
}

const gmbrc = (rows: string[]): string =>
  `# gmbrc version=1.1 time=1\n[Options]\nBaseFolder: '/music'\n[Songs]\n${HEADER}\n${rows.join('\n')}\n[EOF]\n`

const counts = (db: ReturnType<typeof freshDb>) => ({
  tracks: (db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n,
  media: (db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n,
  history: (db.prepare('SELECT COUNT(*) AS n FROM play_history').get() as { n: number }).n,
  values: (db.prepare('SELECT COUNT(*) AS n FROM track_values').get() as { n: number }).n
})

describe('importing the same gmbrc twice', () => {
  it('does not duplicate tracks, media, history or values', () => {
    const db = freshDb()
    const data = parseGmbrc(gmbrc([row(1), row(2), row(3)]))

    importGmbrc(db, data)
    const first = counts(db)

    importGmbrc(db, data)
    const second = counts(db)

    expect(second).toEqual(first)
    db.close()
  })

  it('leaves every track with exactly one media row', () => {
    const db = freshDb()
    const data = parseGmbrc(gmbrc([row(1), row(2)]))
    importGmbrc(db, data)
    importGmbrc(db, data)

    const orphans = (db.prepare(
      'SELECT COUNT(*) AS n FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.track_id = t.id)'
    ).get() as { n: number }).n
    expect(orphans).toBe(0)
    db.close()
  })

  it('updates statistics rather than stacking a second copy', () => {
    const db = freshDb()
    importGmbrc(db, parseGmbrc(gmbrc([row(1)])))
    importGmbrc(db, parseGmbrc(gmbrc([row(1, { playcount: '20', rating: '100' })])))

    const t = db.prepare('SELECT rating, play_count FROM tracks').get() as
      { rating: number; play_count: number }
    expect(t.rating).toBe(100)
    expect(t.play_count).toBe(20)
    db.close()
  })
})

describe('importing over a scanned library', () => {
  const albums = (db: ReturnType<typeof freshDb>) =>
    db.prepare('SELECT a.name, a.match_key, a.mb_release_id FROM tracks t JOIN albums a ON a.id = t.album_id').all()

  it('adds nothing when the gmbrc names the files the scan found', () => {
    const db = freshDb()
    const scan = createUpserter(db)
    for (const id of [1, 2]) {
      scan({ title: `Track ${id}`, album: 'Kind of Blue', artist: 'Miles Davis', year: 1959, trackNumber: id,
             sets: { artist: ['Miles Davis'] } }, { uri: `/music/miles/track${id}.flac` }, { metadata: true })
    }
    const before = { ...counts(db), albums: (db.prepare('SELECT COUNT(*) AS n FROM albums').get() as { n: number }).n }

    importGmbrc(db, parseGmbrc(gmbrc([row(1), row(2)])))

    expect({ ...counts(db), albums: (db.prepare('SELECT COUNT(*) AS n FROM albums').get() as { n: number }).n })
      .toEqual({ ...before, history: 4, values: before.values + 4 })
    db.close()
  })

  it('keeps a scanned track on its MusicBrainz album, which the gmbrc cannot name', () => {
    const db = freshDb()
    createUpserter(db)({ title: 'Track 1', album: 'Kind of Blue', artist: 'Miles Davis', year: 1959, mbReleaseId: 'release-1' },
                       { uri: '/music/miles/track1.flac' }, { metadata: true })

    importGmbrc(db, parseGmbrc(gmbrc([row(1)])))

    expect(albums(db)).toEqual([{ name: 'Kind of Blue', match_key: 'mb\x1frelease-1', mb_release_id: 'release-1' }])
    expect((db.prepare('SELECT COUNT(*) AS n FROM albums').get() as { n: number }).n).toBe(1)
    db.close()
  })
})

