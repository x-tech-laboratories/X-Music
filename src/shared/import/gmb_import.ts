// Imports a parsed gmbrc into X-Music's entity model.
// gmusicbrowser has one row per file; X-Music has a track plus its media. The import creates one
// track and one file-media per gmusicbrowser song, which is correct but conservative: it does not
// try to merge two files that are the same recording. Deduplication is a separate, reviewable
// operation, and silently merging someone's library on import would be the wrong default.

import { and, drizzle_of, eq } from '@x-tech-laboratories/x-libs/drizzle'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import type { ImportReport } from '../ipc.ts'
import { regroup_albums } from '../library/albums.ts'
import { new_id } from '../library/database.ts'
import { play_history, playlist_tracks, playlists } from '../library/schema.ts'
import { create_upserter, type TrackCandidate } from '../library/identity.ts'
import type { GmbrcData } from './gmbrc.ts'

export type { ImportReport }

export interface ImportOptions {
  // Import ratings, play counts and history.
  statistics?: boolean
  // Import genre, grouping and label as multi-value fields.
  labels?: boolean
  // Import SavedLists as static playlists.
  playlists?: boolean
}

// gmusicbrowser timestamps are unix seconds; X-Music stores milliseconds.
const to_ms = (secs: number | undefined): number | null =>
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

export function import_gmbrc(database: SqlDatabase, data: GmbrcData, opts: ImportOptions = {}): ImportReport {
  const with_stats = opts.statistics ?? true
  const with_labels = opts.labels ?? true
  const with_playlists = opts.playlists ?? true

  const report: ImportReport = {
    songs_read: data.songs.length,
    tracks_created: 0,
    tracks_updated: 0,
    media_matched: 0,
    media_created: 0,
    missing_flagged: 0,
    play_history_rows: 0,
    playlists_created: 0,
    saved_filters_found: data.saved_filters.length,
    unmapped_columns: data.unmapped_columns,
    notes: []
  }

  const now = Date.now()
  const upsert = create_upserter(database)

  // gmusicbrowser song id to X-Music track id, so SavedLists can be resolved afterwards.
  const track_by_gmb_id = new Map<number, string>()

  in_transaction(database, () => {
    for (const song of data.songs) {
      const candidate: TrackCandidate = {
        title: song.title ?? null,
        album: song.album ?? null,
        artist: song.artist ?? null,
        album_artist: song.album_artist ?? null,
        year: song.year ?? null,
        track_number: song.track ?? null,
        disc_number: song.disc ?? null,
        length_ms: song.length !== undefined ? song.length * 1000 : null,
        compilation: song.compilation ?? false,
        bpm: null,
        rating: with_stats ? song.rating ?? null : null,
        play_count: with_stats ? song.play_count ?? 0 : 0,
        skip_count: with_stats ? song.skip_count ?? 0 : 0,
        last_played: with_stats ? to_ms(song.last_play) : null,
        last_skipped: with_stats ? to_ms(song.last_skip) : null,
        rg_track_gain: song.rg_track_gain ?? null,
        rg_album_gain: song.rg_album_gain ?? null,
        added: to_ms(song.added) ?? now,
        comment: song.comment ?? null,
        sets: {
          artist: song.artist ? [song.artist] : [],
          album_artist: song.album_artist ? [song.album_artist] : [],
          ...(with_labels
            ? { genre: song.genre, grouping: song.grouping, tags: song.label }
            : {})
        }
      }

      // A gmusicbrowser entry always names a file; without one there is nothing to attach to.
      if (!song.path || !song.file) {
        report.notes.push(`Skipped song ${song.gmb_id}: no file path recorded.`)
        continue
      }

      const result = upsert(candidate, {
        uri: join_path(song.path, song.file),
        codec: song.filetype?.split(/\s+/)[0] ?? null,
        bitrate: song.bitrate ?? null,
        samplerate: song.sample_rate ?? null,
        channels: song.channels ?? null,
        filesize: song.size ?? null,
        mtime: to_ms(song.modif),
        present: !song.missing
      }, { statistics: with_stats, metadata: true })

      if (result.created) report.tracks_created++
      else report.tracks_updated++
      if (result.matched_by === 'uri' || result.matched_by === 'audio_hash') report.media_matched++
      else report.media_created++
      if (song.missing) report.missing_flagged++

      track_by_gmb_id.set(song.gmb_id, result.track_id)

      if (with_stats) {
        for (const at of song.play_history) {
          drizzle_of(database).insert(play_history).values({ id: new_id(), track_id: result.track_id, at: at * 1000, kind: 0 }).onConflictDoNothing().run()
          report.play_history_rows++
        }
      }
    }

    if (with_playlists) {
      for (const list of data.saved_lists) {
        const existing = drizzle_of(database).select({ id: playlists.id }).from(playlists).where(and(eq(playlists.name, list.name), eq(playlists.kind, 'static'))).get()
        let playlist_id: string
        if (existing) {
          playlist_id = existing.id
          drizzle_of(database).delete(playlist_tracks).where(eq(playlist_tracks.playlist_id, playlist_id)).run()
        } else {
          playlist_id = new_id()
          drizzle_of(database).insert(playlists).values({ id: playlist_id, name: list.name, kind: 'static', created: now, modified: now }).run()
        }
        let position = 0
        for (const gmb_id of list.gmb_ids) {
          const track_id = track_by_gmb_id.get(gmb_id)
          if (track_id !== undefined) {
            drizzle_of(database).insert(playlist_tracks).values({ playlist_id, track_id, position: position++ }).onConflictDoNothing().run()
          }
        }
        report.playlists_created++
      }
    }

    regroup_albums(database)
  })

  if (data.saved_filters.length > 0) {
    report.notes.push(
      `${data.saved_filters.length} saved filters found but not translated. gmusicbrowser filter ` +
      'strings map onto the X-Music filter AST, which is a separate import step (DESIGN-SPEC 9.3).'
    )
  }
  if (report.missing_flagged > 0) {
    report.notes.push(
      `${report.missing_flagged} files were flagged missing by gmusicbrowser. Their tracks were ` +
      'imported with the media marked not present, so ratings and history are preserved.'
    )
  }
  if (data.unmapped_columns.length > 0) {
    report.notes.push(`Unmapped gmbrc columns ignored: ${data.unmapped_columns.join(', ')}`)
  }

  return report
}
