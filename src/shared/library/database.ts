// What every part of the library store shares: new ids, typed queries on a connection, and the few SQL helpers the
// store's raw queries need.

// ── Imports ──────────────────────────────────────────────────────────────────

import { open_drizzle, sql, type Drizzle } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase, SqlValue } from '@x-tech-laboratories/x-libs/sql'

import { albums, tracks } from './schema.ts'

// ── Ids ──────────────────────────────────────────────────────────────────────

// A new id that every device can make on its own without clashing.
export function new_id(): string {
  return crypto.randomUUID()
}

// ── Queries ──────────────────────────────────────────────────────────────────

const drizzles = new WeakMap<SqlDatabase, Drizzle>()

// Typed queries on the connection given, made once per connection.
export function drizzle_of(database: SqlDatabase): Drizzle {
  let drizzle = drizzles.get(database)
  if (!drizzle) drizzles.set(database, (drizzle = open_drizzle(database)))
  return drizzle
}

// The name of a track's album, as a column beside the track's own.
export const album_name = sql<string | null>`(SELECT ${albums.name} FROM ${albums} WHERE ${albums.id} = ${tracks.album_id})`

// How many rows a write changed.
export const changes = (result: { changes: number | bigint }): number => Number(result.changes)

// One question mark per value, for an IN list.
export function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

// Rows of a raw query, typed by the caller.
export function all_rows<Row>(database: SqlDatabase, query: string, ...params: SqlValue[]): Row[] {
  return database.prepare(query).all(...params) as Row[]
}

// The first row of a raw query, or undefined.
export function first_row<Row>(database: SqlDatabase, query: string, ...params: SqlValue[]): Row | undefined {
  return database.prepare(query).get(...params) as Row | undefined
}

// The changes a raw write made.
export function run(database: SqlDatabase, query: string, ...params: SqlValue[]): number {
  return Number(database.prepare(query).run(...params).changes)
}

// Bytes as lowercase hex, without Node's Buffer.
export function to_hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
