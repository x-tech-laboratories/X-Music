// Tests reach SQLite through node:sqlite, as the app does, and open the library through the same store code.

import { DatabaseSync } from 'node:sqlite'

import { field } from '@shared/fields'
import { new_id } from '@shared/library/database'
import { open_library } from '@shared/library/store'
import { regexp_matches } from '@shared/query/compile'
import type { Corpus } from './corpus'

export type TestDb = InstanceType<typeof DatabaseSync>

// A connection as the main process makes one, without opening the library.
export function bareDb(path = ':memory:'): TestDb {
  const db = new DatabaseSync(path)
  db.function('REGEXP', { deterministic: true }, regexp_matches)
  return db
}

// An empty library at the current schema, with its history installed.
export function freshDb(): TestDb {
  const db = bareDb()
  open_library(db)
  return db
}

/** Loads a corpus into a real database so the SQL path can be compared to the native path. */
export function loadCorpus(db: TestDb, corpus: Corpus): void {
  const insertTrack = db.prepare(`
    INSERT INTO tracks (id, title, album_id, year, track_number, disc_number, length_ms,
                        rating, play_count, skip_count, last_played, added, bpm,
                        compilation, modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertAlbum = db.prepare('INSERT OR IGNORE INTO albums (id, match_key, name, added) VALUES (?, ?, ?, 0)')
  const albumId = db.prepare('SELECT id FROM albums WHERE match_key = ?')
  const insertMedia = db.prepare(`
    INSERT INTO media (id, track_id, kind, uri, codec, bitrate, samplerate, channels,
                       filesize, mtime, quality_rank, added)
    VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
  const insertValue = db.prepare('INSERT OR IGNORE INTO values_ (id, field_id, value) VALUES (?, ?, ?)')
  const valueId = db.prepare('SELECT id FROM values_ WHERE field_id = ? AND value = ?')
  const insertTv = db.prepare(
    'INSERT INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, ?)')
  const insertExtra = db.prepare(
    'INSERT INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?)')

  db.exec('BEGIN')
  for (const t of corpus.tracks) {
    const s = t.scalars

    let album: string | null = null
    if (t.albumName !== null) {
      insertAlbum.run(new_id(), t.albumName, t.albumName)
      album = (albumId.get(t.albumName) as { id: string }).id
    }

    insertTrack.run(
      t.id, s.title ?? null, album, s.year ?? null, s.track_number ?? null, s.disc_number ?? null, s.length ?? null,
      s.rating ?? null, s.play_count ?? 0, s.skip_count ?? 0, s.last_played ?? null, s.added ?? 0, s.bpm ?? null,
      s.compilation ?? 0, corpus.now
    )

    for (const m of t.media) {
      insertMedia.run(new_id(), t.id, m.uri ?? '', m.codec ?? null, m.bitrate ?? null, m.samplerate ?? null, m.channels ?? null,
                      m.filesize ?? null, m.mtime ?? null, m.quality_rank ?? 0)
    }

    for (const [fid, values] of Object.entries(t.sets)) {
      values.forEach((v, ordinal) => {
        insertValue.run(new_id(), Number(fid), v)
        const row = valueId.get(Number(fid), v) as { id: string }
        insertTv.run(t.id, Number(fid), row.id, ordinal)
      })
    }

    for (const [fid, v] of Object.entries(t.extras)) {
      if (v !== null) insertExtra.run(t.id, Number(fid), v)
    }
  }
  db.exec('COMMIT')
}

export function runQuery(db: TestDb, sql: string, params: readonly (string | number | null)[]): string[] {
  const rows = db.prepare(sql).all(...params) as { id: string }[]
  return rows.map((r) => r.id)
}

// Inserts a track with only the columns a test cares about, and gives back its new id.
export function addTrack(db: TestDb, columns: Record<string, string | number | null> = {}): string {
  const id = new_id()
  const all = { added: 0, modified: 0, ...columns }
  const names = Object.keys(all)
  db.prepare(`INSERT INTO tracks (id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`)
    .run(id, ...Object.values(all))
  return id
}

/** Column widths and field ids must stay stable; a reused field id silently corrupts a library. */
export const setFieldId = (id: string): number => field(id).fieldId!
