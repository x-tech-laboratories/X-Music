// X-Music's tracks as an X-Libs filter catalogue: each field descriptor becomes a column of the tracks table, an SQL
// expression, a property of the track's files, or a set of values, beside the full-text and playlist operators X-Music
// adds. Filters, sorts and pane groups compile to SQL through X-Libs' filter_sql against this catalogue.

// ── Imports ──────────────────────────────────────────────────────────────────

import { define_catalogue, type FilterField } from '@x-tech-laboratories/x-libs/filter'

import { BUILTIN_FIELDS, type FieldDescriptor } from '../fields.ts'

// ── Fields ───────────────────────────────────────────────────────────────────

// The SQL of each computed field, from the track row `row` names.
const expressions: Readonly<Record<string, (row: string) => string>> = {
  album: (row) => `SELECT album.name FROM albums album WHERE album.id = ${row}.album_id`
}

function filter_field(descriptor: FieldDescriptor): FilterField {
  switch (descriptor.storage) {
    case 'column':
      return { kind: 'column', column: descriptor.column ?? descriptor.id }
    case 'computed': {
      const sql = expressions[descriptor.id]
      if (!sql) throw new Error(`computed field ${descriptor.id} has no SQL`)
      return { kind: 'expression', sql }
    }
    case 'extra':
      return {
        kind: 'expression',
        sql: (row) => `SELECT extra.value FROM track_extras extra WHERE extra.track_id = ${row}.id AND extra.field_id = ${descriptor.field_id}`
      }
    // A track matches when any of its files does, and sorts and groups by its best file.
    case 'media':
      return {
        kind: 'related',
        table: 'media',
        foreign_key: 'track_id',
        column: descriptor.column ?? descriptor.id,
        prefer: [{ column: 'quality_rank', descending: true }, { column: 'id' }]
      }
    case 'multi':
      return {
        kind: 'set',
        table: 'track_values',
        row_column: 'track_id',
        value_column: 'value_id',
        where: { field_id: descriptor.field_id! },
        values: { table: 'values_', id_column: 'id', value_column: 'value', where: { field_id: descriptor.field_id! }, sort_column: 'sort_key' },
        order_column: 'ordinal'
      }
  }
}

// ── The catalogue ────────────────────────────────────────────────────────────

export const track_catalogue = define_catalogue({
  table: 'tracks',
  fields: Object.fromEntries(BUILTIN_FIELDS.map((descriptor) => [descriptor.id, filter_field(descriptor)])),
  operators: {
    // Full-text search over the search index, in SQLite's FTS5 query language.
    matches: {
      sql: (node, context) => `${context.row_id} IN (SELECT track_id FROM track_search WHERE row IN (SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ${context.param(node.value)}))`
    },
    // The tracks of a playlist, by its id.
    in_playlist: {
      sql: (node, context) => `EXISTS (SELECT 1 FROM playlist_tracks entry WHERE entry.track_id = ${context.row_id} AND entry.playlist_id = ${context.param(node.value)})`
    }
  }
})

// The sum each pane group carries beside its count.
export const group_sums = { total_ms: 'length' } as const
