// Merging several track records into one.
// §3.5.0 deliberately refuses to guess that two different files are the same recording, which
// leaves the user to say so. The model follows Thunderbird CardBook: resolve conflicts per *field*
// rather than picking a winning record, because the right answer is usually spread across sources —
// one file has the better title, another has the year, a third has the genre.
// Every merge is journaled in full and can be undone. That is a prerequisite, not a nicety: a merge
// deletes rows holding ratings and play history that cannot be reconstructed from the files. The
// track history records each merge as well, but only this journal holds the plays and playlist
// places that an exact undo needs, all tracks at once.

import { in_transaction, type SqlDatabase, type SqlValue } from '@x-tech-laboratories/x-libs/sql'

import { BUILTIN_FIELDS, field, type FieldDescriptor } from '../fields.ts'
import { all_rows, first_row, new_id, placeholders, run } from './database.ts'
import { intern_value, set_extra } from './values.ts'

export type Resolution =
  | { kind: 'value'; from: string }
  | { kind: 'union' }

export interface MergeRequest {
  ids: readonly string[]
  survivor: string
  // Field id → how to resolve it. Fields left out take the survivor's value.
  resolutions?: Record<string, Resolution>
  // Field id → an explicit value, for a field the user typed rather than chose.
  overrides?: Record<string, string | number | null>
}

export interface FieldOption {
  from: string
  value: string | number | null | string[]
}

export interface PreviewField {
  field: string
  name: string
  multi: boolean
  conflict: boolean
  // Present when every source agrees.
  value?: string | number | null | string[]
  options?: FieldOption[]
  // For multi-value fields, the union of every source.
  union?: string[]
}

export interface PreviewMedia {
  id: string
  from: string
  uri: string
  codec: string | null
  bitrate: number | null
  present: boolean
}

export interface MergePreview {
  ids: string[]
  survivor: string
  fields: PreviewField[]
  media: PreviewMedia[]
  statistics: {
    playCount: number
    skipCount: number
    rating: number | null
    firstPlayed: number | null
    lastPlayed: number | null
  }
  // True when at least one source is pinned; merging overrides a human decision.
  pinnedSources: string[]
}

export interface MergeResult {
  batchId: string
  survivor: string
  absorbed: string[]
  mediaMoved: number
  historyMoved: number
  playlistEntriesRepointed: number
}

// Scalar fields offered for resolution, in the order a person reads them.
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
  id: string
  title: string | null
  album_id: string | null
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

const compare_ids = (first: string, second: string): number => (first < second ? -1 : first > second ? 1 : 0)

function load_tracks(database: SqlDatabase, ids: readonly string[]): TrackRow[] {
  return all_rows<TrackRow>(database, `SELECT ${TRACK_SELECT} FROM tracks t WHERE t.id IN (${placeholders(ids)})`, ...ids)
    .map((row) => ({ ...row }))
}

const fields_by_number = (): Map<number, string> => {
  const by_field_id = new Map<number, string>()
  for (const d of BUILTIN_FIELDS) if (d.field_id !== undefined) by_field_id.set(d.field_id, d.id)
  return by_field_id
}

function load_sets(database: SqlDatabase, ids: readonly string[]): Map<string, Map<string, string[]>> {
  const rows = all_rows<{ track_id: string; field_id: number; value: string }>(database, `
    SELECT tv.track_id, tv.field_id, vv.value, tv.ordinal
    FROM track_values tv JOIN values_ vv ON vv.id = tv.value_id
    WHERE tv.track_id IN (${placeholders(ids)}) ORDER BY tv.ordinal`, ...ids)

  const by_field_id = fields_by_number()
  const out = new Map<string, Map<string, string[]>>()
  for (const r of rows) {
    const field_id = by_field_id.get(r.field_id)
    if (!field_id) continue
    const per_track = out.get(r.track_id) ?? new Map<string, string[]>()
    const list = per_track.get(field_id) ?? []
    list.push(r.value)
    per_track.set(field_id, list)
    out.set(r.track_id, per_track)
  }
  return out
}

function load_extras(database: SqlDatabase, ids: readonly string[]): Map<string, Map<string, string>> {
  const rows = all_rows<{ track_id: string; field_id: number; value: string }>(
    database, `SELECT track_id, field_id, value FROM track_extras WHERE track_id IN (${placeholders(ids)})`, ...ids)

  const by_field_id = fields_by_number()
  const out = new Map<string, Map<string, string>>()
  for (const r of rows) {
    const field_id = by_field_id.get(r.field_id)
    if (!field_id) continue
    const per_track = out.get(r.track_id) ?? new Map<string, string>()
    per_track.set(field_id, r.value)
    out.set(r.track_id, per_track)
  }
  return out
}

const scalar_of = (row: TrackRow, field_id: string): string | number | null => {
  if (field_id === 'album') return row.album
  const col = COLUMN[field_id]
  if (!col) return null
  const v = (row as unknown as Record<string, unknown>)[col]
  return (v ?? null) as string | number | null
}

const same_scalar = (a: string | number | null, b: string | number | null): boolean => a === b

const same_set = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

// Describes what a merge would do, without doing it. The dialog is a rendering of this structure, which keeps the resolution rules testable without a DOM.
export function merge_preview(database: SqlDatabase, ids: readonly string[]): MergePreview {
  if (ids.length < 2) throw new Error('a merge needs at least two tracks')

  const rows = load_tracks(database, ids)
  if (rows.length !== ids.length) throw new Error('one or more tracks no longer exist')

  const sets = load_sets(database, ids)
  const extras = load_extras(database, ids)

  // The richest source is the best default survivor: most media, then most plays, then oldest.
  const media_counts = new Map<string, number>()
  for (const r of all_rows<{ track_id: string; n: number }>(database,
    `SELECT track_id, COUNT(*) AS n FROM media WHERE track_id IN (${placeholders(ids)}) GROUP BY track_id`, ...ids)) {
    media_counts.set(r.track_id, r.n)
  }

  const survivor = [...rows].sort((a, b) =>
    (media_counts.get(b.id) ?? 0) - (media_counts.get(a.id) ?? 0) ||
    b.play_count - a.play_count ||
    a.added - b.added ||
    compare_ids(a.id, b.id)
  )[0]!.id

  const fields: PreviewField[] = []

  for (const field_id of SCALAR_FIELDS) {
    const d: FieldDescriptor = field(field_id)
    const options = rows.map((r) => ({ from: r.id, value: scalar_of(r, field_id) }))
    const present = options.filter((o) => o.value !== null && o.value !== '')

    const first = present[0]?.value ?? null
    const conflict = present.length > 1 && !present.every((o) => same_scalar(o.value, first))

    fields.push(conflict
      ? { field: field_id, name: d.name, multi: false, conflict: true, options }
      : { field: field_id, name: d.name, multi: false, conflict: false, value: first })
  }

  for (const fieldId of MULTI_FIELDS) {
    const d = field(fieldId)
    const options = rows.map((r) => ({ from: r.id, value: sets.get(r.id)?.get(fieldId) ?? [] }))
    const union = [...new Set(options.flatMap((o) => o.value as string[]))]
    const non_empty = options.filter((o) => (o.value as string[]).length > 0)

    const first_set = (non_empty[0]?.value ?? []) as string[]
    const conflict = non_empty.length > 1 &&
      !non_empty.every((o) => same_set(o.value as string[], first_set))

    fields.push(conflict
      ? { field: fieldId, name: d.name, multi: true, conflict: true, options, union }
      : { field: fieldId, name: d.name, multi: true, conflict: false, value: first_set, union })
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

  const media = all_rows<{ id: string; track_id: string; uri: string; codec: string | null; bitrate: number | null; present: number }>(
    database,
    `SELECT id, track_id, uri, codec, bitrate, present FROM media
     WHERE track_id IN (${placeholders(ids)}) ORDER BY quality_rank DESC, added, id`, ...ids)

  const ratings = rows.map((r) => r.rating).filter((r): r is number => r !== null)
  const first_played = rows.map((r) => r.first_played).filter((v): v is number => v !== null)
  const last_played = rows.map((r) => r.last_played).filter((v): v is number => v !== null)

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
      firstPlayed: first_played.length ? Math.min(...first_played) : null,
      lastPlayed: last_played.length ? Math.max(...last_played) : null
    },
    pinnedSources: rows.filter((r) => r.pinned === 1).map((r) => r.id)
  }
}

interface Snapshot {
  tracks: TrackRow[]
  sets: { track_id: string; field_id: number; value: string; ordinal: number }[]
  extras: { track_id: string; field_id: number; value: string }[]
  media: { id: string; track_id: string }[]
  history: { id: string; track_id: string }[]
  historyDeleted: { track_id: string; at: number; kind: number; position_ms: number | null }[]
  playlists: { playlist_id: string; track_id: string; position: number }[]
}

function snapshot(database: SqlDatabase, ids: readonly string[]): Snapshot {
  const ph = placeholders(ids)
  const plain = <Row>(rows: Row[]): Row[] => rows.map((row) => ({ ...row }))
  return {
    tracks: load_tracks(database, ids),
    sets: plain(all_rows<Snapshot['sets'][number]>(database,
      `SELECT tv.track_id, tv.field_id, vv.value, tv.ordinal FROM track_values tv
       JOIN values_ vv ON vv.id = tv.value_id WHERE tv.track_id IN (${ph})`, ...ids)),
    extras: plain(all_rows<Snapshot['extras'][number]>(database,
      `SELECT track_id, field_id, value FROM track_extras WHERE track_id IN (${ph})`, ...ids)),
    media: plain(all_rows<Snapshot['media'][number]>(database, `SELECT id, track_id FROM media WHERE track_id IN (${ph})`, ...ids)),
    history: plain(all_rows<Snapshot['history'][number]>(database, `SELECT id, track_id FROM play_history WHERE track_id IN (${ph})`, ...ids)),
    historyDeleted: [],
    playlists: plain(all_rows<Snapshot['playlists'][number]>(database,
      `SELECT playlist_id, track_id, position FROM playlist_tracks WHERE track_id IN (${ph})`, ...ids))
  }
}

export function merge_tracks(database: SqlDatabase, req: MergeRequest): MergeResult {
  const ids = [...new Set(req.ids)]
  if (ids.length < 2) throw new Error('a merge needs at least two tracks')
  if (!ids.includes(req.survivor)) throw new Error('the survivor must be one of the merged tracks')

  const absorbed = ids.filter((id) => id !== req.survivor)
  const absorbed_ph = placeholders(absorbed)

  const preview = merge_preview(database, ids)
  const before = snapshot(database, ids)
  const batch_id = `merge-${new_id()}`
  const now = Date.now()

  const sets = load_sets(database, ids)
  const extras = load_extras(database, ids)

  return in_transaction(database, () => {
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
        run(database, 'UPDATE tracks SET album_id = ? WHERE id = ?', row?.album_id ?? null, req.survivor)
        continue
      }

      if (f.field === 'comment') continue // handled with the extras below

      const col = COLUMN[f.field]
      if (!col) continue
      run(database, `UPDATE tracks SET ${col} = ? WHERE id = ?`, value, req.survivor)
    }

    // ── multi-value fields ───────────────────────────────────────────────────
    for (const f of preview.fields.filter((x) => x.multi)) {
      const fid = field(f.field).field_id!
      const res = req.resolutions?.[f.field]

      // Union is the default: keeping every genre is nearly always what was meant.
      let values: string[]
      if (res?.kind === 'value') values = (sets.get(res.from)?.get(f.field) ?? []).slice()
      else values = f.union ?? []

      run(database, 'DELETE FROM track_values WHERE track_id = ? AND field_id = ?', req.survivor, fid)
      values.forEach((v, ordinal) => {
        run(database, 'INSERT OR IGNORE INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)',
          req.survivor, fid, intern_value(database, fid, v), ordinal)
      })
    }

    // ── extras ───────────────────────────────────────────────────────────────
    for (const field_id of EXTRA_FIELDS) {
      const res = req.resolutions?.[field_id]
      const source = res?.kind === 'value' ? res.from : req.survivor
      const value = req.overrides?.[field_id] ?? extras.get(source)?.get(field_id) ?? null

      if (value === null) continue
      set_extra(database, req.survivor, field(field_id).field_id!, String(value))
    }

    // ── media: the whole point of a merge ────────────────────────────────────
    const media_moved = run(database, `UPDATE media SET track_id = ? WHERE track_id IN (${absorbed_ph})`, req.survivor, ...absorbed)

    // ── play history: union, deduplicated by the unique play constraint ──────
    const history_deleted = all_rows<Snapshot['historyDeleted'][number]>(database,
      `SELECT track_id, at, kind, position_ms FROM play_history
       WHERE track_id IN (${absorbed_ph})
         AND EXISTS (SELECT 1 FROM play_history p2
                     WHERE p2.track_id = ? AND p2.at = play_history.at AND p2.kind = play_history.kind)`,
      ...absorbed, req.survivor).map((row) => ({ ...row }))

    const history_moved = run(database, `UPDATE OR IGNORE play_history SET track_id = ? WHERE track_id IN (${absorbed_ph})`, req.survivor, ...absorbed)

    // Anything left could not move because the survivor already had that exact event.
    run(database, `DELETE FROM play_history WHERE track_id IN (${absorbed_ph})`, ...absorbed)

    // ── playlists ────────────────────────────────────────────────────────────
    const playlist_entries_repointed = run(database, `UPDATE playlist_tracks SET track_id = ? WHERE track_id IN (${absorbed_ph})`, req.survivor, ...absorbed)

    // Repointing can put the survivor in one playlist twice; keep its earliest position.
    run(database, `
      DELETE FROM playlist_tracks
      WHERE track_id = ? AND position NOT IN (
        SELECT MIN(position) FROM playlist_tracks WHERE track_id = ? GROUP BY playlist_id
      )`, req.survivor, req.survivor)

    // ── statistics ───────────────────────────────────────────────────────────
    const stats = preview.statistics
    const added = Math.min(...before.tracks.map((t) => t.added))
    const last_skipped = before.tracks
      .map((t) => t.last_skipped).filter((v): v is number => v !== null)

    run(database, `
      UPDATE tracks SET rating = ?, play_count = ?, skip_count = ?, first_played = ?,
                        last_played = ?, last_skipped = ?, added = ?,
                        pinned = 1, identity_source = 'manual', modified = ?
      WHERE id = ?`,
      stats.rating, stats.playCount, stats.skipCount, stats.firstPlayed, stats.lastPlayed,
      last_skipped.length ? Math.max(...last_skipped) : null, added, now, req.survivor)

    // ── remove the absorbed tracks ───────────────────────────────────────────
    run(database, `DELETE FROM tracks WHERE id IN (${absorbed_ph})`, ...absorbed)

    before.historyDeleted = history_deleted
    run(database, 'INSERT INTO merge_journal (id, batch_id, at, survivor_id, snapshot) VALUES (?, ?, ?, ?, ?)',
      new_id(), batch_id, now, req.survivor, JSON.stringify(before))

    return { batchId: batch_id, survivor: req.survivor, absorbed, mediaMoved: media_moved, historyMoved: history_moved, playlistEntriesRepointed: playlist_entries_repointed }
  })
}

export interface UnmergeResult {
  batchId: string
  restored: string[]
  survivor: string
}

const track_columns = [
  'title', 'album_id', 'year', 'track_number', 'disc_number', 'length_ms', 'compilation', 'bpm', 'rating', 'play_count',
  'skip_count', 'first_played', 'last_played', 'last_skipped', 'added', 'pinned', 'mb_recording_id'
] as const

// Puts the library back exactly as it was before a merge.
export function unmerge(database: SqlDatabase, batch_id: string): UnmergeResult {
  const entry = first_row<{ survivor_id: string; snapshot: string; undone: number }>(database,
    'SELECT survivor_id, snapshot, undone FROM merge_journal WHERE batch_id = ?', batch_id)

  if (!entry) throw new Error(`no merge recorded under ${batch_id}`)
  if (entry.undone) throw new Error(`${batch_id} has already been undone`)

  const before = JSON.parse(entry.snapshot) as Snapshot
  const survivor = entry.survivor_id

  return in_transaction(database, () => {
    const now = Date.now()
    const restored: string[] = []
    const album_of = (id: string | null): string | null =>
      id !== null && first_row(database, 'SELECT 1 FROM albums WHERE id = ?', id) !== undefined ? id : null

    for (const t of before.tracks) {
      const values: SqlValue[] = track_columns.map((column) => column === 'album_id' ? album_of(t.album_id) : t[column])
      if (t.id === survivor) {
        run(database, `UPDATE tracks SET ${track_columns.filter((c) => c !== 'mb_recording_id').map((c) => `${c} = ?`).join(', ')}, modified = ? WHERE id = ?`,
          ...values.slice(0, -1), now, t.id)
      } else {
        // A track with this id that was added at another time is not the one this merge took, so the undo stops.
        const existing = first_row<{ added: number }>(database, 'SELECT added FROM tracks WHERE id = ?', t.id)
        if (existing && existing.added !== t.added) throw new Error(`undoing ${batch_id} would overwrite a track this merge did not take`)
        // Recreated with its own id, so media and history can point back; a history restore may have brought it back already.
        const updated = run(database, `UPDATE tracks SET ${track_columns.map((c) => `${c} = ?`).join(', ')}, modified = ? WHERE id = ?`,
          ...values, now, t.id)
        if (updated === 0) {
          run(database, `INSERT INTO tracks (id, ${track_columns.join(', ')}, identity_source, modified)
                         VALUES (?, ${placeholders(track_columns)}, 'heuristic', ?)`, t.id, ...values, now)
        }
        restored.push(t.id)
      }
    }

    const ids = before.tracks.map((t) => t.id)
    const ph = placeholders(ids)

    run(database, `DELETE FROM track_values WHERE track_id IN (${ph})`, ...ids)
    run(database, `DELETE FROM track_extras WHERE track_id IN (${ph})`, ...ids)

    for (const r of before.sets) {
      run(database, 'INSERT OR IGNORE INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)',
        r.track_id, r.field_id, intern_value(database, r.field_id, r.value), r.ordinal)
    }

    for (const r of before.extras) {
      run(database, 'INSERT OR IGNORE INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?)', r.track_id, r.field_id, r.value)
    }

    for (const m of before.media) run(database, 'UPDATE media SET track_id = ? WHERE id = ?', m.track_id, m.id)

    for (const h of before.history) run(database, 'UPDATE OR IGNORE play_history SET track_id = ? WHERE id = ?', h.track_id, h.id)

    for (const h of before.historyDeleted) {
      run(database, 'INSERT OR IGNORE INTO play_history (id, track_id, at, kind, position_ms) VALUES (?, ?, ?, ?, ?)',
        new_id(), h.track_id, h.at, h.kind, h.position_ms ?? null)
    }

    run(database, `DELETE FROM playlist_tracks WHERE track_id IN (${ph})`, ...ids)
    for (const p of before.playlists) {
      run(database, 'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', p.playlist_id, p.track_id, p.position)
    }

    run(database, 'UPDATE merge_journal SET undone = 1 WHERE batch_id = ?', batch_id)

    return { batchId: batch_id, restored, survivor }
  })
}

// ── Listing ──────────────────────────────────────────────────────────────────

export interface MergeEntry {
  batch_id: string
  at: number
  survivor_id: string
  // The survivor's title now, or as it was before the merge once it is gone.
  survivor_title: string | null
  // The tracks the merge took into the survivor, as they were before it.
  absorbed: { id: string; title: string | null }[]
  undone: boolean
}

// The latest merges, newest first, undone ones included, for the History page.
export function list_recent_merges(database: SqlDatabase, limit: number): MergeEntry[] {
  const rows = all_rows<{ batch_id: string; at: number; survivor_id: string; snapshot: string; undone: number; current_title: string | null }>(database, `
    SELECT batch_id, at, survivor_id, snapshot, undone, (SELECT title FROM tracks WHERE tracks.id = survivor_id) AS current_title
    FROM merge_journal ORDER BY at DESC, id DESC LIMIT ?`, limit)
  return rows.map((row) => {
    const tracks = (JSON.parse(row.snapshot) as Snapshot).tracks
    const survivor = tracks.find((track) => track.id === row.survivor_id)
    return {
      batch_id: row.batch_id,
      at: row.at,
      survivor_id: row.survivor_id,
      survivor_title: row.current_title ?? survivor?.title ?? null,
      absorbed: tracks.filter((track) => track.id !== row.survivor_id).map((track) => ({ id: track.id, title: track.title })),
      undone: row.undone === 1
    }
  })
}
