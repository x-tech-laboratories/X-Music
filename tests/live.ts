// Copying the live library for a read-only test.
// The database runs in WAL mode, so recent changes — including a migration applied at the last
// launch — live in the -wal file rather than the main one. Copying only library.db silently yields
// an older schema, which looks like a missing table rather than a missing file.

import { copyFileSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { open_library } from '@shared/library/store'
import { bare_db, type TestDb } from './sqlite.ts'

export const live_path = (): string => join(homedir(), '.config/x-music/library.db')

export const has_live_library = (): boolean => existsSync(live_path())

// Copies the database and its write-ahead log, and returns the copy's path.
export function copy_live_library(name: string): string {
  const source = live_path()
  const target = join(tmpdir(), name)

  copyFileSync(source, target)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(source + suffix)) copyFileSync(source + suffix, target + suffix)
  }

  return target
}

// Opens a copy as the app would, upgrading it to the current schema if it is older, so the live database is never touched.
export function open_live_copy(name: string): TestDb {
  const db = bare_db(copy_live_library(name))
  open_library(db)
  return db
}
