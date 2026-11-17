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
import { album_key_name, album_match_key, compilation_key } from './albums.ts'
import { drizzle_of, new_id } from './database.ts'
import { albums, media, tracks } from './schema.ts'
import { intern_value, set_extra, write_set } from './values.ts'

export interface MediaCandidate {
  uri: string
  subtrack_index?: number
  audio_hash?: Uint8Array | null
  audio_hash_algo?: string | null
  codec?: string | null
  bitrate?: number | null
  samplerate?: number | null
  channels?: number | null
  bits_per_sample?: number | null
  filesize?: number | null
  mtime?: number | null
  present?: boolean
}

export interface TrackCandidate {
  title?: string | null
  album?: string | null
  artist?: string | null
  album_artist?: string | null
  year?: number | null
  track_number?: number | null
  disc_number?: number | null
  length_ms?: number | null
  compilation?: boolean
  bpm?: number | null
  mb_recording_id?: string | null
  mb_release_id?: string | null
  acoustid?: string | null

  rating?: number | null
  play_count?: number | null
  skip_count?: number | null
  last_played?: number | null
  last_skipped?: number | null
  rg_track_gain?: number | null
  rg_album_gain?: number | null
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
  track_id: string
  media_id: string
  matched_by: MatchSource
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
export function identity_key(t: TrackCandidate): string {
  if (t.mb_recording_id) return `mbid${KEY_SEP}${t.mb_recording_id}`

  const artist = norm(t.album_artist ?? t.artist)
  const title = norm(t.title)
  if (title === '') return ''

  return ['t', artist, title, norm(t.album)].join(KEY_SEP)
}

/** Higher is preferred when several sources back one track. */
export function quality_rank(m: MediaCandidate): number {
  const lossless = new Set(['flac', 'alac', 'wav', 'aiff', 'wavpack', 'ape'])
  const codec = (m.codec ?? '').toLocaleLowerCase()
  const base = lossless.has(codec) ? 10_000 : 0
  return base + Math.min(m.bitrate ?? 0, 9_999)
}

// Matches each file to its track and writes both; one per import or scan, so set values are looked up once.
class Upserter {
  private readonly database: SqlDatabase
  private readonly value_cache = new Map<string, string>()

  constructor(database: SqlDatabase) {
    this.database = database
  }

  private intern = (database: SqlDatabase, field_id: number, value: string): string => {
    const key = `${field_id}${KEY_SEP}${value}`
    let id = this.value_cache.get(key)
    if (id === undefined) this.value_cache.set(key, (id = intern_value(database, field_id, value)))
    return id
  }

  private album_by_key(key: string): string | undefined {
    return drizzle_of(this.database).select({ id: albums.id }).from(albums).where(eq(albums.match_key, key)).get()?.id
  }

  private album_id(t: TrackCandidate, uri: string, track_id: string | null, now: number): string | null {
    const db = drizzle_of(this.database)

    // An album arranged by hand keeps its tracks whatever their tags now say.
    if (track_id !== null) {
      const current = db
        .select({ id: albums.id })
        .from(tracks)
        .innerJoin(albums, eq(albums.id, tracks.album_id))
        .where(and(eq(tracks.id, track_id), eq(albums.pinned, 1)))
        .get()
      if (current) return current.id

      // A source without MusicBrainz ids, such as a gmbrc, keeps a track on the MusicBrainz album of the same name.
      if (!t.mb_release_id && t.album) {
        const released = db
          .select({ id: albums.id, name: albums.name })
          .from(tracks)
          .innerJoin(albums, eq(albums.id, tracks.album_id))
          .where(and(eq(tracks.id, track_id), isNotNull(albums.mb_release_id)))
          .get()
        if (released && album_key_name(released.name ?? '') === album_key_name(t.album)) return released.id
      }
    }

    const key = album_match_key(t, uri)
    if (key === null) return null

    // Once a regroup has filed this album as a compilation, later tracks without an album artist join it.
    if (!t.album_artist && !t.mb_release_id) {
      const compilation = this.album_by_key(compilation_key(t, uri)!)
      if (compilation) return compilation
    }

    db.insert(albums)
      .values({ id: new_id(), match_key: key, name: t.album ?? null, year: t.year ?? null, mb_release_id: t.mb_release_id ?? null, is_compilation: key.startsWith('c') ? 1 : 0, added: now })
      .onConflictDoNothing()
      .run()
    return this.album_by_key(key)!
  }

  upsert(track: TrackCandidate, candidate: MediaCandidate, opts: UpsertOptions): UpsertResult {
    const db = drizzle_of(this.database)
    const now = Date.now()
    const subtrack = candidate.subtrack_index ?? 0
    const hash = candidate.audio_hash ?? null

    let track_id: string | null = null
    let media_id: string | null = null
    let matched_by: MatchSource = 'new'
    let moved = false

    // 1. The same path is the same media, full stop.
    const by_uri = db
      .select({ id: media.id, track_id: media.track_id })
      .from(media)
      .where(and(eq(media.uri, candidate.uri), eq(media.subtrack_index, subtrack)))
      .get()
    if (by_uri) {
      media_id = by_uri.id
      track_id = by_uri.track_id
      matched_by = 'uri'
    }

    // 2. Same audio content at a different path means the file moved or was renamed.
    if (track_id === null && hash) {
      const by_hash = db.select({ id: media.id, track_id: media.track_id, uri: media.uri }).from(media).where(eq(media.audio_hash, hash)).limit(1).get()
      if (by_hash) {
        media_id = by_hash.id
        track_id = by_hash.track_id
        matched_by = 'audio_hash'
        moved = by_hash.uri !== candidate.uri
      }
    }

    // 3. A MusicBrainz recording id is an explicit statement of identity.
    if (track_id === null && track.mb_recording_id) {
      const by_mbid = db.select({ id: tracks.id }).from(tracks).where(eq(tracks.mb_recording_id, track.mb_recording_id)).limit(1).get()
      if (by_mbid) {
        track_id = by_mbid.id
        matched_by = 'mbid'
      }
    }

    const key = identity_key(track)
    const album = this.album_id(track, candidate.uri, track_id, now)
    const created = track_id === null
    const metadata = {
      title: track.title ?? null,
      album_id: album,
      year: track.year ?? null,
      track_number: track.track_number ?? null,
      disc_number: track.disc_number ?? null,
      length_ms: track.length_ms ?? null,
      compilation: track.compilation ? 1 : 0,
      bpm: track.bpm ?? null,
      identity_key: key || null
    }

    if (track_id === null) {
      track_id = new_id()
      db.insert(tracks)
        .values({
          id: track_id,
          ...metadata,
          mb_recording_id: track.mb_recording_id ?? null,
          acoustid: track.acoustid ?? null,
          identity_source: track.mb_recording_id ? 'mbid' : 'heuristic',
          rating: opts.statistics ? (track.rating ?? null) : null,
          play_count: opts.statistics ? (track.play_count ?? 0) : 0,
          skip_count: opts.statistics ? (track.skip_count ?? 0) : 0,
          last_played: opts.statistics ? (track.last_played ?? null) : null,
          last_skipped: opts.statistics ? (track.last_skipped ?? null) : null,
          rg_track_gain: track.rg_track_gain ?? null,
          rg_album_gain: track.rg_album_gain ?? null,
          added: track.added ?? now,
          modified: now
        })
        .run()
    } else {
      // A pinned track was arranged by hand, so its tags no longer move it.
      if (opts.metadata !== false) {
        db.update(tracks)
          .set({ ...metadata, modified: now })
          .where(and(eq(tracks.id, track_id), eq(tracks.pinned, 0)))
          .run()
      }
      if (opts.statistics) {
        db.update(tracks)
          .set({
            rating: track.rating ?? null,
            play_count: track.play_count ?? 0,
            skip_count: track.skip_count ?? 0,
            last_played: track.last_played ?? null,
            last_skipped: track.last_skipped ?? null,
            rg_track_gain: track.rg_track_gain ?? null,
            rg_album_gain: track.rg_album_gain ?? null,
            modified: now
          })
          .where(eq(tracks.id, track_id))
          .run()
      }
    }

    const file = {
      uri: candidate.uri,
      audio_hash: hash,
      audio_hash_algo: candidate.audio_hash_algo ?? null,
      codec: candidate.codec ?? null,
      bitrate: candidate.bitrate ?? null,
      samplerate: candidate.samplerate ?? null,
      channels: candidate.channels ?? null,
      bits_per_sample: candidate.bits_per_sample ?? null,
      filesize: candidate.filesize ?? null,
      mtime: candidate.mtime ?? null,
      present: (candidate.present ?? true) ? 1 : 0,
      quality_rank: quality_rank(candidate),
      last_seen: now
    }

    if (media_id === null) {
      media_id = new_id()
      db.insert(media).values({ id: media_id, track_id, kind: 'file', subtrack_index: subtrack, added: now, ...file }).run()
    } else {
      db.update(media).set(file).where(eq(media.id, media_id)).run()
    }

    if (opts.metadata !== false) {
      if (track.sets) {
        for (const [field_name, values] of Object.entries(track.sets)) {
          const field_id = field(field_name).field_id
          if (field_id !== undefined) write_set(this.database, track_id, field_id, values, this.intern)
        }
      }
      if (track.comment) set_extra(this.database, track_id, field('comment').field_id!, track.comment)
    }

    return { track_id, media_id, matched_by, created, moved }
  }
}

export function create_upserter(database: SqlDatabase): (t: TrackCandidate, m: MediaCandidate, o: UpsertOptions) => UpsertResult {
  const upserter = new Upserter(database)
  return (t, m, o) => upserter.upsert(t, m, o)
}
