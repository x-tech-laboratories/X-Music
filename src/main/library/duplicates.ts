// Finding tracks that are probably the same recording.
//
// This proposes; merge.ts disposes. Nothing here changes the library — the whole point of keeping
// §3.5.0's identity rule narrow is that guessing happens in a reviewable place, with the evidence
// shown, rather than silently at import time.

import type { Db } from './identity'

export type DuplicateReason = 'audio_hash' | 'mb_recording_id' | 'tags' | 'fuzzy'

export interface DuplicateMember {
  trackId: number
  title: string | null
  artist: string | null
  album: string | null
  year: number | null
  lengthMs: number | null
  rating: number | null
  playCount: number
  mediaCount: number
  codecs: string
}

export interface DuplicateGroup {
  key: string
  reason: DuplicateReason
  /** How much to trust the grouping: 'certain' needs no thought, 'likely' wants a glance. */
  confidence: 'certain' | 'likely' | 'possible'
  explanation: string
  members: DuplicateMember[]
}

export interface FindOptions {
  reasons?: readonly DuplicateReason[]
  /** How far two durations may differ and still be called the same recording. */
  lengthToleranceMs?: number
  limit?: number
}

const MEMBER_SELECT = `
  t.id AS trackId, t.title, t.year, t.length_ms AS lengthMs, t.rating, t.play_count AS playCount,
  (SELECT a.name FROM albums a WHERE a.id = t.album_id) AS album,
  (SELECT vv.value FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
    WHERE tv.track_id = t.id AND tv.field_id = 1 ORDER BY tv.ordinal LIMIT 1) AS artist,
  (SELECT COUNT(*) FROM media m WHERE m.track_id = t.id) AS mediaCount,
  (SELECT GROUP_CONCAT(DISTINCT m.codec) FROM media m WHERE m.track_id = t.id) AS codecs`

function members(db: Db, ids: readonly number[]): DuplicateMember[] {
  const ph = ids.map(() => '?').join(',')
  return db.prepare(`SELECT ${MEMBER_SELECT} FROM tracks t WHERE t.id IN (${ph})`)
    .all(...(ids as never[])) as DuplicateMember[]
}

/** Groups of track ids sharing a key, only where the group has more than one member. */
function groupsByKey(db: Db, sql: string): { key: string; ids: number[] }[] {
  const rows = db.prepare(sql).all() as { key: string; ids: string }[]
  return rows
    .map((r) => ({ key: r.key, ids: r.ids.split(',').map(Number) }))
    .filter((g) => g.ids.length > 1)
}

/**
 * Bracketed noise worth ignoring when comparing titles. Deliberately a fixed list rather than
 * "strip anything in brackets": that broader rule collapses "[Act 1]" and "[Act 2]" into the same
 * title, which is a wrong merge rather than a missed one.
 */
const NOISE = new RegExp(
  '[\\(\\[]\\s*(?:' + [
    'official\\s+(?:music\\s+)?video', 'official\\s+audio', 'official\\s+lyric[s]?\\s+video',
    'lyric[s]?\\s+video', 'lyrics', 'audio', 'video', 'visualizer',
    'hd', 'hq', '4k', '1080p', '720p',
    'no\\s+copyright\\s+music', 'copyright\\s+free', 'free\\s+download', 'free\\s+to\\s+use',
    'explicit', 'clean', 'remaster(?:ed)?', 'deluxe', 'bonus\\s+track'
  ].join('|') + ')\\s*[\\)\\]]',
  'gi'
)

const FEATURED = /[([]\s*(?:feat|ft|featuring|with)\.?\s[^)\]]*[)\]]/gi

const norm = (s: string | null): string =>
  (s ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(FEATURED, ' ')
    .replace(NOISE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function findDuplicates(db: Db, opts: FindOptions = {}): DuplicateGroup[] {
  // Fuzzy matching is left out by default: on a real library it proposes far more than a person
  // can review, and most of it needs judgement. It is a deliberate deeper sweep, not a baseline.
  const reasons = new Set<DuplicateReason>(
    opts.reasons ?? ['audio_hash', 'mb_recording_id', 'tags'])
  const tolerance = opts.lengthToleranceMs ?? 3000
  const out: DuplicateGroup[] = []
  const claimed = new Set<number>()

  const take = (g: DuplicateGroup): void => {
    // A track belongs to one proposal at a time, strongest evidence first.
    const fresh = g.members.filter((m) => !claimed.has(m.trackId))
    if (fresh.length < 2) return
    fresh.forEach((m) => claimed.add(m.trackId))
    out.push({ ...g, members: fresh })
  }

  // ── identical audio, in different track records ──────────────────────────
  if (reasons.has('audio_hash')) {
    for (const g of groupsByKey(db, `
      SELECT hex(m.audio_hash) AS key, GROUP_CONCAT(DISTINCT m.track_id) AS ids
      FROM media m WHERE m.audio_hash IS NOT NULL
      GROUP BY m.audio_hash HAVING COUNT(DISTINCT m.track_id) > 1`)) {
      take({
        key: `hash:${g.key}`, reason: 'audio_hash', confidence: 'certain',
        explanation: 'Byte-identical audio content, so these are the same recording.',
        members: members(db, g.ids)
      })
    }
  }

  // ── the same MusicBrainz recording ───────────────────────────────────────
  if (reasons.has('mb_recording_id')) {
    for (const g of groupsByKey(db, `
      SELECT mb_recording_id AS key, GROUP_CONCAT(id) AS ids FROM tracks
      WHERE mb_recording_id IS NOT NULL AND mb_recording_id != ''
      GROUP BY mb_recording_id HAVING COUNT(*) > 1`)) {
      take({
        key: `mbid:${g.key}`, reason: 'mb_recording_id', confidence: 'certain',
        explanation: 'Tagged with the same MusicBrainz recording id.',
        members: members(db, g.ids)
      })
    }
  }

  // ── same artist, title and album by tag ──────────────────────────────────
  if (reasons.has('tags')) {
    for (const g of groupsByKey(db, `
      SELECT identity_key AS key, GROUP_CONCAT(id) AS ids FROM tracks
      WHERE identity_key IS NOT NULL AND identity_key != ''
      GROUP BY identity_key HAVING COUNT(*) > 1`)) {
      take({
        key: `tags:${g.key}`, reason: 'tags', confidence: 'likely',
        explanation: 'Same artist, title and album after normalising the tags.',
        members: members(db, g.ids)
      })
    }
  }

  // ── same artist and title, ignoring album, with similar duration ─────────
  if (reasons.has('fuzzy')) {
    const rows = db.prepare(`SELECT ${MEMBER_SELECT} FROM tracks t WHERE t.title IS NOT NULL`)
      .all() as DuplicateMember[]

    const buckets = new Map<string, DuplicateMember[]>()
    for (const r of rows) {
      if (claimed.has(r.trackId)) continue
      const key = `${norm(r.artist)}|${norm(r.title)}`
      if (key === '|') continue
      buckets.set(key, [...(buckets.get(key) ?? []), r])
    }

    for (const [key, group] of buckets) {
      if (group.length < 2) continue

      // Split a bucket by duration, so a cover and the original do not merge on title alone.
      const byLength: DuplicateMember[][] = []
      for (const m of group.sort((a, b) => (a.lengthMs ?? 0) - (b.lengthMs ?? 0))) {
        const bucket = byLength.find((b) => {
          const ref = b[0]!.lengthMs
          if (ref === null || m.lengthMs === null) return false
          return Math.abs(ref - m.lengthMs) <= tolerance
        })
        if (bucket) bucket.push(m)
        else byLength.push([m])
      }

      for (const bucket of byLength) {
        if (bucket.length < 2) continue
        const albums = new Set(bucket.map((m) => norm(m.album)))
        take({
          key: `fuzzy:${key}:${bucket[0]!.lengthMs ?? 0}`,
          reason: 'fuzzy',
          confidence: 'possible',
          explanation: albums.size > 1
            ? 'Same artist and title with a similar duration, but on different albums — check before merging.'
            : 'Same artist and title with a similar duration.',
          members: bucket
        })
      }
    }
  }

  const ordered = out.sort((a, b) => {
    const rank = { certain: 0, likely: 1, possible: 2 }
    return rank[a.confidence] - rank[b.confidence] || b.members.length - a.members.length
  })

  return opts.limit ? ordered.slice(0, opts.limit) : ordered
}
