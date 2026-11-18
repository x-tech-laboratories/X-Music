// The values of set fields such as genre, each kept once and joined to every track that carries it.

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, drizzle_of, eq } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { new_id } from './database.ts'
import { track_extras, track_values, values_ } from './schema.ts'

// ── Values ───────────────────────────────────────────────────────────────────

// The id of a field's value, added when it is new.
export function intern_value(database: SqlDatabase, field_id: number, value: string): string {
  const db = drizzle_of(database)
  db.insert(values_).values({ id: new_id(), field_id, value }).onConflictDoNothing().run()
  return db
    .select({ id: values_.id })
    .from(values_)
    .where(and(eq(values_.field_id, field_id), eq(values_.value, value)))
    .get()!.id
}

// Sets a track's extra field. An update then an insert, since the track history's triggers cannot run inside an upsert.
export function set_extra(database: SqlDatabase, track_id: string, field_id: number, value: string | null): void {
  const db = drizzle_of(database)
  const where = and(eq(track_extras.track_id, track_id), eq(track_extras.field_id, field_id))
  if (db.select({ value: track_extras.value }).from(track_extras).where(where).get()) db.update(track_extras).set({ value }).where(where).run()
  else db.insert(track_extras).values({ track_id, field_id, value }).run()
}

// Replaces a track's values of one field, in order, skipping blanks, rather than adding to them.
export function write_set(database: SqlDatabase, track_id: string, field_id: number, values: readonly string[], intern = intern_value): void {
  const db = drizzle_of(database)
  db.delete(track_values).where(and(eq(track_values.track_id, track_id), eq(track_values.field_id, field_id))).run()
  values.forEach((value, ordinal) => {
    if (value.trim() === '') return
    db.insert(track_values).values({ track_id, field_id, value_id: intern(database, field_id, value), ordinal }).onConflictDoNothing().run()
  })
}
