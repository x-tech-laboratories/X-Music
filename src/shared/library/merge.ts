// Merging several track records into one.
// §3.5.0 deliberately refuses to guess that two different files are the same recording, which
// leaves the user to say so. The model follows Thunderbird CardBook: resolve conflicts per *field*
// rather than picking a winning record, because the right answer is usually spread across sources —
// one file has the better title, another has the year, a third has the genre.
// Every merge is journaled in full and can be undone. That is a prerequisite, not a nicety: a merge
// deletes rows holding ratings and play history that cannot be reconstructed from the files. The
// track history records each merge as well, but only this journal holds the plays and playlist
// places that an exact undo needs, all tracks at once.

import { check_known_ids } from '@x-tech-laboratories/x-libs/api_spec'
import { and, asc, count, desc, drizzle_of, eq, inArray, min, notInArray, sql } from '@x-tech-laboratories/x-libs/drizzle'
import { in_transaction, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { BUILTIN_FIELDS, field, type FieldDescriptor } from '../fields.ts'
import { album_name, changes, new_id, placeholders, run } from './database.ts'
import { albums, media as media_table, merge_journal, play_history, playlist_tracks, track_extras, track_values, tracks, values_ } from './schema.ts'
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
    play_count: number
    skip_count: number
    rating: number | null
    first_played: number | null
    last_played: number | null
  }
  // True when at least one source is pinned; merging overrides a human decision.
  pinned_sources: string[]
}

export interface MergeResult {
  batch_id: string
  survivor: string
  absorbed: string[]
  media_moved: number
  history_moved: number
  playlist_entries_repointed: number
}

// Scalar fields offered for resolution, in the order a person reads them.
const SCALAR_FIELDS = [
  'title', 'album', 'year', 'track_number', 'disc_number', 'length', 'bpm', 'compilation'
] as const

const MULTI_FIELDS = ['artist', 'album_artist', 'genre', 'grouping', 'tags'] as const
const EXTRA_FIELDS = ['comment'] as const

const COLUMN: Record<string, 'title' | 'year' | 'track_number' | 'disc_number' | 'length_ms' | 'bpm' | 'compilation'> = {
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

const track_select = {
  id: tracks.id, title: tracks.title, album_id: tracks.album_id, year: tracks.year, track_number: tracks.track_number,
  disc_number: tracks.disc_number, length_ms: tracks.length_ms, compilation: tracks.compilation, bpm: tracks.bpm,
  rating: tracks.rating, play_count: tracks.play_count, skip_count: tracks.skip_count, first_played: tracks.first_played,
  last_played: tracks.last_played, last_skipped: tracks.last_skipped, added: tracks.added, pinned: tracks.pinned,
  mb_recording_id: tracks.mb_recording_id, album: album_name
}

const compare_ids = (first: string, second: string): number => (first < second ? -1 : first > second ? 1 : 0)

function load_tracks(database: SqlDatabase, ids: readonly string[]): TrackRow[] {
  return drizzle_of(database).select(track_select).from(tracks).where(inArray(tracks.id, [...ids])).all()
}

const fields_by_number = (): Map<number, string> => {
  const by_field_id = new Map<number, string>()
  for (const d of BUILTIN_FIELDS) if (d.field_id !== undefined) by_field_id.set(d.field_id, d.id)
  return by_field_id
}

function load_sets(database: SqlDatabase, ids: readonly string[]): Map<string, Map<string, string[]>> {
  const rows = drizzle_of(database)
    .select({ track_id: track_values.track_id, field_id: track_values.field_id, value: values_.value, ordinal: track_values.ordinal })
    .from(track_values).innerJoin(values_, eq(values_.id, track_values.value_id))
    .where(inArray(track_values.track_id, [...ids])).orderBy(track_values.ordinal).all()

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
  const rows = drizzle_of(database)
    .select({ track_id: track_extras.track_id, field_id: track_extras.field_id, value: track_extras.value })
    .from(track_extras).where(inArray(track_extras.track_id, [...ids])).all()

  const by_field_id = fields_by_number()
  const out = new Map<string, Map<string, string>>()
  for (const r of rows) {
    const field_id = by_field_id.get(r.field_id)
    if (!field_id) continue
    const per_track = out.get(r.track_id) ?? new Map<string, string>()
    per_track.set(field_id, r.value as string)
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
  check_known_ids(ids, new Set(rows.map((row) => row.id)), 'track')

  const sets = load_sets(database, ids)
  const extras = load_extras(database, ids)

  // The richest source is the best default survivor: most media, then most plays, then oldest.
  const media_counts = new Map<string, number>()
  const counted = drizzle_of(database).select({ track_id: media_table.track_id, n: count() }).from(media_table)
    .where(inArray(media_table.track_id, [...ids])).groupBy(media_table.track_id).all()
  for (const r of counted) media_counts.set(r.track_id, r.n)

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

  for (const field_id of MULTI_FIELDS) {
    const d = field(field_id)
    const options = rows.map((r) => ({ from: r.id, value: sets.get(r.id)?.get(field_id) ?? [] }))
    const union = [...new Set(options.flatMap((o) => o.value as string[]))]
    const non_empty = options.filter((o) => (o.value as string[]).length > 0)

    const first_set = (non_empty[0]?.value ?? []) as string[]
    const conflict = non_empty.length > 1 &&
      !non_empty.every((o) => same_set(o.value as string[], first_set))

    fields.push(conflict
      ? { field: field_id, name: d.name, multi: true, conflict: true, options, union }
      : { field: field_id, name: d.name, multi: true, conflict: false, value: first_set, union })
  }

  for (const field_id of EXTRA_FIELDS) {
    const d = field(field_id)
    const options = rows.map((r) => ({ from: r.id, value: extras.get(r.id)?.get(field_id) ?? null }))
    const present = options.filter((o) => o.value !== null && o.value !== '')
    const first = present[0]?.value ?? null
    const conflict = present.length > 1 && !present.every((o) => o.value === first)

    fields.push(conflict
      ? { field: field_id, name: d.name, multi: false, conflict: true, options }
      : { field: field_id, name: d.name, multi: false, conflict: false, value: first })
  }

  const media = drizzle_of(database)
    .select({ id: media_table.id, track_id: media_table.track_id, uri: media_table.uri, codec: media_table.codec, bitrate: media_table.bitrate, present: media_table.present })
    .from(media_table).where(inArray(media_table.track_id, [...ids]))
    .orderBy(desc(media_table.quality_rank), asc(media_table.added), asc(media_table.id)).all()

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
      play_count: rows.reduce((n, r) => n + r.play_count, 0),
      skip_count: rows.reduce((n, r) => n + r.skip_count, 0),
      // A deliberate rating must not be lost to an unrated duplicate.
      rating: ratings.length ? Math.max(...ratings) : null,
      first_played: first_played.length ? Math.min(...first_played) : null,
      last_played: last_played.length ? Math.max(...last_played) : null
    },
    pinned_sources: rows.filter((r) => r.pinned === 1).map((r) => r.id)
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
  const db = drizzle_of(database)
  const list = [...ids]
  return {
    tracks: load_tracks(database, ids),
    sets: db.select({ track_id: track_values.track_id, field_id: track_values.field_id, value: values_.value, ordinal: track_values.ordinal })
      .from(track_values).innerJoin(values_, eq(values_.id, track_values.value_id)).where(inArray(track_values.track_id, list)).all(),
    extras: db.select({ track_id: track_extras.track_id, field_id: track_extras.field_id, value: track_extras.value })
      .from(track_extras).where(inArray(track_extras.track_id, list)).all() as Snapshot['extras'],
    media: db.select({ id: media_table.id, track_id: media_table.track_id }).from(media_table).where(inArray(media_table.track_id, list)).all(),
    history: db.select({ id: play_history.id, track_id: play_history.track_id }).from(play_history).where(inArray(play_history.track_id, list)).all(),
    historyDeleted: [],
    playlists: db.select({ playlist_id: playlist_tracks.playlist_id, track_id: playlist_tracks.track_id, position: playlist_tracks.position })
      .from(playlist_tracks).where(inArray(playlist_tracks.track_id, list)).all()
  }
}

export function merge_tracks(database: SqlDatabase, req: MergeRequest): MergeResult {
  const ids = [...new Set(req.ids)]
  if (ids.length < 2) throw new Error('a merge needs at least two tracks')
  if (!ids.includes(req.survivor)) throw new Error('the survivor must be one of the merged tracks')

  const absorbed = ids.filter((id) => id !== req.survivor)
  const absorbed_ph = placeholders(absorbed)
  const db = drizzle_of(database)
  const on_survivor = eq(tracks.id, req.survivor)

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
        db.update(tracks).set({ album_id: row?.album_id ?? null }).where(on_survivor).run()
        continue
      }

      if (f.field === 'comment') continue // handled with the extras below

      const col = COLUMN[f.field]
      if (!col) continue
      db.update(tracks).set({ [col]: value }).where(on_survivor).run()
    }

    // ── multi-value fields ───────────────────────────────────────────────────
    for (const f of preview.fields.filter((x) => x.multi)) {
      const fid = field(f.field).field_id!
      const res = req.resolutions?.[f.field]

      // Union is the default: keeping every genre is nearly always what was meant.
      let values: string[]
      if (res?.kind === 'value') values = (sets.get(res.from)?.get(f.field) ?? []).slice()
      else values = f.union ?? []

      db.delete(track_values).where(and(eq(track_values.track_id, req.survivor), eq(track_values.field_id, fid))).run()
      values.forEach((v, ordinal) => {
        db.insert(track_values).values({ track_id: req.survivor, field_id: fid, value_id: intern_value(database, fid, v), ordinal }).onConflictDoNothing().run()
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
    const media_moved = changes(db.update(media_table).set({ track_id: req.survivor }).where(inArray(media_table.track_id, absorbed)).run())

    // ── play history: union, deduplicated by the unique play constraint ──────
    const history_deleted = db
      .select({ track_id: play_history.track_id, at: play_history.at, kind: play_history.kind, position_ms: play_history.position_ms })
      .from(play_history)
      .where(and(
        inArray(play_history.track_id, absorbed),
        sql`EXISTS (SELECT 1 FROM ${play_history} p2 WHERE p2.track_id = ${req.survivor} AND p2.at = ${play_history.at} AND p2.kind = ${play_history.kind})`
      ))
      .all()

    // Raw because Drizzle has no UPDATE OR IGNORE, which skips the plays the survivor already has.
    const history_moved = run(database, `UPDATE OR IGNORE play_history SET track_id = ? WHERE track_id IN (${absorbed_ph})`, req.survivor, ...absorbed)

    // Anything left could not move because the survivor already had that exact event.
    db.delete(play_history).where(inArray(play_history.track_id, absorbed)).run()

    // ── playlists ────────────────────────────────────────────────────────────
    const playlist_entries_repointed = changes(db.update(playlist_tracks).set({ track_id: req.survivor }).where(inArray(playlist_tracks.track_id, absorbed)).run())

    // Repointing can put the survivor in one playlist twice; keep its earliest position.
    const earliest = db.select({ position: min(playlist_tracks.position) }).from(playlist_tracks)
      .where(eq(playlist_tracks.track_id, req.survivor)).groupBy(playlist_tracks.playlist_id)
    db.delete(playlist_tracks).where(and(eq(playlist_tracks.track_id, req.survivor), notInArray(playlist_tracks.position, earliest))).run()

    // ── statistics ───────────────────────────────────────────────────────────
    const stats = preview.statistics
    const added = Math.min(...before.tracks.map((t) => t.added))
    const last_skipped = before.tracks
      .map((t) => t.last_skipped).filter((v): v is number => v !== null)

    db.update(tracks).set({
      rating: stats.rating, play_count: stats.play_count, skip_count: stats.skip_count, first_played: stats.first_played,
      last_played: stats.last_played, last_skipped: last_skipped.length ? Math.max(...last_skipped) : null, added,
      pinned: 1, identity_source: 'manual', modified: now
    }).where(on_survivor).run()

    // ── remove the absorbed tracks ───────────────────────────────────────────
    db.delete(tracks).where(inArray(tracks.id, absorbed)).run()

    before.historyDeleted = history_deleted
    db.insert(merge_journal).values({ id: new_id(), batch_id, at: now, survivor_id: req.survivor, snapshot: JSON.stringify(before) }).run()

    return { batch_id, survivor: req.survivor, absorbed, media_moved, history_moved, playlist_entries_repointed }
  })
}

export interface UnmergeResult {
  batch_id: string
  restored: string[]
  survivor: string
}

const track_columns = [
  'title', 'album_id', 'year', 'track_number', 'disc_number', 'length_ms', 'compilation', 'bpm', 'rating', 'play_count',
  'skip_count', 'first_played', 'last_played', 'last_skipped', 'added', 'pinned', 'mb_recording_id'
] as const

// Puts the library back exactly as it was before a merge.
export function unmerge(database: SqlDatabase, batch_id: string): UnmergeResult {
  const db = drizzle_of(database)
  const entry = db.select({ survivor_id: merge_journal.survivor_id, snapshot: merge_journal.snapshot, undone: merge_journal.undone })
    .from(merge_journal).where(eq(merge_journal.batch_id, batch_id)).get()

  if (!entry) throw new Error(`no merge recorded under ${batch_id}`)
  if (entry.undone) throw new Error(`${batch_id} has already been undone`)

  const before = JSON.parse(entry.snapshot) as Snapshot
  const survivor = entry.survivor_id

  return in_transaction(database, () => {
    const now = Date.now()
    const restored: string[] = []
    const album_of = (id: string | null): string | null =>
      id !== null && db.select({ id: albums.id }).from(albums).where(eq(albums.id, id)).get() !== undefined ? id : null

    for (const t of before.tracks) {
      const state = Object.fromEntries(track_columns.map((column) => [column, column === 'album_id' ? album_of(t.album_id) : t[column]])) as Pick<TrackRow, (typeof track_columns)[number]>
      if (t.id === survivor) {
        const { mb_recording_id: _kept, ...edited } = state
        db.update(tracks).set({ ...edited, modified: now }).where(eq(tracks.id, t.id)).run()
      } else {
        // A track with this id that was added at another time is not the one this merge took, so the undo stops.
        const existing = db.select({ added: tracks.added }).from(tracks).where(eq(tracks.id, t.id)).get()
        if (existing && existing.added !== t.added) throw new Error(`undoing ${batch_id} would overwrite a track this merge did not take`)
        // Recreated with its own id, so media and history can point back; a history restore may have brought it back already.
        const updated = changes(db.update(tracks).set({ ...state, modified: now }).where(eq(tracks.id, t.id)).run())
        if (updated === 0) db.insert(tracks).values({ id: t.id, ...state, identity_source: 'heuristic', modified: now }).run()
        restored.push(t.id)
      }
    }

    const ids = before.tracks.map((t) => t.id)

    db.delete(track_values).where(inArray(track_values.track_id, ids)).run()
    db.delete(track_extras).where(inArray(track_extras.track_id, ids)).run()

    for (const r of before.sets) {
      db.insert(track_values).values({ track_id: r.track_id, field_id: r.field_id, value_id: intern_value(database, r.field_id, r.value), ordinal: r.ordinal }).onConflictDoNothing().run()
    }

    for (const r of before.extras) {
      db.insert(track_extras).values({ track_id: r.track_id, field_id: r.field_id, value: r.value }).onConflictDoNothing().run()
    }

    for (const m of before.media) db.update(media_table).set({ track_id: m.track_id }).where(eq(media_table.id, m.id)).run()

    // Raw because Drizzle has no UPDATE OR IGNORE, which leaves a play where the track already has one at that moment.
    for (const h of before.history) run(database, 'UPDATE OR IGNORE play_history SET track_id = ? WHERE id = ?', h.track_id, h.id)

    for (const h of before.historyDeleted) {
      db.insert(play_history).values({ id: new_id(), track_id: h.track_id, at: h.at, kind: h.kind, position_ms: h.position_ms ?? null }).onConflictDoNothing().run()
    }

    db.delete(playlist_tracks).where(inArray(playlist_tracks.track_id, ids)).run()
    for (const p of before.playlists) {
      db.insert(playlist_tracks).values({ playlist_id: p.playlist_id, track_id: p.track_id, position: p.position }).onConflictDoNothing().run()
    }

    db.update(merge_journal).set({ undone: 1 }).where(eq(merge_journal.batch_id, batch_id)).run()

    return { batch_id, restored, survivor }
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
  const rows = drizzle_of(database)
    .select({
      batch_id: merge_journal.batch_id, at: merge_journal.at, survivor_id: merge_journal.survivor_id, snapshot: merge_journal.snapshot,
      undone: merge_journal.undone, current_title: sql<string | null>`(SELECT ${tracks.title} FROM ${tracks} WHERE ${tracks.id} = ${merge_journal.survivor_id})`
    })
    .from(merge_journal).orderBy(desc(merge_journal.at), desc(merge_journal.id)).limit(limit).all()
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
