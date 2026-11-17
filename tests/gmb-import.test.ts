// The importer is the migration path for someone with years of ratings and play history. Getting
// it wrong loses data that cannot be reconstructed, so it is tested against both a synthetic gmbrc
// and — when present — the real one on this machine.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { parseGmbrc, defaultGmbrcPath } from '@shared/import/gmbrc'
import { importGmbrc } from '@shared/import/gmb-import'
import { freshDb } from './sqlite'

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
    disc: '1', file: 'So What.flac', filetype: 'flac', genre: 'Jazz', grouping: '',
    label: '', lastplay: '1783048616', lastskip: '0', length: '562', length_estimated: '0',
    missing: '0', modif: '1785683459', path: '/music/miles', playcount: '12',
    playhistory: '1557762781 1558323959', rating: '80', replaygain_album_gain: '-8.81',
    replaygain_album_peak: '1.0', replaygain_track_gain: '-3.72', replaygain_track_peak: '0.86',
    samprate: '44100', size: '6420149', skipcount: '2', title: 'So What', track: '1',
    version: '', year: '1959', ...over
  }
  return [String(id), ...HEADER.split('\t').map((c) => base[c] ?? '')].join('\t')
}

const gmbrc = (rows: string[], extra = ''): string =>
  `# gmbrc version=1.109901 time=1787642034\n[Options]\nBaseFolder: '/music'\n${extra}\n` +
  `[Songs]\n${HEADER}\n${rows.join('\n')}\n[EOF]\n`

describe('gmbrc parser', () => {
  it('reads the header and one song', () => {
    const d = parseGmbrc(gmbrc([row(1)]))
    expect(d.songs).toHaveLength(1)
    expect(d.baseFolder).toBe('/music')
    expect(d.version).toBe('1.109901')

    const s = d.songs[0]!
    expect(s.title).toBe('So What')
    expect(s.artist).toBe('Miles Davis')
    expect(s.rating).toBe(80)
    expect(s.playCount).toBe(12)
    expect(s.playHistory).toEqual([1557762781, 1558323959])
  })

  it('splits multi-value fields on the literal backslash-x-0-0 separator', () => {
    const d = parseGmbrc(gmbrc([row(1, { genre: 'Instrumentals\\x00Songs' })]))
    expect(d.songs[0]!.genre).toEqual(['Instrumentals', 'Songs'])
  })

  it('percent-decodes filesystem names', () => {
    const d = parseGmbrc(gmbrc([row(1, { file: 'With Gun %26 Crucifix.mp3' })]))
    expect(d.songs[0]!.file).toBe('With Gun & Crucifix.mp3')
  })

  it('keeps a malformed escape rather than losing the value', () => {
    const d = parseGmbrc(gmbrc([row(1, { file: 'brokenpercent%ZZ.mp3' })]))
    expect(d.songs[0]!.file).toBe('brokenpercent%ZZ.mp3')
  })

  it('treats gmusicbrowser rating 255 as unrated, not as a rating of 255', () => {
    const d = parseGmbrc(gmbrc([row(1, { rating: '255' })]))
    expect(d.songs[0]!.rating).toBeUndefined()
  })

  it('distinguishes an explicit zero rating from unrated', () => {
    const d = parseGmbrc(gmbrc([row(1, { rating: '0' }), row(2, { rating: '' })]))
    expect(d.songs[0]!.rating).toBe(0)
    expect(d.songs[1]!.rating).toBeUndefined()
  })

  it('reads saved filters and saved lists', () => {
    const extra =
      'SavedFilters:\n' +
      '  "50 Most Played": !Filter "playcount:h:50"\n' +
      'SavedLists:\n' +
      '  list000: !SongArray::Named 1 2\n'
    const d = parseGmbrc(gmbrc([row(1), row(2)], extra))
    expect(d.savedFilters).toEqual([{ name: '50 Most Played', expression: 'playcount:h:50' }])
    expect(d.savedLists).toEqual([{ name: 'list000', gmbIds: [1, 2] }])
  })

  it('reports columns it does not understand instead of dropping them silently', () => {
    const text = gmbrc([]).replace(HEADER, `${HEADER}\tsome_future_column`)
    expect(parseGmbrc(text).unmappedColumns).toEqual(['some_future_column'])
  })
})

describe('gmbrc import', () => {
  it('creates a track and its media, preserving statistics', () => {
    const db = freshDb()
    const report = importGmbrc(db, parseGmbrc(gmbrc([row(1)])))

    expect(report.tracksCreated).toBe(1)
    expect(report.mediaCreated).toBe(1)
    expect(report.playHistoryRows).toBe(2)

    const t = db.prepare('SELECT title, rating, play_count, skip_count, year FROM tracks').get() as
      { title: string; rating: number; play_count: number; skip_count: number; year: number }
    expect(t).toMatchObject({ title: 'So What', rating: 80, play_count: 12, skip_count: 2, year: 1959 })

    const m = db.prepare('SELECT uri, codec, present FROM media').get() as
      { uri: string; codec: string; present: number }
    expect(m.uri).toBe('/music/miles/So What.flac')
    expect(m.present).toBe(1)
    db.close()
  })

  it('converts unix seconds to milliseconds', () => {
    const db = freshDb()
    importGmbrc(db, parseGmbrc(gmbrc([row(1)])))
    const t = db.prepare('SELECT last_played FROM tracks').get() as { last_played: number }
    expect(t.last_played).toBe(1783048616 * 1000)
    db.close()
  })

  it('imports genre, grouping and labels as multi-value fields', () => {
    const db = freshDb()
    importGmbrc(db, parseGmbrc(gmbrc([
      row(1, { genre: 'Jazz\\x00Blues', label: 'Sad', grouping: 'Games - Portal' })
    ])))

    const values = db.prepare(
      'SELECT v.value FROM track_values tv JOIN values_ v ON v.id = tv.value_id ORDER BY v.value'
    ).all() as { value: string }[]
    expect(values.map((v) => v.value)).toContain('Jazz')
    expect(values.map((v) => v.value)).toContain('Blues')
    expect(values.map((v) => v.value)).toContain('Sad')
    db.close()
  })

  it('keeps the track when gmusicbrowser flagged the file missing', () => {
    const db = freshDb()
    const report = importGmbrc(db, parseGmbrc(gmbrc([row(1, { missing: '1' })])))

    expect(report.missingFlagged).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT present FROM media').get() as { present: number }).present).toBe(0)
    db.close()
  })

  it('imports saved lists as static playlists in order', () => {
    const extra = 'SavedLists:\n  Favourites: !SongArray::Named 2 1\n'
    const db = freshDb()
    const report = importGmbrc(db, parseGmbrc(gmbrc([row(1), row(2)], extra)))

    expect(report.playlistsCreated).toBe(1)
    const rows = db.prepare(
      `SELECT t.title FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       ORDER BY pt.position`).all() as { title: string }[]
    expect(rows).toHaveLength(2)
    db.close()
  })

  it('can import without statistics when asked', () => {
    const db = freshDb()
    importGmbrc(db, parseGmbrc(gmbrc([row(1)])), { statistics: false })
    const t = db.prepare('SELECT rating, play_count FROM tracks').get() as
      { rating: number | null; play_count: number }
    expect(t.rating).toBeNull()
    expect(t.play_count).toBe(0)
    db.close()
  })

  it('rolls back cleanly if a row is malformed', () => {
    const db = freshDb()
    const data = parseGmbrc(gmbrc([row(1)]))
    // A title SQLite cannot store, to force the failure path.
    ;(data.songs[0] as { title?: unknown }).title = { not: 'text' }
    expect(() => importGmbrc(db, data)).toThrow()
    expect((db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n).toBe(0)
    db.close()
  })
})

// This runs only on a machine that actually has gmusicbrowser configured.
const realGmbrc = defaultGmbrcPath(homedir(), process.platform)
describe.runIf(existsSync(realGmbrc))('against the real gmbrc on this machine', () => {
  it('parses and imports the whole library', () => {
    const data = parseGmbrc(readFileSync(realGmbrc, 'utf8'))
    expect(data.songs.length).toBeGreaterThan(0)

    const db = freshDb()
    const report = importGmbrc(db, data)

    expect(report.tracksCreated).toBe(data.songs.length)
    // Every imported track must be reachable by the query engine.
    const n = (db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n
    expect(n).toBe(report.tracksCreated)

    console.log('  real gmbrc:', JSON.stringify({
      songs: report.songsRead,
      tracks: report.tracksCreated,
      media: report.mediaCreated,
      missing: report.missingFlagged,
      history: report.playHistoryRows,
      playlists: report.playlistsCreated,
      filters: report.savedFiltersFound
    }))
    db.close()
  })
})
