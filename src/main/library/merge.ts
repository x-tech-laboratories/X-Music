// Merging several track records into one.
//
// §3.5.0 deliberately refuses to guess that two different files are the same recording, which
// leaves the user to say so. The model follows Thunderbird CardBook: resolve conflicts per *field*
// rather than picking a winning record, because the right answer is usually spread across sources —
// one file has the better title, another has the year, a third has the genre.
//
// Every merge is journaled in full and can be undone. That is a prerequisite, not a nicety: a merge
// deletes rows holding ratings and play history that cannot be reconstructed from the files.

import { BUILTIN_FIELDS, field, type FieldDescriptor } from '@shared/fields'
import type { Db } from './identity'

export type Resolution =
  | { kind: 'value'; from: number }
  | { kind: 'union' }

export interface MergeRequest {
  ids: readonly number[]
  survivor: number
  /** Field id → how to resolve it. Fields left out take the survivor's value. */
  resolutions?: Record<string, Resolution>
  /** Field id → an explicit value, for a field the user typed rather than chose. */
  overrides?: Record<string, string | number | null>
}

export interface FieldOption {
  from: number
  value: string | number | null | string[]
}

export interface PreviewField {
  field: string
  name: string
  multi: boolean
  conflict: boolean
  /** Present when every source agrees. */
  value?: string | number | null | string[]
  options?: FieldOption[]
  /** For multi-value fields, the union of every source. */
  union?: string[]
}

export interface PreviewMedia {
  id: number
  from: number
  uri: string
  codec: string | null
  bitrate: number | null
  present: boolean
}

export interface MergePreview {
  ids: number[]
  survivor: number
  fields: PreviewField[]
  media: PreviewMedia[]
  statistics: {
    playCount: number
    skipCount: number
    rating: number | null
    firstPlayed: number | null
    lastPlayed: number | null
  }
  /** True when at least one source is pinned; merging overrides a human decision. */
  pinnedSources: number[]
}

export interface MergeResult {
  batchId: string
  survivor: number
  absorbed: number[]
  mediaMoved: number
  historyMoved: number
  playlistEntriesRepointed: number
}

/** Scalar fields offered for resolution, in the order a person reads them. */
const SCALAR_FIELDS = [
  'title', 'album', 'year', 'track_number', 'disc_number', 'length', 'bpm', 'compilation'
] as const

const MULTI_FIELDS = ['artist', 'album_artist', 'genre', 'grouping', 'tags'] as const
const EXTRA_FIELDS = ['comment'] as const

const COLUMN: Record<string, string> = {
  title: 'title', year: 'year', track_number: 'track_number', disc_number: 'disc_number',
  length: 'length_ms', bpm: 'bpm', compilation: 'compilation'
}

interface TrackRow {
  id: number
  title: string | null
  album_id: number | null
  album: string | null
  year: number | null
  track_number: number | null
  disc_number: number | null
  length_ms: number | null
  compilation: number
  bpm: number | null
  rating: number | null
  play_count: number
  skip_count: number
  first_played: number | null
  last_played: number | null
  last_skipped: number | null
  added: number
  pinned: number
  mb_recording_id: string | null
}

const TRACK_SELECT = `
  t.id, t.title, t.album_id, t.year, t.track_number, t.disc_number, t.length_ms, t.compilation,
  t.bpm, t.rating, t.play_count, t.skip_count, t.first_played, t.last_played, t.last_skipped,
  t.added, t.pinned, t.mb_recording_id,
  (SELECT a.name FROM albums a WHERE a.id = t.album_id) AS album`

function loadTracks(db: Db, ids: readonly number[]): TrackRow[] {
  const placeholders = ids.map(() => '?').join(', ')
  return db.prepare(`SELECT ${TRACK_SELECT} FROM tracks t WHERE t.id IN (${placeholders})`)
    .all(...(ids as never[])) as TrackRow[]
}

function loadSets(db: Db, ids: readonly number[]): Map<number, Map<string, string[]>> {
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT tv.track_id, tv.field_id, vv.value, tv.ordinal
    FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
    WHERE tv.track_id IN (${placeholders}) ORDER BY tv.ordinal`
  ).all(...(ids as never[])) as { track_id: number; field_id: number; value: string }[]

  const byFieldId = new Map<number, string>()
  for (const d of BUILTIN_FIELDS) if (d.fieldId !== undefined) byFieldId.set(d.fieldId, d.id)

  const out = new Map<number, Map<string, string[]>>()
  for (const r of rows) {
    const fieldId = byFieldId.get(r.field_id)
    if (!fieldId) continue
    const perTrack = out.get(r.track_id) ?? new Map<string, string[]>()
    const list = perTrack.get(fieldId) ?? []
    list.push(r.value)
    perTrack.set(fieldId, list)
    out.set(r.track_id, perTrack)
  }
  return out
}

function loadExtras(db: Db, ids: readonly number[]): Map<number, Map<string, string>> {
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT track_id, field_id, value FROM track_extras WHERE track_id IN (${placeholders})`
  ).all(...(ids as never[])) as { track_id: number; field_id: number; value: string }[]

  const byFieldId = new Map<number, string>()
  for (const d of BUILTIN_FIELDS) if (d.fieldId !== undefined) byFieldId.set(d.fieldId, d.id)

  const out = new Map<number, Map<string, string>>()
  for (const r of rows) {
    const fieldId = byFieldId.get(r.field_id)
    if (!fieldId) continue
    const perTrack = out.get(r.track_id) ?? new Map<string, string>()
    perTrack.set(fieldId, r.value)
    out.set(r.track_id, perTrack)
  }
  return out
}

const scalarOf = (row: TrackRow, fieldId: string): string | number | null => {
  if (fieldId === 'album') return row.album
  const col = COLUMN[fieldId]
  if (!col) return null
  const v = (row as unknown as Record<string, unknown>)[col]
  return (v ?? null) as string | number | null
}

const sameScalar = (a: string | number | null, b: string | number | null): boolean => a === b

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Describes what a merge would do, without doing it. The dialog is a rendering of this structure,
 * which keeps the resolution rules testable without a DOM.
 */
export function mergePreview(db: Db, ids: readonly number[]): MergePreview {
  if (ids.length < 2) throw new Error('a merge needs at least two tracks')

  const rows = loadTracks(db, ids)
  if (rows.length !== ids.length) throw new Error('one or more tracks no longer exist')

  const sets = loadSets(db, ids)
  const extras = loadExtras(db, ids)

  // The richest source is the best default survivor: most media, then most plays, then oldest.
  const mediaCounts = new Map<number, number>()
  for (const r of db.prepare(
    `SELECT track_id, COUNT(*) AS n FROM media WHERE track_id IN (${ids.map(() => '?').join(',')})
     GROUP BY track_id`).all(...(ids as never[])) as { track_id: number; n: number }[]) {
    mediaCounts.set(r.track_id, r.n)
  }

  const survivor = [...rows].sort((a, b) =>
    (mediaCounts.get(b.id) ?? 0) - (mediaCounts.get(a.id) ?? 0) ||
    b.play_count - a.play_count ||
    a.added - b.added ||
    a.id - b.id
  )[0]!.id

  const fields: PreviewField[] = []

  for (const fieldId of SCALAR_FIELDS) {
    const d: FieldDescriptor = field(fieldId)
    const options = rows.map((r) => ({ from: r.id, value: scalarOf(r, fieldId) }))
    const present = options.filter((o) => o.value !== null && o.value !== '')

    const first = present[0]?.value ?? null
    const conflict = present.length > 1 && !present.every((o) => sameScalar(o.value, first))

    fields.push(conflict
      ? { field: fieldId, name: d.name, multi: false, conflict: true, options }
      : { field: fieldId, name: d.name, multi: false, conflict: false, value: first })
  }

  for (const fieldId of MULTI_FIELDS) {
    const d = field(fieldId)
    const options = rows.map((r) => ({ from: r.id, value: sets.get(r.id)?.get(fieldId) ?? [] }))
    const union = [...new Set(options.flatMap((o) => o.value as string[]))]
    const nonEmpty = options.filter((o) => (o.value as string[]).length > 0)

    const firstSet = (nonEmpty[0]?.value ?? []) as string[]
    const conflict = nonEmpty.length > 1 &&
      !nonEmpty.every((o) => sameSet(o.value as string[], firstSet))

    fields.push(conflict
      ? { field: fieldId, name: d.name, multi: true, conflict: true, options, union }
      : { field: fieldId, name: d.name, multi: true, conflict: false, value: firstSet, union })
  }

  for (const fieldId of EXTRA_FIELDS) {
    const d = field(fieldId)
    const options = rows.map((r) => ({ from: r.id, value: extras.get(r.id)?.get(fieldId) ?? null }))
    const present = options.filter((o) => o.value !== null && o.value !== '')
    const first = present[0]?.value ?? null
    const conflict = present.length > 1 && !present.every((o) => o.value === first)

    fields.push(conflict
      ? { field: fieldId, name: d.name, multi: false, conflict: true, options }
      : { field: fieldId, name: d.name, multi: false, conflict: false, value: first })
  }

  const media = db.prepare(
    `SELECT id, track_id, uri, codec, bitrate, present FROM media
     WHERE track_id IN (${ids.map(() => '?').join(',')}) ORDER BY quality_rank DESC, id`
  ).all(...(ids as never[])) as
    { id: number; track_id: number; uri: string; codec: string | null; bitrate: number | null; present: number }[]

  const ratings = rows.map((r) => r.rating).filter((r): r is number => r !== null)
  const firstPlayed = rows.map((r) => r.first_played).filter((v): v is number => v !== null)
  const lastPlayed = rows.map((r) => r.last_played).filter((v): v is number => v !== null)

  return {
    ids: [...ids],
    survivor,
    fields,
    media: media.map((m) => ({
      id: m.id, from: m.track_id, uri: m.uri, codec: m.codec,
      bitrate: m.bitrate, present: !!m.present
    })),
    statistics: {
      playCount: rows.reduce((n, r) => n + r.play_count, 0),
      skipCount: rows.reduce((n, r) => n + r.skip_count, 0),
      // A deliberate rating must not be lost to an unrated duplicate.
      rating: ratings.length ? Math.max(...ratings) : null,
      firstPlayed: firstPlayed.length ? Math.min(...firstPlayed) : null,
      lastPlayed: lastPlayed.length ? Math.max(...lastPlayed) : null
    },
    pinnedSources: rows.filter((r) => r.pinned === 1).map((r) => r.id)
  }
}

interface Snapshot {
  tracks: TrackRow[]
  sets: { track_id: number; field_id: number; value: string; ordinal: number }[]
  extras: { track_id: number; field_id: number; value: string }[]
  media: { id: number; track_id: number }[]
  history: { id: number; track_id: number }[]
  historyDeleted: { track_id: number; at: number; kind: number; position_ms: number | null }[]
  playlists: { playlist_id: number; track_id: number; position: number }[]
}

function snapshot(db: Db, ids: readonly number[]): Snapshot {
  const ph = ids.map(() => '?').join(',')
  return {
    tracks: loadTracks(db, ids),
    sets: db.prepare(
      `SELECT tv.track_id, tv.field_id, vv.value, tv.ordinal FROM track_values tv
       JOIN values_ vv ON vv.id = tv.value_id WHERE tv.track_id IN (${ph})`
    ).all(...(ids as never[])) as Snapshot['sets'],
    extras: db.prepare(
      `SELECT track_id, field_id, value FROM track_extras WHERE track_id IN (${ph})`
    ).all(...(ids as never[])) as Snapshot['extras'],
    media: db.prepare(
      `SELECT id, track_id FROM media WHERE track_id IN (${ph})`
    ).all(...(ids as never[])) as Snapshot['media'],
    history: db.prepare(
      `SELECT id, track_id FROM play_history WHERE track_id IN (${ph})`
    ).all(...(ids as never[])) as Snapshot['history'],
    historyDeleted: [],
    playlists: db.prepare(
      `SELECT playlist_id, track_id, position FROM playlist_tracks WHERE track_id IN (${ph})`
    ).all(...(ids as never[])) as Snapshot['playlists']
  }
}

export function mergeTracks(db: Db, req: MergeRequest): MergeResult {
  const ids = [...new Set(req.ids)]
  if (ids.length < 2) throw new Error('a merge needs at least two tracks')
  if (!ids.includes(req.survivor)) throw new Error('the survivor must be one of the merged tracks')

  const absorbed = ids.filter((id) => id !== req.survivor)
  const absorbedPh = absorbed.map(() => '?').join(',')

  const preview = mergePreview(db, ids)
  const before = snapshot(db, ids)
  const batchId = `merge-${Date.now()}-${req.survivor}`
  const now = Date.now()

  const sets = loadSets(db, ids)
  const extras = loadExtras(db, ids)

  db.exec('BEGIN')
  try {
    // ── scalar fields ────────────────────────────────────────────────────────
    for (const f of preview.fields.filter((x) => !x.multi)) {
      const override = req.overrides?.[f.field]
      let value: string | number | null

      if (override !== undefined) {
        value = override
      } else {
        const res = req.resolutions?.[f.field]
        const source = res?.kind === 'value' ? res.from : req.survivor
        value = f.conflict
          ? f.options!.find((o) => o.from === source)?.value as string | number | null ?? null
          : (f.value as string | number | null ?? null)
      }

      if (f.field === 'album') {
        // Album is an entity, so keep the chosen source's album_id rather than its name.
        const res = req.resolutions?.[f.field]
        const source = res?.kind === 'value' ? res.from : req.survivor
        const row = before.tracks.find((t) => t.id === source)
        db.prepare('UPDATE tracks SET album_id = ? WHERE id = ?')
          .run((row?.album_id ?? null) as never, req.survivor as never)
        continue
      }

      if (f.field === 'comment') continue // handled with the extras below

      const col = COLUMN[f.field]
      if (!col) continue
      db.prepare(`UPDATE tracks SET ${col} = ? WHERE id = ?`)
        .run(value as never, req.survivor as never)
    }

    // ── multi-value fields ───────────────────────────────────────────────────
    const insertValue = db.prepare('INSERT OR IGNORE INTO values_ (field_id, value) VALUES (?, ?)')
    const selectValue = db.prepare('SELECT id FROM values_ WHERE field_id = ? AND value = ?')
    const clearSet = db.prepare('DELETE FROM track_values WHERE track_id = ? AND field_id = ?')
    const insertTv = db.prepare(
      'INSERT OR IGNORE INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)')

    for (const f of preview.fields.filter((x) => x.multi)) {
      const fid = field(f.field).fieldId!
      const res = req.resolutions?.[f.field]

      // Union is the default: keeping every genre is nearly always what was meant.
      let values: string[]
      if (res?.kind === 'value') values = (sets.get(res.from)?.get(f.field) ?? []).slice()
      else values = f.union ?? []

      clearSet.run(req.survivor as never, fid as never)
      values.forEach((v, ordinal) => {
        insertValue.run(fid as never, v as never)
        const vid = (selectValue.get(fid as never, v as never) as { id: number }).id
        insertTv.run(req.survivor as never, fid as never, vid as never, ordinal as never)
      })
    }

    // ── extras ───────────────────────────────────────────────────────────────
    for (const fieldId of EXTRA_FIELDS) {
      const res = req.resolutions?.[fieldId]
      const source = res?.kind === 'value' ? res.from : req.survivor
      const value = req.overrides?.[fieldId] ?? extras.get(source)?.get(fieldId) ?? null

      if (value === null) continue
      db.prepare(
        'INSERT INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?) ' +
        'ON CONFLICT(track_id, field_id) DO UPDATE SET value = excluded.value'
      ).run(req.survivor as never, field(fieldId).fieldId as never, value as never)
    }

    // ── media: the whole point of a merge ────────────────────────────────────
    const mediaMoved = absorbed.length
      ? (db.prepare(`UPDATE media SET track_id = ? WHERE track_id IN (${absorbedPh})`)
          .run(req.survivor as never, ...(absorbed as never[])) as { changes?: number }).changes ?? 0
      : 0

    // ── play history: union, deduplicated by the migration-002 constraint ────
    const historyDeleted = db.prepare(
      `SELECT track_id, at, kind, position_ms FROM play_history
       WHERE track_id IN (${absorbedPh})
         AND EXISTS (SELECT 1 FROM play_history p2
                     WHERE p2.track_id = ? AND p2.at = play_history.at AND p2.kind = play_history.kind)`
    ).all(...(absorbed as never[]), req.survivor as never) as Snapshot['historyDeleted']

    const historyMoved = absorbed.length
      ? (db.prepare(`UPDATE OR IGNORE play_history SET track_id = ? WHERE track_id IN (${absorbedPh})`)
          .run(req.survivor as never, ...(absorbed as never[])) as { changes?: number }).changes ?? 0
      : 0

    // Anything left could not move because the survivor already had that exact event.
    if (absorbed.length) {
      db.prepare(`DELETE FROM play_history WHERE track_id IN (${absorbedPh})`)
        .run(...(absorbed as never[]))
    }

    // ── playlists ────────────────────────────────────────────────────────────
    let playlistEntriesRepointed = 0
    if (absorbed.length) {
      playlistEntriesRepointed =
        (db.prepare(`UPDATE playlist_tracks SET track_id = ? WHERE track_id IN (${absorbedPh})`)
          .run(req.survivor as never, ...(absorbed as never[])) as { changes?: number }).changes ?? 0

      // Repointing can put the survivor in one playlist twice; keep its earliest position.
      db.prepare(`
        DELETE FROM playlist_tracks
        WHERE track_id = ? AND position NOT IN (
          SELECT MIN(position) FROM playlist_tracks WHERE track_id = ? GROUP BY playlist_id
        )`).run(req.survivor as never, req.survivor as never)
    }

    // ── statistics ───────────────────────────────────────────────────────────
    const stats = preview.statistics
    const added = Math.min(...before.tracks.map((t) => t.added))
    const lastSkipped = before.tracks
      .map((t) => t.last_skipped).filter((v): v is number => v !== null)

    db.prepare(`
      UPDATE tracks SET rating = ?, play_count = ?, skip_count = ?, first_played = ?,
                        last_played = ?, last_skipped = ?, added = ?,
                        pinned = 1, identity_source = 'manual', modified = ?
      WHERE id = ?`).run(
      stats.rating as never, stats.playCount as never, stats.skipCount as never,
      stats.firstPlayed as never, stats.lastPlayed as never,
      (lastSkipped.length ? Math.max(...lastSkipped) : null) as never,
      added as never, now as never, req.survivor as never
    )

    // ── remove the absorbed tracks ───────────────────────────────────────────
    if (absorbed.length) {
      db.prepare(`DELETE FROM tracks WHERE id IN (${absorbedPh})`).run(...(absorbed as never[]))
    }

    before.historyDeleted = historyDeleted
    db.prepare('INSERT INTO merge_journal (batch_id, at, survivor_id, snapshot) VALUES (?, ?, ?, ?)')
      .run(batchId as never, now as never, req.survivor as never, JSON.stringify(before) as never)

    db.exec('COMMIT')

    return {
      batchId, survivor: req.survivor, absorbed,
      mediaMoved, historyMoved, playlistEntriesRepointed
    }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export interface UnmergeResult {
  batchId: string
  restored: number[]
  survivor: number
}

/** Puts the library back exactly as it was before a merge. */
export function unmerge(db: Db, batchId: string): UnmergeResult {
  const entry = db.prepare(
    'SELECT survivor_id, snapshot, undone FROM merge_journal WHERE batch_id = ?'
  ).get(batchId as never) as { survivor_id: number; snapshot: string; undone: number } | undefined

  if (!entry) throw new Error(`no merge recorded under ${batchId}`)
  if (entry.undone) throw new Error(`${batchId} has already been undone`)

  const before = JSON.parse(entry.snapshot) as Snapshot
  const survivor = entry.survivor_id

  db.exec('BEGIN')
  try {
    // Recreate the absorbed tracks with their original ids, so media and history can point back.
    const insert = db.prepare(`
      INSERT INTO tracks (id, title, album_id, year, track_number, disc_number, length_ms,
                          compilation, bpm, rating, play_count, skip_count, first_played,
                          last_played, last_skipped, added, pinned, mb_recording_id,
                          identity_source, modified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'heuristic', ?)`)

    const update = db.prepare(`
      UPDATE tracks SET title = ?, album_id = ?, year = ?, track_number = ?, disc_number = ?,
                        length_ms = ?, compilation = ?, bpm = ?, rating = ?, play_count = ?,
                        skip_count = ?, first_played = ?, last_played = ?, last_skipped = ?,
                        added = ?, pinned = ?, modified = ?
      WHERE id = ?`)

    const now = Date.now()
    const restored: number[] = []

    for (const t of before.tracks) {
      if (t.id === survivor) {
        update.run(
          t.title as never, t.album_id as never, t.year as never, t.track_number as never,
          t.disc_number as never, t.length_ms as never, t.compilation as never, t.bpm as never,
          t.rating as never, t.play_count as never, t.skip_count as never,
          t.first_played as never, t.last_played as never, t.last_skipped as never,
          t.added as never, t.pinned as never, now as never, t.id as never
        )
      } else {
        insert.run(
          t.id as never, t.title as never, t.album_id as never, t.year as never,
          t.track_number as never, t.disc_number as never, t.length_ms as never,
          t.compilation as never, t.bpm as never, t.rating as never, t.play_count as never,
          t.skip_count as never, t.first_played as never, t.last_played as never,
          t.last_skipped as never, t.added as never, t.pinned as never,
          t.mb_recording_id as never, now as never
        )
        restored.push(t.id)
      }
    }

    const ids = before.tracks.map((t) => t.id)
    const ph = ids.map(() => '?').join(',')

    db.prepare(`DELETE FROM track_values WHERE track_id IN (${ph})`).run(...(ids as never[]))
    db.prepare(`DELETE FROM track_extras WHERE track_id IN (${ph})`).run(...(ids as never[]))

    const insertTv = db.prepare(
      'INSERT OR IGNORE INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)')
    const insertValue = db.prepare('INSERT OR IGNORE INTO values_ (field_id, value) VALUES (?, ?)')
    const selectValue = db.prepare('SELECT id FROM values_ WHERE field_id = ? AND value = ?')

    for (const r of before.sets) {
      insertValue.run(r.field_id as never, r.value as never)
      const vid = (selectValue.get(r.field_id as never, r.value as never) as { id: number }).id
      insertTv.run(r.track_id as never, r.field_id as never, vid as never, r.ordinal as never)
    }

    const insertExtra = db.prepare(
      'INSERT OR IGNORE INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?)')
    for (const r of before.extras) {
      insertExtra.run(r.track_id as never, r.field_id as never, r.value as never)
    }

    const moveMedia = db.prepare('UPDATE media SET track_id = ? WHERE id = ?')
    for (const m of before.media) moveMedia.run(m.track_id as never, m.id as never)

    const moveHistory = db.prepare('UPDATE OR IGNORE play_history SET track_id = ? WHERE id = ?')
    for (const h of before.history) moveHistory.run(h.track_id as never, h.id as never)

    const restoreHistory = db.prepare(
      'INSERT OR IGNORE INTO play_history (track_id, at, kind, position_ms) VALUES (?, ?, ?, ?)')
    for (const h of before.historyDeleted) {
      restoreHistory.run(
        h.track_id as never, h.at as never, h.kind as never, (h.position_ms ?? null) as never)
    }

    db.prepare(`DELETE FROM playlist_tracks WHERE track_id IN (${ph})`).run(...(ids as never[]))
    const insertPl = db.prepare(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
    for (const p of before.playlists) {
      insertPl.run(p.playlist_id as never, p.track_id as never, p.position as never)
    }

    db.prepare('UPDATE merge_journal SET undone = 1 WHERE batch_id = ?').run(batchId as never)
    db.exec('COMMIT')

    return { batchId, restored, survivor }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
