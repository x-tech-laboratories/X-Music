// The library's tables, from which drizzle-kit writes the migrations and the store reads its row types. A track is a
// piece of music, not a file: anything that can render it is a media row hanging off it (DESIGN-SPEC §3).

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sql,
  sqliteTable,
  text,
  uniqueIndex,
  type SQLiteTable
} from '@x-tech-laboratories/x-libs/drizzle'

// A column another table's key points at, named so tracks and media, which point at each other, can be typed.
type ReferencedColumn = SQLiteTable['_']['columns'][string]

// SQLite lets a text primary key hold null, which drizzle-kit does not rule out, so each keyed table checks it.
const has_key = (table: string, key: ReferencedColumn) => check(`${table}_has_key`, sql`${key} IS NOT NULL`)

// ── Tracks and their files ───────────────────────────────────────────────────

export const tracks = sqliteTable(
  'tracks',
  {
    id: text().primaryKey(),
    title: text(),
    album_id: text().references(() => albums.id, { onDelete: 'set null' }),
    year: integer(),
    track_number: integer(),
    disc_number: integer(),
    length_ms: integer(),
    compilation: integer().notNull().default(0),
    bpm: integer(),
    // Identity hints in falling order of trust; none of them is the key.
    mb_recording_id: text(),
    acoustid: text(),
    identity_source: text().notNull().default('heuristic'),
    identity_key: text(),
    // A person merged or arranged this track, so automated passes leave it alone.
    pinned: integer().notNull().default(0),
    // 0 to 100; null is unrated, which is not 0.
    rating: integer(),
    play_count: integer().notNull().default(0),
    skip_count: integer().notNull().default(0),
    first_played: integer(),
    last_played: integer(),
    last_skipped: integer(),
    bookmark_ms: integer(),
    loved: integer().notNull().default(0),
    rg_track_gain: real(),
    rg_album_gain: real(),
    added: integer().notNull(),
    modified: integer().notNull(),
    primary_media_id: text().references((): ReferencedColumn => media.id, { onDelete: 'set null' })
  },
  (table) => [
    has_key('tracks', table.id),
    index('tracks_album').on(table.album_id),
    index('tracks_identity').on(table.identity_key),
    index('tracks_mbid').on(table.mb_recording_id).where(sql`${table.mb_recording_id} IS NOT NULL`),
    index('tracks_acoustid').on(table.acoustid).where(sql`${table.acoustid} IS NOT NULL`),
    index('tracks_rating').on(table.rating),
    index('tracks_last_played').on(table.last_played),
    index('tracks_added').on(table.added)
  ]
)

export const media = sqliteTable(
  'media',
  {
    id: text().primaryKey(),
    track_id: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    // 'file' or 'stream'; a path for a file, a provider's URI for a stream.
    kind: text().notNull(),
    uri: text().notNull(),
    provider: text(),
    // A CUE range or chapter addresses part of a container; whole files leave these empty.
    subtrack_index: integer().notNull().default(0),
    start_ms: integer(),
    end_ms: integer(),
    // The file's identity, taken over the audio alone so retagging never changes it.
    audio_hash: blob({ mode: 'buffer' }).$type<Uint8Array>(),
    audio_hash_algo: text(),
    codec: text(),
    container: text(),
    bitrate: integer(),
    bitrate_mode: text(),
    samplerate: integer(),
    channels: integer(),
    bits_per_sample: integer(),
    filesize: integer(),
    mtime: integer(),
    // 0 when the file is known but cannot be reached now.
    present: integer().notNull().default(1),
    last_seen: integer(),
    quality_rank: integer().notNull().default(0),
    added: integer().notNull()
  },
  (table) => [
    has_key('media', table.id),
    uniqueIndex('media_uri_subtrack').on(table.uri, table.subtrack_index),
    index('media_track').on(table.track_id),
    index('media_hash').on(table.audio_hash).where(sql`${table.audio_hash} IS NOT NULL`),
    index('media_present').on(table.present, table.kind),
    index('media_uri').on(table.uri)
  ]
)

// Tags exactly as read from each file, so two files of one track can disagree without losing either.
export const media_tags = sqliteTable(
  'media_tags',
  {
    media_id: text()
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    field_id: integer().notNull(),
    ordinal: integer().notNull().default(0),
    value: text()
  },
  (table) => [primaryKey({ columns: [table.media_id, table.field_id, table.ordinal] })]
)

// ── Albums ───────────────────────────────────────────────────────────────────

export const albums = sqliteTable(
  'albums',
  {
    id: text().primaryKey(),
    // Derived from tags and recomputed; the id is what lasts.
    match_key: text().notNull().unique(),
    pinned: integer().notNull().default(0),
    name: text(),
    edition: text(),
    album_artist_id: text().references(() => values_.id, { onDelete: 'set null' }),
    year: integer(),
    disc_total: integer(),
    mb_release_id: text(),
    mb_release_group_id: text(),
    is_compilation: integer().notNull().default(0),
    rg_album_gain: real(),
    added: integer().notNull()
  },
  (table) => [
    has_key('albums', table.id),
    index('albums_artist').on(table.album_artist_id),
    index('albums_mbid').on(table.mb_release_id).where(sql`${table.mb_release_id} IS NOT NULL`)
  ]
)

// ── Fields with several values ───────────────────────────────────────────────

// Every value of a set field, such as a genre, kept once and joined to the tracks that carry it.
export const values_ = sqliteTable(
  'values_',
  {
    id: text().primaryKey(),
    field_id: integer().notNull(),
    value: text().notNull(),
    sort_key: text(),
    colour: text(),
    mb_id: text()
  },
  (table) => [
    has_key('values_', table.id),
    uniqueIndex('values_field_value').on(table.field_id, table.value)
  ]
)

export const track_values = sqliteTable(
  'track_values',
  {
    track_id: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    field_id: integer().notNull(),
    value_id: text()
      .notNull()
      .references(() => values_.id, { onDelete: 'cascade' }),
    ordinal: integer().notNull().default(0)
  },
  (table) => [
    primaryKey({ columns: [table.track_id, table.field_id, table.ordinal] }),
    index('track_values_lookup').on(table.field_id, table.value_id, table.track_id)
  ]
)

// Long and user-defined fields, so a new field never means altering the tracks table.
export const track_extras = sqliteTable(
  'track_extras',
  {
    track_id: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    field_id: integer().notNull(),
    value: text()
  },
  (table) => [primaryKey({ columns: [table.track_id, table.field_id] })]
)

// ── Plays and tag writes ─────────────────────────────────────────────────────

export const play_history = sqliteTable(
  'play_history',
  {
    id: text().primaryKey(),
    track_id: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    media_id: text().references(() => media.id, { onDelete: 'set null' }),
    at: integer().notNull(),
    // 0 for a play, 1 for a skip.
    kind: integer().notNull(),
    position_ms: integer()
  },
  (table) => [
    has_key('play_history', table.id),
    index('play_history_track').on(table.track_id, table.at),
    index('play_history_at').on(table.at),
    uniqueIndex('play_history_unique').on(table.track_id, table.at, table.kind)
  ]
)

// Every tag write with the value before it, so a mass edit can be undone.
export const tag_writes = sqliteTable(
  'tag_writes',
  {
    id: text().primaryKey(),
    batch_id: text().notNull(),
    media_id: text()
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    field_id: integer().notNull(),
    old_value: text(),
    new_value: text(),
    at: integer().notNull(),
    applied: integer().notNull().default(0)
  },
  (table) => [
    has_key('tag_writes', table.id),
    index('tag_writes_batch').on(table.batch_id)
  ]
)

// ── Playlists ────────────────────────────────────────────────────────────────

export const playlists = sqliteTable('playlists', {
  id: text().primaryKey(),
  name: text().notNull(),
  // 'static' or 'smart'; a smart playlist keeps its filter as JSON.
  kind: text().notNull(),
  definition: text(),
  parent_id: text().references((): ReferencedColumn => playlists.id, { onDelete: 'cascade' }),
  position: integer().notNull().default(0),
  created: integer().notNull(),
  modified: integer().notNull()
}, (table) => [has_key('playlists', table.id)])

export const playlist_tracks = sqliteTable(
  'playlist_tracks',
  {
    playlist_id: text()
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    track_id: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    position: integer().notNull()
  },
  (table) => [primaryKey({ columns: [table.playlist_id, table.position] })]
)

// ── Folders and settings ─────────────────────────────────────────────────────

export const roots = sqliteTable('roots', {
  id: text().primaryKey(),
  path: text().notNull().unique(),
  // Newline-separated globs.
  include: text(),
  exclude: text(),
  // A network mount: no hashing and no watching.
  slow: integer().notNull().default(0),
  enabled: integer().notNull().default(1),
  last_scan: integer()
}, (table) => [has_key('roots', table.id)])

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  value: text().notNull()
}, (table) => [has_key('settings', table.key)])

// ── Merges and artwork ───────────────────────────────────────────────────────

// Each merge with every participating track as it was before, so the merge can be undone exactly.
export const merge_journal = sqliteTable(
  'merge_journal',
  {
    id: text().primaryKey(),
    batch_id: text().notNull(),
    at: integer().notNull(),
    survivor_id: text().notNull(),
    snapshot: text().notNull(),
    undone: integer().notNull().default(0)
  },
  (table) => [
    has_key('merge_journal', table.id),
    index('merge_journal_batch').on(table.batch_id),
    index('merge_journal_at').on(table.at)
  ]
)

// Cover art found for an album, or for a track without one; a row with source 'none' remembers a miss.
export const artwork = sqliteTable(
  'artwork',
  {
    id: text().primaryKey(),
    album_id: text().references(() => albums.id, { onDelete: 'cascade' }),
    track_id: text().references(() => tracks.id, { onDelete: 'cascade' }),
    source: text().notNull(),
    origin: text(),
    hash: text(),
    path: text(),
    width: integer(),
    height: integer(),
    bytes: integer(),
    found_at: integer().notNull()
  },
  (table) => [
    has_key('artwork', table.id),
    uniqueIndex('artwork_album').on(table.album_id).where(sql`${table.album_id} IS NOT NULL`),
    uniqueIndex('artwork_track').on(table.track_id).where(sql`${table.track_id} IS NOT NULL`),
    index('artwork_hash').on(table.hash)
  ]
)

// Parents first.
export const library_tables: SQLiteTable[] = [
  values_,
  albums,
  tracks,
  media,
  media_tags,
  track_values,
  track_extras,
  play_history,
  tag_writes,
  playlists,
  playlist_tracks,
  roots,
  settings,
  merge_journal,
  artwork
]
