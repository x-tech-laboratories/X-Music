// Imports a parsed gmbrc into X-Music's entity model.
//
// gmusicbrowser has one row per file; X-Music has a track plus its media. The import creates one
// track and one file-media per gmusicbrowser song, which is correct but conservative: it does not
// try to merge two files that are the same recording. Deduplication is a separate, reviewable
// operation, and silently merging someone's library on import would be the wrong default.

import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { ImportReport } from '../ipc.ts'
import { regroupAlbums } from '../library/albums.ts'
import { first_row, new_id, run } from '../library/database.ts'
import { createUpserter, type TrackCandidate } from '../library/identity.ts'
import type { GmbrcData } from './gmbrc.ts'

export type { ImportReport }

export interface ImportOptions {
  /** Import ratings, play counts and history. */
  statistics?: boolean
  /** Import genre, grouping and label as multi-value fields. */
  labels?: boolean
  /** Import SavedLists as static playlists. */
  playlists?: boolean
}

/** gmusicbrowser timestamps are unix seconds; X-Music stores milliseconds. */
const toMs = (secs: number | undefined): number | null =>
  secs === undefined || secs <= 0 ? null : secs * 1000

// A file's path from gmusicbrowser's folder and file name, exactly as Node's POSIX join gives it, so re-imports match.
export function join_path(folder: string, file: string): string {
  const joined = [folder, file].filter((part) => part !== '').join('/')
  if (joined === '') return '.'
  const rooted = joined.startsWith('/')
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length > 0 && parts.at(-1) !== '..') parts.pop()
    else if (!rooted) parts.push('..')
  }
  const trailing = joined.endsWith('/')
  if (parts.length === 0) return rooted ? '/' : trailing ? './' : '.'
  return `${rooted ? '/' : ''}${parts.join('/')}${trailing ? '/' : ''}`
}

export function importGmbrc(database: SqlDatabase, data: GmbrcData, opts: ImportOptions = {}): ImportReport {
  const withStats = opts.statistics ?? true
  const withLabels = opts.labels ?? true
  const withPlaylists = opts.playlists ?? true

  const report: ImportReport = {
    songsRead: data.songs.length,
    tracksCreated: 0,
    tracksUpdated: 0,
    mediaMatched: 0,
    mediaCreated: 0,
    missingFlagged: 0,
    playHistoryRows: 0,
    playlistsCreated: 0,
    savedFiltersFound: data.savedFilters.length,
    unmappedColumns: data.unmappedColumns,
    notes: []
  }

  const now = Date.now()
  const upsert = createUpserter(database)

  /** gmusicbrowser song id to X-Music track id, so SavedLists can be resolved afterwards. */
  const trackByGmbId = new Map<number, string>()

  in_transaction(database, () => {
    for (const song of data.songs) {
      const candidate: TrackCandidate = {
        title: song.title ?? null,
        album: song.album ?? null,
        artist: song.artist ?? null,
        albumArtist: song.albumArtist ?? null,
        year: song.year ?? null,
        trackNumber: song.track ?? null,
        discNumber: song.disc ?? null,
        lengthMs: song.length !== undefined ? song.length * 1000 : null,
        compilation: song.compilation ?? false,
        bpm: null,
        rating: withStats ? song.rating ?? null : null,
        playCount: withStats ? song.playCount ?? 0 : 0,
        skipCount: withStats ? song.skipCount ?? 0 : 0,
        lastPlayed: withStats ? toMs(song.lastPlay) : null,
        lastSkipped: withStats ? toMs(song.lastSkip) : null,
        rgTrackGain: song.rgTrackGain ?? null,
        rgAlbumGain: song.rgAlbumGain ?? null,
        added: toMs(song.added) ?? now,
        comment: song.comment ?? null,
        sets: {
          artist: song.artist ? [song.artist] : [],
          album_artist: song.albumArtist ? [song.albumArtist] : [],
          ...(withLabels
            ? { genre: song.genre, grouping: song.grouping, tags: song.label }
            : {})
        }
      }

      // A gmusicbrowser entry always names a file; without one there is nothing to attach to.
      if (!song.path || !song.file) {
        report.notes.push(`Skipped song ${song.gmbId}: no file path recorded.`)
        continue
      }

      const result = upsert(candidate, {
        uri: join_path(song.path, song.file),
        codec: song.filetype?.split(/\s+/)[0] ?? null,
        bitrate: song.bitrate ?? null,
        samplerate: song.sampleRate ?? null,
        channels: song.channels ?? null,
        filesize: song.size ?? null,
        mtime: toMs(song.modif),
        present: !song.missing
      }, { statistics: withStats, metadata: true })

      if (result.created) report.tracksCreated++
      else report.tracksUpdated++
      if (result.matchedBy === 'uri' || result.matchedBy === 'audio_hash') report.mediaMatched++
      else report.mediaCreated++
      if (song.missing) report.missingFlagged++

      trackByGmbId.set(song.gmbId, result.trackId)

      if (withStats) {
        for (const at of song.playHistory) {
          run(database, 'INSERT OR IGNORE INTO play_history (id, track_id, at, kind) VALUES (?, ?, ?, 0)', new_id(), result.trackId, at * 1000)
          report.playHistoryRows++
        }
      }
    }

    if (withPlaylists) {
      for (const list of data.savedLists) {
        const existing = first_row<{ id: string }>(database, "SELECT id FROM playlists WHERE name = ? AND kind = 'static'", list.name)
        let playlistId: string
        if (existing) {
          playlistId = existing.id
          run(database, 'DELETE FROM playlist_tracks WHERE playlist_id = ?', playlistId)
        } else {
          playlistId = new_id()
          run(database, "INSERT INTO playlists (id, name, kind, created, modified) VALUES (?, ?, 'static', ?, ?)", playlistId, list.name, now, now)
        }
        let position = 0
        for (const gmbId of list.gmbIds) {
          const trackId = trackByGmbId.get(gmbId)
          if (trackId !== undefined) {
            run(database, 'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', playlistId, trackId, position++)
          }
        }
        report.playlistsCreated++
      }
    }

    regroupAlbums(database)
  })

  if (data.savedFilters.length > 0) {
    report.notes.push(
      `${data.savedFilters.length} saved filters found but not translated. gmusicbrowser filter ` +
      'strings map onto the X-Music filter AST, which is a separate import step (DESIGN-SPEC 9.3).'
    )
  }
  if (report.missingFlagged > 0) {
    report.notes.push(
      `${report.missingFlagged} files were flagged missing by gmusicbrowser. Their tracks were ` +
      'imported with the media marked not present, so ratings and history are preserved.'
    )
  }
  if (data.unmappedColumns.length > 0) {
    report.notes.push(`Unmapped gmbrc columns ignored: ${data.unmappedColumns.join(', ')}`)
  }

  return report
}
