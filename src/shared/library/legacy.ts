// Brings a library made before ids every device can make onto the Drizzle schema, in one transaction that keeps every
// row: each old number gets a new id, every reference follows it, and the merge journal's snapshots are rewritten to
// match, so an earlier merge can still be undone.

// ── Imports ──────────────────────────────────────────────────────────────────

import { in_transaction, migrate, type SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { all_rows, first_row, new_id, run } from './database.ts'
import { legacy_steps } from './legacy_steps.ts'
import { migrations } from './migrations/index.ts'

// ── Detecting ────────────────────────────────────────────────────────────────

// How many of the Drizzle migrations the conversion stands in for; later ones run as usual.
export const converted_migrations = 2

// The legacy steps counted SQLite's user_version from 1; the conversion leaves it one past them.
const converted_version = legacy_steps.length + 1

function user_version(database: SqlDatabase): number {
  return (first_row<{ user_version: number }>(database, 'PRAGMA user_version') ?? { user_version: 0 }).user_version
}

export function is_legacy(database: SqlDatabase): boolean {
  const version = user_version(database)
  return version > 0 && version < converted_version
}

// ── Tables ───────────────────────────────────────────────────────────────────

// Every table of the old schema, each with its own numbered rows or not.
const numbered = ['values_', 'albums', 'tracks', 'media', 'play_history', 'tag_writes', 'playlists', 'roots', 'merge_journal', 'artwork'] as const
const unnumbered = ['media_tags', 'track_values', 'track_extras', 'playlist_tracks', 'settings'] as const
type Numbered = (typeof numbered)[number]

// A version 4 UUID made by SQLite itself, so a whole table's ids come from one statement.
const uuid_sql = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
  || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`

// The new id of an old row, or null when the old value was null or names nothing.
const mapped = (kind: Numbered, column: string) => `(SELECT legacy_ids.new FROM legacy_ids WHERE legacy_ids.kind = '${kind}' AND legacy_ids.old = ${column})`

// Each table's copy; a column naming a row it must have joins on its new id, so a broken reference shows as a lost row.
const copies: Record<Exclude<Numbered, 'merge_journal'> | (typeof unnumbered)[number], string> = {
  values_: `INSERT INTO values_ (id, field_id, value, sort_key, colour, mb_id)
    SELECT ${mapped('values_', 'source.id')}, field_id, value, sort_key, colour, mb_id FROM legacy_values_ source ORDER BY source.id`,
  albums: `INSERT INTO albums (id, match_key, pinned, name, edition, album_artist_id, year, disc_total, mb_release_id, mb_release_group_id, is_compilation, rg_album_gain, added)
    SELECT ${mapped('albums', 'source.id')}, match_key, pinned, name, edition, ${mapped('values_', 'source.album_artist_id')}, year, disc_total,
      mb_release_id, mb_release_group_id, is_compilation, rg_album_gain, added FROM legacy_albums source ORDER BY source.id`,
  tracks: `INSERT INTO tracks (id, title, album_id, year, track_number, disc_number, length_ms, compilation, bpm, mb_recording_id, acoustid,
      identity_source, identity_key, pinned, rating, play_count, skip_count, first_played, last_played, last_skipped, bookmark_ms, loved,
      rg_track_gain, rg_album_gain, added, modified, primary_media_id)
    SELECT ${mapped('tracks', 'source.id')}, title, ${mapped('albums', 'source.album_id')}, year, track_number, disc_number, length_ms, compilation, bpm,
      mb_recording_id, acoustid, identity_source, identity_key, pinned, rating, play_count, skip_count, first_played, last_played,
      last_skipped, bookmark_ms, loved, rg_track_gain, rg_album_gain, added, modified, ${mapped('media', 'source.primary_media_id')}
    FROM legacy_tracks source ORDER BY source.id`,
  media: `INSERT INTO media (id, track_id, kind, uri, provider, subtrack_index, start_ms, end_ms, audio_hash, audio_hash_algo, codec, container,
      bitrate, bitrate_mode, samplerate, channels, bits_per_sample, filesize, mtime, present, last_seen, quality_rank, added)
    SELECT ${mapped('media', 'source.id')}, track.new, source.kind, uri, provider, subtrack_index, start_ms, end_ms, audio_hash, audio_hash_algo, codec,
      container, bitrate, bitrate_mode, samplerate, channels, bits_per_sample, filesize, mtime, present, last_seen, quality_rank, added
    FROM legacy_media source JOIN legacy_ids track ON track.kind = 'tracks' AND track.old = source.track_id ORDER BY source.id`,
  media_tags: `INSERT INTO media_tags (media_id, field_id, ordinal, value)
    SELECT owner.new, field_id, ordinal, value FROM legacy_media_tags source
    JOIN legacy_ids owner ON owner.kind = 'media' AND owner.old = source.media_id`,
  track_values: `INSERT INTO track_values (track_id, field_id, value_id, ordinal)
    SELECT track.new, field_id, interned.new, ordinal FROM legacy_track_values source
    JOIN legacy_ids track ON track.kind = 'tracks' AND track.old = source.track_id
    JOIN legacy_ids interned ON interned.kind = 'values_' AND interned.old = source.value_id`,
  track_extras: `INSERT INTO track_extras (track_id, field_id, value)
    SELECT track.new, field_id, value FROM legacy_track_extras source
    JOIN legacy_ids track ON track.kind = 'tracks' AND track.old = source.track_id`,
  play_history: `INSERT INTO play_history (id, track_id, media_id, at, kind, position_ms)
    SELECT ${mapped('play_history', 'source.id')}, track.new, ${mapped('media', 'source.media_id')}, at, source.kind, position_ms FROM legacy_play_history source
    JOIN legacy_ids track ON track.kind = 'tracks' AND track.old = source.track_id ORDER BY source.id`,
  tag_writes: `INSERT INTO tag_writes (id, batch_id, media_id, field_id, old_value, new_value, at, applied)
    SELECT ${mapped('tag_writes', 'source.id')}, CAST(batch_id AS TEXT), owner.new, field_id, old_value, new_value, at, applied FROM legacy_tag_writes source
    JOIN legacy_ids owner ON owner.kind = 'media' AND owner.old = source.media_id ORDER BY source.id`,
  playlists: `INSERT INTO playlists (id, name, kind, definition, parent_id, position, created, modified)
    SELECT ${mapped('playlists', 'source.id')}, name, source.kind, definition, ${mapped('playlists', 'source.parent_id')}, position, created, modified
    FROM legacy_playlists source ORDER BY source.id`,
  playlist_tracks: `INSERT INTO playlist_tracks (playlist_id, track_id, position)
    SELECT list.new, track.new, position FROM legacy_playlist_tracks source
    JOIN legacy_ids list ON list.kind = 'playlists' AND list.old = source.playlist_id
    JOIN legacy_ids track ON track.kind = 'tracks' AND track.old = source.track_id`,
  roots: `INSERT INTO roots (id, path, include, exclude, slow, enabled, last_scan)
    SELECT ${mapped('roots', 'source.id')}, path, include, exclude, slow, enabled, last_scan FROM legacy_roots source ORDER BY source.id`,
  settings: 'INSERT INTO settings (key, value) SELECT key, value FROM legacy_settings',
  artwork: `INSERT INTO artwork (id, album_id, track_id, source, origin, hash, path, width, height, bytes, found_at)
    SELECT ${mapped('artwork', 'source.id')}, ${mapped('albums', 'source.album_id')}, ${mapped('tracks', 'source.track_id')}, source, origin, hash, path,
      width, height, bytes, found_at FROM legacy_artwork source ORDER BY source.id`
}

// ── References ───────────────────────────────────────────────────────────────

// What the conversion did that the owner may want to know about.
export interface UpgradeReport {
  // References to a row that was already gone, emptied as the old schema's ON DELETE SET NULL would have.
  nulled: { table: string; column: string; rows: number }[]
  // Numbers in a merge still to undo that a later row had taken, given ids of their own so the undo leaves that row alone.
  reused: { batch_id: string; kind: Numbered; old: number }[]
}

// The report in plain lines, one per column emptied and one per merge whose numbers were reused.
export function describe_upgrade(report: UpgradeReport): string[] {
  const batches = [...new Set(report.reused.map((each) => each.batch_id))]
  return [
    ...report.nulled.map(({ table, column, rows }) => `emptied ${table}.${column} in ${rows} ${rows === 1 ? 'row' : 'rows'}, which named a row that was gone`),
    ...batches.map((batch) => {
      const numbers = report.reused.filter((each) => each.batch_id === batch).map((each) => `${each.kind} ${each.old}`)
      return `merge ${batch} named ${numbers.join(', ')}, which later rows had taken; undoing it leaves those rows alone`
    })
  ]
}

interface Reference {
  table: string
  column: string
  target: Numbered
}

// Columns a row cannot do without; a row naming a missing one stops the conversion.
const required: Reference[] = [
  { table: 'media', column: 'track_id', target: 'tracks' },
  { table: 'media_tags', column: 'media_id', target: 'media' },
  { table: 'track_values', column: 'track_id', target: 'tracks' },
  { table: 'track_values', column: 'value_id', target: 'values_' },
  { table: 'track_extras', column: 'track_id', target: 'tracks' },
  { table: 'play_history', column: 'track_id', target: 'tracks' },
  { table: 'tag_writes', column: 'media_id', target: 'media' },
  { table: 'playlist_tracks', column: 'playlist_id', target: 'playlists' },
  { table: 'playlist_tracks', column: 'track_id', target: 'tracks' }
]

// Columns that may be empty; one naming a missing row becomes empty.
const optional: Reference[] = [
  { table: 'albums', column: 'album_artist_id', target: 'values_' },
  { table: 'tracks', column: 'album_id', target: 'albums' },
  { table: 'tracks', column: 'primary_media_id', target: 'media' },
  { table: 'play_history', column: 'media_id', target: 'media' },
  { table: 'playlists', column: 'parent_id', target: 'playlists' },
  { table: 'artwork', column: 'album_id', target: 'albums' },
  { table: 'artwork', column: 'track_id', target: 'tracks' }
]

const dangling = (database: SqlDatabase, { table, column, target }: Reference): number =>
  first_row<{ total: number }>(
    database,
    `SELECT COUNT(*) AS total FROM legacy_${table} source
     WHERE source.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM legacy_${target} named WHERE named.id = source.${column})`
  )!.total

const rows = (total: number): string => `${total} ${total === 1 ? 'row points' : 'rows point'}`

// Refuses a library with rows that name nothing, saying where, and counts the optional references that will be emptied.
function check_references(database: SqlDatabase): UpgradeReport['nulled'] {
  const broken = required
    .map((reference) => ({ reference, total: dangling(database, reference) }))
    .filter(({ total }) => total > 0)
    .map(({ reference, total }) => `${reference.table}.${reference.column}: ${rows(total)} at no ${reference.target} row`)
  if (broken.length > 0) throw new Error(`the library cannot be converted without losing rows; ${broken.join('; ')}`)
  return optional
    .map((reference) => ({ table: reference.table, column: reference.column, rows: dangling(database, reference) }))
    .filter((each) => each.rows > 0)
}

// ── The merge journal ────────────────────────────────────────────────────────

// A merge's snapshot as the old schema wrote it; every id in it is an old number.
interface OldSnapshot {
  tracks: (Record<string, unknown> & { id: number; album_id: number | null })[]
  sets: (Record<string, unknown> & { track_id: number })[]
  extras: (Record<string, unknown> & { track_id: number })[]
  media: { id: number; track_id: number }[]
  history: { id: number; track_id: number }[]
  historyDeleted?: (Record<string, unknown> & { track_id: number })[]
  playlists: (Record<string, unknown> & { playlist_id: number; track_id: number })[]
}

type IdOf = (kind: Numbered, old: number | null) => string | null

// The new ids by old number; a number the tables no longer hold, such as a track a merge absorbed, gets a fresh id of its own.
function id_maps(database: SqlDatabase): IdOf {
  const maps = new Map<Numbered, Map<number, string>>(numbered.map((kind) => [kind, new Map()]))
  for (const row of all_rows<{ kind: Numbered; old: number; new: string }>(database, 'SELECT kind, old, new FROM legacy_ids')) {
    maps.get(row.kind)!.set(row.old, row.new)
  }
  return (kind, old) => {
    if (old === null || old === undefined) return null
    const map = maps.get(kind)!
    let id = map.get(old)
    if (id === undefined) map.set(old, (id = new_id()))
    return id
  }
}

interface JournalEntry {
  id: number
  batch_id: string
  at: number
  survivor_id: number
  snapshot: string
  undone: number
}

// The numbers in a merge still to undo that now belong to a row made after it: an absorbed track's number on any live
// track, a file's on one added after the merge, a play's on one that is not the survivor's.
function reused_numbers(database: SqlDatabase, entry: JournalEntry, snapshot: OldSnapshot): Map<Numbered, Set<number>> {
  const reused = new Map<Numbered, Set<number>>([['tracks', new Set()], ['media', new Set()], ['play_history', new Set()]])
  if (entry.undone) return reused
  for (const { id } of snapshot.tracks) {
    if (id !== entry.survivor_id && first_row(database, 'SELECT 1 FROM legacy_tracks WHERE id = ?', id)) reused.get('tracks')!.add(id)
  }
  for (const { id } of snapshot.media) {
    const live = first_row<{ added: number }>(database, 'SELECT added FROM legacy_media WHERE id = ?', id)
    if (live && live.added > entry.at) reused.get('media')!.add(id)
  }
  for (const { id } of snapshot.history) {
    const live = first_row<{ track_id: number }>(database, 'SELECT track_id FROM legacy_play_history WHERE id = ?', id)
    if (live && live.track_id !== entry.survivor_id) reused.get('play_history')!.add(id)
  }
  return reused
}

// The usual mapping, except that a reused number gets an id of its own for this snapshot.
function snapshot_ids(id_of: IdOf, reused: Map<Numbered, Set<number>>): IdOf {
  const own = new Map<string, string>()
  return (kind, old) => {
    if (old === null || old === undefined || !reused.get(kind)?.has(old)) return id_of(kind, old)
    const key = `${kind}:${old}`
    let id = own.get(key)
    if (id === undefined) own.set(key, (id = new_id()))
    return id
  }
}

// The snapshot with new ids; an album that no longer exists becomes none, as an undo would have found it.
function rewrite_snapshot(snapshot: OldSnapshot, id_of: IdOf, album_exists: (id: string | null) => boolean): unknown {
  const track = (old: number) => id_of('tracks', old)
  return {
    tracks: snapshot.tracks.map((row) => {
      const album_id = id_of('albums', row.album_id)
      return { ...row, id: track(row.id), album_id: album_exists(album_id) ? album_id : null }
    }),
    sets: snapshot.sets.map((row) => ({ ...row, track_id: track(row.track_id) })),
    extras: snapshot.extras.map((row) => ({ ...row, track_id: track(row.track_id) })),
    media: snapshot.media.map((row) => ({ id: id_of('media', row.id), track_id: track(row.track_id) })),
    history: snapshot.history.map((row) => ({ id: id_of('play_history', row.id), track_id: track(row.track_id) })),
    historyDeleted: (snapshot.historyDeleted ?? []).map((row) => ({ ...row, track_id: track(row.track_id) })),
    playlists: snapshot.playlists.map((row) => ({ ...row, playlist_id: id_of('playlists', row.playlist_id), track_id: track(row.track_id) }))
  }
}

function copy_merge_journal(database: SqlDatabase): UpgradeReport['reused'] {
  const id_of = id_maps(database)
  const found: UpgradeReport['reused'] = []
  const album_exists = (id: string | null) => id !== null && first_row(database, 'SELECT 1 FROM albums WHERE id = ?', id) !== undefined
  const insert = database.prepare('INSERT INTO merge_journal (id, batch_id, at, survivor_id, snapshot, undone) VALUES (?, ?, ?, ?, ?, ?)')
  const entries = all_rows<JournalEntry>(
    database,
    'SELECT id, batch_id, at, survivor_id, snapshot, undone FROM legacy_merge_journal ORDER BY id'
  )
  for (const entry of entries) {
    const old = JSON.parse(entry.snapshot) as OldSnapshot
    const reused = reused_numbers(database, entry, old)
    for (const [kind, numbers] of reused) for (const number of numbers) found.push({ batch_id: entry.batch_id, kind, old: number })
    const snapshot = rewrite_snapshot(old, snapshot_ids(id_of, reused), album_exists)
    insert.run(id_of('merge_journal', entry.id)!, entry.batch_id, entry.at, id_of('tracks', entry.survivor_id)!, JSON.stringify(snapshot), entry.undone)
  }
  return found
}

// ── Converting ───────────────────────────────────────────────────────────────

const count = (database: SqlDatabase, table: string): number => first_row<{ total: number }>(database, `SELECT COUNT(*) AS total FROM ${table}`)!.total

function convert(database: SqlDatabase): UpgradeReport {
  const tables = [...numbered, ...unnumbered]

  // The old tables step aside under new names; their indexes go, since index names are shared across tables.
  for (const table of tables) database.exec(`ALTER TABLE ${table} RENAME TO legacy_${table}`)
  const indexes = all_rows<{ name: string }>(database, "SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name LIKE 'legacy\\_%' ESCAPE '\\'")
  for (const { name } of indexes) database.exec(`DROP INDEX ${name}`)
  // The old search table was never filled, so nothing is lost with it.
  database.exec('DROP TABLE IF EXISTS tracks_fts')
  const nulled = check_references(database)

  for (const statement of migrations.slice(0, converted_migrations).flatMap((migration) => migration.statements)) database.exec(statement)
  database.exec('CREATE TABLE IF NOT EXISTS schema_versions (owner TEXT PRIMARY KEY, version INTEGER NOT NULL)')
  run(database, 'INSERT INTO schema_versions (owner, version) VALUES (?, ?)', 'library', converted_migrations)

  database.exec('CREATE TEMP TABLE legacy_ids (kind TEXT NOT NULL, old INTEGER NOT NULL, new TEXT NOT NULL, PRIMARY KEY (kind, old))')
  for (const kind of numbered) database.exec(`INSERT INTO legacy_ids (kind, old, new) SELECT '${kind}', id, ${uuid_sql} FROM legacy_${kind} ORDER BY id`)

  let reused: UpgradeReport['reused'] = []
  for (const table of tables) {
    if (table === 'merge_journal') reused = copy_merge_journal(database)
    else database.exec(copies[table])
  }

  // Nothing is left behind: a row that could not follow its references stops the whole conversion.
  for (const table of tables) {
    const before = count(database, `legacy_${table}`)
    const after = count(database, table)
    if (before !== after) throw new Error(`converting the library would lose ${before - after} of ${before} rows in ${table}`)
  }

  for (const table of tables) database.exec(`DROP TABLE legacy_${table}`)
  database.exec('DROP TABLE legacy_ids')

  const broken = all_rows(database, 'PRAGMA foreign_key_check')
  if (broken.length > 0) throw new Error(`converting the library left ${broken.length} broken references`)

  database.exec(`PRAGMA user_version = ${converted_version}`)
  return { nulled, reused }
}

// Runs whatever old steps the library missed, then converts it; foreign keys must be off, as SQLite asks for a schema change.
export function upgrade_legacy(database: SqlDatabase): UpgradeReport {
  database.exec('PRAGMA foreign_keys = OFF')
  migrate(database, legacy_steps)
  return in_transaction(database, () => convert(database))
}
