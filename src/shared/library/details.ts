// Everything X-Music knows about one track.
// This is where the entity model becomes visible to the user: not just tags, but how many sources
// back the track, where each one is, which will actually play, and how the track came to be
// identified the way it is (DESIGN-SPEC §6.5). Read-only.

import { and, asc, count, desc, eq, inArray } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { BUILTIN_FIELDS } from '../fields.ts'
import { album_name, drizzle_of, to_hex } from './database.ts'
import { media as media_table, media_tags, merge_journal, play_history, track_extras, track_values, tracks, values_ } from './schema.ts'

export interface DetailMedia {
  id: string
  kind: string
  uri: string
  provider: string | null
  present: boolean
  preferred: boolean
  codec: string | null
  container: string | null
  bitrate: number | null
  bitrate_mode: string | null
  samplerate: number | null
  channels: number | null
  bits_per_sample: number | null
  filesize: number | null
  mtime: number | null
  last_seen: number | null
  quality_rank: number
  audio_hash_hex: string | null
  audio_hash_algo: string | null
  subtrack_index: number
  start_ms: number | null
  end_ms: number | null
  // Raw tags read from this source, so disagreements between sources stay visible.
  tags: { field: string; value: string }[]
}

export interface DetailField {
  field: string
  name: string
  value: string | null
  multi: boolean
}

export interface HistoryEntry {
  at: number
  kind: 'play' | 'skip'
}

export interface TrackDetails {
  id: string
  title: string | null
  album: string | null
  album_id: string | null

  identity: {
    source: string
    key: string | null
    pinned: boolean
    mb_recording_id: string | null
    acoustid: string | null
  }

  fields: DetailField[]
  media: DetailMedia[]

  statistics: {
    rating: number | null
    play_count: number
    skip_count: number
    first_played: number | null
    last_played: number | null
    last_skipped: number | null
    added: number
    modified: number
    bookmark_ms: number | null
  }

  loudness: {
    rg_track_gain: number | null
    rg_album_gain: number | null
  }

  // Most recent first, capped: the full list can run to hundreds of entries.
  history: HistoryEntry[]
  history_total: number

  // Present when this track absorbed others, so the merge can be found and undone.
  merges: { batch_id: string; at: number; absorbed: number }[]
}

const HISTORY_LIMIT = 200

const field_name_by_id = (): Map<number, { id: string; name: string }> => {
  const map = new Map<number, { id: string; name: string }>()
  for (const d of BUILTIN_FIELDS) {
    if (d.field_id !== undefined) map.set(d.field_id, { id: d.id, name: d.name })
  }
  return map
}

export function track_details(database: SqlDatabase, track_id: string): TrackDetails | null {
  const db = drizzle_of(database)
  const t = db.select({
    id: tracks.id, title: tracks.title, album_id: tracks.album_id, year: tracks.year, track_number: tracks.track_number,
    disc_number: tracks.disc_number, length_ms: tracks.length_ms, compilation: tracks.compilation, bpm: tracks.bpm,
    identity_source: tracks.identity_source, identity_key: tracks.identity_key, pinned: tracks.pinned,
    mb_recording_id: tracks.mb_recording_id, acoustid: tracks.acoustid,
    rating: tracks.rating, play_count: tracks.play_count, skip_count: tracks.skip_count,
    first_played: tracks.first_played, last_played: tracks.last_played,
    last_skipped: tracks.last_skipped, added: tracks.added, modified: tracks.modified, bookmark_ms: tracks.bookmark_ms,
    rg_track_gain: tracks.rg_track_gain, rg_album_gain: tracks.rg_album_gain,
    album: album_name
  }).from(tracks).where(eq(tracks.id, track_id)).get()

  if (!t) return null

  const names = field_name_by_id()

  // Multi-value fields, collapsed for display but marked so the UI can say they are sets.
  const set_rows = db.select({ field_id: track_values.field_id, value: values_.value })
    .from(track_values).innerJoin(values_, eq(values_.id, track_values.value_id))
    .where(eq(track_values.track_id, track_id)).orderBy(asc(track_values.field_id), asc(track_values.ordinal)).all()

  const sets = new Map<number, string[]>()
  for (const r of set_rows) sets.set(r.field_id, [...(sets.get(r.field_id) ?? []), r.value])

  const extra_rows = db.select({ field_id: track_extras.field_id, value: track_extras.value })
    .from(track_extras).where(eq(track_extras.track_id, track_id)).all()

  const fields: DetailField[] = []

  const scalar = (id: string, name: string, value: unknown): void => {
    fields.push({
      field: id, name, multi: false,
      value: value === null || value === undefined || value === '' ? null : String(value)
    })
  }

  scalar('title', 'Title', t.title)
  scalar('album', 'Album', t.album)
  scalar('year', 'Year', t.year)
  scalar('track_number', 'Track', t.track_number)
  scalar('disc_number', 'Disc', t.disc_number)
  scalar('length', 'Length', t.length_ms)
  scalar('bpm', 'BPM', t.bpm)
  scalar('compilation', 'Compilation', t.compilation ? 'Yes' : null)

  for (const [field_id, values] of sets) {
    const meta = names.get(field_id)
    if (!meta) continue
    fields.push({ field: meta.id, name: meta.name, value: values.join(', '), multi: true })
  }

  for (const r of extra_rows) {
    const meta = names.get(r.field_id)
    if (!meta) continue
    fields.push({ field: meta.id, name: meta.name, value: r.value, multi: false })
  }

  // ── sources ──────────────────────────────────────────────────────────────
  const media_rows = db.select({
    id: media_table.id, kind: media_table.kind, uri: media_table.uri, provider: media_table.provider, present: media_table.present, codec: media_table.codec,
    container: media_table.container, bitrate: media_table.bitrate, bitrate_mode: media_table.bitrate_mode, samplerate: media_table.samplerate,
    channels: media_table.channels, bits_per_sample: media_table.bits_per_sample, filesize: media_table.filesize, mtime: media_table.mtime,
    last_seen: media_table.last_seen, quality_rank: media_table.quality_rank, audio_hash: media_table.audio_hash, audio_hash_algo: media_table.audio_hash_algo,
    subtrack_index: media_table.subtrack_index, start_ms: media_table.start_ms, end_ms: media_table.end_ms
  }).from(media_table).where(eq(media_table.track_id, track_id))
    .orderBy(desc(media_table.present), desc(media_table.quality_rank), asc(media_table.added), asc(media_table.id)).all()

  const track_media = db.select({ id: media_table.id }).from(media_table).where(eq(media_table.track_id, track_id))
  const tag_rows = db.select({ media_id: media_tags.media_id, field_id: media_tags.field_id, value: media_tags.value })
    .from(media_tags).where(inArray(media_tags.media_id, track_media))
    .orderBy(asc(media_tags.media_id), asc(media_tags.field_id), asc(media_tags.ordinal)).all()

  const media: DetailMedia[] = media_rows.map((m, index) => {
    const hash = m.audio_hash as Uint8Array | null
    return {
      id: m.id as string,
      kind: m.kind as string,
      uri: m.uri as string,
      provider: (m.provider ?? null) as string | null,
      present: !!m.present,
      // The first row is what the player would choose, by the same ordering it uses.
      preferred: index === 0,
      codec: (m.codec ?? null) as string | null,
      container: (m.container ?? null) as string | null,
      bitrate: (m.bitrate ?? null) as number | null,
      bitrate_mode: (m.bitrate_mode ?? null) as string | null,
      samplerate: (m.samplerate ?? null) as number | null,
      channels: (m.channels ?? null) as number | null,
      bits_per_sample: (m.bits_per_sample ?? null) as number | null,
      filesize: (m.filesize ?? null) as number | null,
      mtime: (m.mtime ?? null) as number | null,
      last_seen: (m.last_seen ?? null) as number | null,
      quality_rank: (m.quality_rank ?? 0) as number,
      audio_hash_hex: hash ? to_hex(hash) : null,
      audio_hash_algo: (m.audio_hash_algo ?? null) as string | null,
      subtrack_index: (m.subtrack_index ?? 0) as number,
      start_ms: (m.start_ms ?? null) as number | null,
      end_ms: (m.end_ms ?? null) as number | null,
      tags: tag_rows
        .filter((r) => r.media_id === m.id && r.value !== null)
        .map((r) => ({ field: names.get(r.field_id)?.name ?? `field ${r.field_id}`, value: r.value! }))
    }
  })

  // ── history ──────────────────────────────────────────────────────────────
  const history_total = db.select({ n: count() }).from(play_history).where(eq(play_history.track_id, track_id)).get()!.n

  const history = db.select({ at: play_history.at, kind: play_history.kind }).from(play_history)
    .where(eq(play_history.track_id, track_id)).orderBy(desc(play_history.at)).limit(HISTORY_LIMIT).all()
    .map((r) => ({ at: r.at, kind: r.kind === 1 ? 'skip' as const : 'play' as const }))

  const merges = db.select({ batch_id: merge_journal.batch_id, at: merge_journal.at, snapshot: merge_journal.snapshot })
    .from(merge_journal).where(and(eq(merge_journal.survivor_id, track_id), eq(merge_journal.undone, 0)))
    .orderBy(desc(merge_journal.at)).all()
    .map((m) => {
      let absorbed = 0
      try {
        absorbed = Math.max(0, (JSON.parse(m.snapshot) as { tracks: unknown[] }).tracks.length - 1)
      } catch {
        absorbed = 0
      }
      return { batch_id: m.batch_id, at: m.at, absorbed }
    })

  return {
    id: t.id as string,
    title: (t.title ?? null) as string | null,
    album: (t.album ?? null) as string | null,
    album_id: (t.album_id ?? null) as string | null,
    identity: {
      source: (t.identity_source ?? 'heuristic') as string,
      key: (t.identity_key ?? null) as string | null,
      pinned: !!t.pinned,
      mb_recording_id: (t.mb_recording_id ?? null) as string | null,
      acoustid: (t.acoustid ?? null) as string | null
    },
    fields,
    media,
    statistics: {
      rating: (t.rating ?? null) as number | null,
      play_count: (t.play_count ?? 0) as number,
      skip_count: (t.skip_count ?? 0) as number,
      first_played: (t.first_played ?? null) as number | null,
      last_played: (t.last_played ?? null) as number | null,
      last_skipped: (t.last_skipped ?? null) as number | null,
      added: (t.added ?? 0) as number,
      modified: (t.modified ?? 0) as number,
      bookmark_ms: (t.bookmark_ms ?? null) as number | null
    },
    loudness: {
      rg_track_gain: (t.rg_track_gain ?? null) as number | null,
      rg_album_gain: (t.rg_album_gain ?? null) as number | null
    },
    history,
    history_total,
    merges
  }
}
