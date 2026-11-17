// Resolving what a file is, and which track it belongs to.
//
// Both the gmbrc importer and the filesystem scanner funnel through here, so that running either
// one twice is idempotent and running both does not produce two tracks for one song. The rule is
// deliberately narrow: a file is matched to an existing track only when we can prove it is the same
// file (same path, or same audio content). Guessing that two *different* files are the same
// recording is a separate, reviewable operation — see DESIGN-SPEC §9.2.

import { and, eq, isNotNull } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { field } from '../fields.ts'
import { albumKeyName, albumMatchKey, compilationKey } from './albums.ts'
import { drizzle_of, new_id } from './database.ts'
import { albums, media, tracks } from './schema.ts'
import { intern_value, set_extra, write_set } from './values.ts'

export interface MediaCandidate {
  uri: string
  subtrackIndex?: number
  audioHash?: Uint8Array | null
  audioHashAlgo?: string | null
  codec?: string | null
  bitrate?: number | null
  samplerate?: number | null
  channels?: number | null
  bitsPerSample?: number | null
  filesize?: number | null
  mtime?: number | null
  present?: boolean
}

export interface TrackCandidate {
  title?: string | null
  album?: string | null
  artist?: string | null
  albumArtist?: string | null
  year?: number | null
  trackNumber?: number | null
  discNumber?: number | null
  lengthMs?: number | null
  compilation?: boolean
  bpm?: number | null
  mbRecordingId?: string | null
  mbReleaseId?: string | null
  acoustid?: string | null

  rating?: number | null
  playCount?: number | null
  skipCount?: number | null
  lastPlayed?: number | null
  lastSkipped?: number | null
  rgTrackGain?: number | null
  rgAlbumGain?: number | null
  added?: number | null

  /** Multi-value fields, keyed by field id. Replaces what is stored, rather than appending. */
  sets?: Record<string, readonly string[]>
  comment?: string | null
}

export interface UpsertOptions {
  /**
   * Whether the source is authoritative for ratings, play counts and history. True for the
   * gmusicbrowser import; false for a filesystem scan, which must never clobber X-Music's own
   * statistics with whatever happens to be in a tag.
   */
  statistics?: boolean
  /** Whether to replace multi-value fields and the comment. */
  metadata?: boolean
}

export type MatchSource = 'uri' | 'audio_hash' | 'mbid' | 'new'

export interface UpsertResult {
  trackId: string
  mediaId: string
  matchedBy: MatchSource
  created: boolean
  moved: boolean
}

const KEY_SEP = ''

const norm = (s: string | null | undefined): string =>
  (s ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')

/**
 * A stable descriptor of what this track *is*, stored for a later deduplication pass. It is not
 * used to merge automatically — two files that agree on artist, title and album are usually the
 * same recording, but "usually" is not good enough to silently collapse someone's library.
 */
export function identityKey(t: TrackCandidate): string {
  if (t.mbRecordingId) return `mbid${KEY_SEP}${t.mbRecordingId}`

  const artist = norm(t.albumArtist ?? t.artist)
  const title = norm(t.title)
  if (title === '') return ''

  return ['t', artist, title, norm(t.album)].join(KEY_SEP)
}

/** Higher is preferred when several sources back one track. */
export function qualityRank(m: MediaCandidate): number {
  const lossless = new Set(['flac', 'alac', 'wav', 'aiff', 'wavpack', 'ape'])
  const codec = (m.codec ?? '').toLocaleLowerCase()
  const base = lossless.has(codec) ? 10_000 : 0
  return base + Math.min(m.bitrate ?? 0, 9_999)
}

// Matches each file to its track and writes both; one per import or scan, so set values are looked up once.
class Upserter {
  private readonly database: SqlDatabase
  private readonly valueCache = new Map<string, string>()

  constructor(database: SqlDatabase) {
    this.database = database
  }

  private intern = (database: SqlDatabase, fieldId: number, value: string): string => {
    const key = `${fieldId}${KEY_SEP}${value}`
    let id = this.valueCache.get(key)
    if (id === undefined) this.valueCache.set(key, (id = intern_value(database, fieldId, value)))
    return id
  }

  private albumByKey(key: string): string | undefined {
    return drizzle_of(this.database).select({ id: albums.id }).from(albums).where(eq(albums.match_key, key)).get()?.id
  }

  private albumId(t: TrackCandidate, uri: string, trackId: string | null, now: number): string | null {
    const db = drizzle_of(this.database)

    // An album arranged by hand keeps its tracks whatever their tags now say.
    if (trackId !== null) {
      const current = db
        .select({ id: albums.id })
        .from(tracks)
        .innerJoin(albums, eq(albums.id, tracks.album_id))
        .where(and(eq(tracks.id, trackId), eq(albums.pinned, 1)))
        .get()
      if (current) return current.id

      // A source without MusicBrainz ids, such as a gmbrc, keeps a track on the MusicBrainz album of the same name.
      if (!t.mbReleaseId && t.album) {
        const released = db
          .select({ id: albums.id, name: albums.name })
          .from(tracks)
          .innerJoin(albums, eq(albums.id, tracks.album_id))
          .where(and(eq(tracks.id, trackId), isNotNull(albums.mb_release_id)))
          .get()
        if (released && albumKeyName(released.name ?? '') === albumKeyName(t.album)) return released.id
      }
    }

    const key = albumMatchKey(t, uri)
    if (key === null) return null

    // Once a regroup has filed this album as a compilation, later tracks without an album artist join it.
    if (!t.albumArtist && !t.mbReleaseId) {
      const compilation = this.albumByKey(compilationKey(t, uri)!)
      if (compilation) return compilation
    }

    db.insert(albums)
      .values({ id: new_id(), match_key: key, name: t.album ?? null, year: t.year ?? null, mb_release_id: t.mbReleaseId ?? null, is_compilation: key.startsWith('c') ? 1 : 0, added: now })
      .onConflictDoNothing()
      .run()
    return this.albumByKey(key)!
  }

  upsert(track: TrackCandidate, candidate: MediaCandidate, opts: UpsertOptions): UpsertResult {
    const db = drizzle_of(this.database)
    const now = Date.now()
    const subtrack = candidate.subtrackIndex ?? 0
    const hash = candidate.audioHash ?? null

    let trackId: string | null = null
    let mediaId: string | null = null
    let matchedBy: MatchSource = 'new'
    let moved = false

    // 1. The same path is the same media, full stop.
    const byUri = db
      .select({ id: media.id, track_id: media.track_id })
      .from(media)
      .where(and(eq(media.uri, candidate.uri), eq(media.subtrack_index, subtrack)))
      .get()
    if (byUri) {
      mediaId = byUri.id
      trackId = byUri.track_id
      matchedBy = 'uri'
    }

    // 2. Same audio content at a different path means the file moved or was renamed.
    if (trackId === null && hash) {
      const byHash = db.select({ id: media.id, track_id: media.track_id, uri: media.uri }).from(media).where(eq(media.audio_hash, hash)).limit(1).get()
      if (byHash) {
        mediaId = byHash.id
        trackId = byHash.track_id
        matchedBy = 'audio_hash'
        moved = byHash.uri !== candidate.uri
      }
    }

    // 3. A MusicBrainz recording id is an explicit statement of identity.
    if (trackId === null && track.mbRecordingId) {
      const byMbid = db.select({ id: tracks.id }).from(tracks).where(eq(tracks.mb_recording_id, track.mbRecordingId)).limit(1).get()
      if (byMbid) {
        trackId = byMbid.id
        matchedBy = 'mbid'
      }
    }

    const key = identityKey(track)
    const album = this.albumId(track, candidate.uri, trackId, now)
    const created = trackId === null
    const metadata = {
      title: track.title ?? null,
      album_id: album,
      year: track.year ?? null,
      track_number: track.trackNumber ?? null,
      disc_number: track.discNumber ?? null,
      length_ms: track.lengthMs ?? null,
      compilation: track.compilation ? 1 : 0,
      bpm: track.bpm ?? null,
      identity_key: key || null
    }

    if (trackId === null) {
      trackId = new_id()
      db.insert(tracks)
        .values({
          id: trackId,
          ...metadata,
          mb_recording_id: track.mbRecordingId ?? null,
          acoustid: track.acoustid ?? null,
          identity_source: track.mbRecordingId ? 'mbid' : 'heuristic',
          rating: opts.statistics ? (track.rating ?? null) : null,
          play_count: opts.statistics ? (track.playCount ?? 0) : 0,
          skip_count: opts.statistics ? (track.skipCount ?? 0) : 0,
          last_played: opts.statistics ? (track.lastPlayed ?? null) : null,
          last_skipped: opts.statistics ? (track.lastSkipped ?? null) : null,
          rg_track_gain: track.rgTrackGain ?? null,
          rg_album_gain: track.rgAlbumGain ?? null,
          added: track.added ?? now,
          modified: now
        })
        .run()
    } else {
      // A pinned track was arranged by hand, so its tags no longer move it.
      if (opts.metadata !== false) {
        db.update(tracks)
          .set({ ...metadata, modified: now })
          .where(and(eq(tracks.id, trackId), eq(tracks.pinned, 0)))
          .run()
      }
      if (opts.statistics) {
        db.update(tracks)
          .set({
            rating: track.rating ?? null,
            play_count: track.playCount ?? 0,
            skip_count: track.skipCount ?? 0,
            last_played: track.lastPlayed ?? null,
            last_skipped: track.lastSkipped ?? null,
            rg_track_gain: track.rgTrackGain ?? null,
            rg_album_gain: track.rgAlbumGain ?? null,
            modified: now
          })
          .where(eq(tracks.id, trackId))
          .run()
      }
    }

    const file = {
      uri: candidate.uri,
      audio_hash: hash,
      audio_hash_algo: candidate.audioHashAlgo ?? null,
      codec: candidate.codec ?? null,
      bitrate: candidate.bitrate ?? null,
      samplerate: candidate.samplerate ?? null,
      channels: candidate.channels ?? null,
      bits_per_sample: candidate.bitsPerSample ?? null,
      filesize: candidate.filesize ?? null,
      mtime: candidate.mtime ?? null,
      present: (candidate.present ?? true) ? 1 : 0,
      quality_rank: qualityRank(candidate),
      last_seen: now
    }

    if (mediaId === null) {
      mediaId = new_id()
      db.insert(media).values({ id: mediaId, track_id: trackId, kind: 'file', subtrack_index: subtrack, added: now, ...file }).run()
    } else {
      db.update(media).set(file).where(eq(media.id, mediaId)).run()
    }

    if (opts.metadata !== false) {
      if (track.sets) {
        for (const [fieldName, values] of Object.entries(track.sets)) {
          const fieldId = field(fieldName).fieldId
          if (fieldId !== undefined) write_set(this.database, trackId, fieldId, values, this.intern)
        }
      }
      if (track.comment) set_extra(this.database, trackId, field('comment').fieldId!, track.comment)
    }

    return { trackId, mediaId, matchedBy, created, moved }
  }
}

export function createUpserter(database: SqlDatabase): (t: TrackCandidate, m: MediaCandidate, o: UpsertOptions) => UpsertResult {
  const upserter = new Upserter(database)
  return (t, m, o) => upserter.upsert(t, m, o)
}
