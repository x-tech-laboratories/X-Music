// The library database on disk, opened through Node's own SQLite; the store in src/shared/library does the rest.

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'

import { regexp_matches } from '@shared/query/compile'

export function library_path(): string {
  return process.env.X_MUSIC_DB ?? join(app.getPath('userData'), 'library.db')
}

// Opens the file with the settings a large library wants and the REGEXP that filters compile to, which SQLite leaves to the host.
export function open_database(path = library_path()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  database.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;
                 PRAGMA mmap_size = 268435456; PRAGMA cache_size = -65536`)
  database.function('REGEXP', { deterministic: true }, regexp_matches)
  return database
}
