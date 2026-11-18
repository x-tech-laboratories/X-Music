// Everything X-Music knows about one track.
// This is where the entity model becomes visible to the user: not just tags, but how many sources
// back the track, where each one is, which will actually play, and how the track came to be
// identified the way it is (DESIGN-SPEC §6.5). Read-only.

import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { BUILTIN_FIELDS } from '../fields.ts'
import { all_rows, first_row, to_hex } from './database.ts'

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
  const t = first_row<Record<string, unknown>>(database, `
    SELECT t.id, t.title, t.album_id, t.year, t.track_number,
           t.disc_number, t.length_ms, t.compilation, t.bpm,
           t.identity_source, t.identity_key, t.pinned,
           t.mb_recording_id, t.acoustid,
           t.rating, t.play_count, t.skip_count,
           t.first_played, t.last_played,
           t.last_skipped, t.added, t.modified, t.bookmark_ms,
           t.rg_track_gain, t.rg_album_gain,
           (SELECT a.name FROM albums a WHERE a.id = t.album_id) AS album
    FROM tracks t WHERE t.id = ?`, track_id)

  if (!t) return null

  const names = field_name_by_id()

  // Multi-value fields, collapsed for display but marked so the UI can say they are sets.
  const set_rows = all_rows<{ field_id: number; value: string }>(database, `
    SELECT tv.field_id, vv.value FROM track_values tv
    JOIN values_ vv ON vv.id = tv.value_id
    WHERE tv.track_id = ? ORDER BY tv.field_id, tv.ordinal`, track_id)

  const sets = new Map<number, string[]>()
  for (const r of set_rows) sets.set(r.field_id, [...(sets.get(r.field_id) ?? []), r.value])

  const extra_rows = all_rows<{ field_id: number; value: string }>(database,
    'SELECT field_id, value FROM track_extras WHERE track_id = ?', track_id)

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
  const media_rows = all_rows<Record<string, unknown>>(database, `
    SELECT id, kind, uri, provider, present, codec, container, bitrate,
           bitrate_mode, samplerate, channels, bits_per_sample,
           filesize, mtime, last_seen, quality_rank,
           audio_hash, audio_hash_algo,
           subtrack_index, start_ms, end_ms
    FROM media WHERE track_id = ?
    ORDER BY present DESC, quality_rank DESC, added, id`, track_id)

  const tag_rows = all_rows<{ media_id: string; field_id: number; value: string | null }>(database, `
    SELECT media_id, field_id, value FROM media_tags
    WHERE media_id IN (SELECT id FROM media WHERE track_id = ?)
    ORDER BY media_id, field_id, ordinal`, track_id)

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
  const history_total = first_row<{ n: number }>(database, 'SELECT COUNT(*) AS n FROM play_history WHERE track_id = ?', track_id)!.n

  const history = all_rows<{ at: number; kind: number }>(database,
    'SELECT at, kind FROM play_history WHERE track_id = ? ORDER BY at DESC LIMIT ?', track_id, HISTORY_LIMIT)
    .map((r) => ({ at: r.at, kind: r.kind === 1 ? 'skip' as const : 'play' as const }))

  const merges = all_rows<{ batch_id: string; at: number; snapshot: string }>(database, `
    SELECT batch_id, at, snapshot FROM merge_journal
    WHERE survivor_id = ? AND undone = 0 ORDER BY at DESC`, track_id)
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
