// The library database is what years of ratings, play counts and merges live in, so its backups
// are checked end to end: taken beside it, before a schema upgrade, and restored on restart.

import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { take_staged_restore } from '@x-tech-laboratories/x-libs/server/sqlite_backups'

import { libraryBackups, openLibraryBackedUp } from '@main/backups'
import { legacyLibrary } from '../helpers/legacy'
import { bareDb } from '../helpers/sqlite'

let folder: string
let path: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'x-music-backups-'))
  path = join(folder, 'library.db')
})

function library(): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec("CREATE TABLE IF NOT EXISTS tracks (title TEXT); INSERT INTO tracks VALUES ('Blue in Green')")
  return db
}

describe('library backups', () => {
  it('takes a backup into backups beside the database', async () => {
    const db = library()
    const backups = libraryBackups(() => db, path, () => {})

    const backup = await backups.methods.create_backup()
    backups.stop()

    expect(backup.name).toMatch(/^library-.*Z\.db$/)
    expect(existsSync(join(folder, 'backups', backup.name))).toBe(true)
    db.close()
  })

  it('stages a restore, restarts, and puts the backup in place before the library opens again', async () => {
    let db = library()
    let restarts = 0
    const backups = libraryBackups(() => db, path, () => restarts++)
    const backup = await backups.methods.create_backup()
    db.exec("UPDATE tracks SET title = 'So What'")

    await backups.methods.restore_backup(backup.name)
    backups.stop()
    expect(restarts).toBe(1)

    db.close()
    expect(take_staged_restore(path)).toBe(true)
    db = new DatabaseSync(path)
    expect(db.prepare('SELECT title FROM tracks').get()).toEqual({ title: 'Blue in Green' })
    db.close()
  })
})

describe('opening the library', () => {
  it('backs up an old library before upgrading it, and the backup keeps the old schema', async () => {
    legacyLibrary(path).close()
    const db = bareDb(path)
    const backups = libraryBackups(() => db, path, () => {})

    const backup = await openLibraryBackedUp(db, backups)

    expect(backup).not.toBeNull()
    const kept = new DatabaseSync(join(folder, 'backups', backup!.name), { readOnly: true })
    expect(kept.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 })
    expect(kept.prepare("SELECT id, play_count FROM tracks WHERE title = 'So What'").get()).toEqual({ id: 1, play_count: 42 })
    kept.close()
    expect(db.prepare("SELECT typeof(id) AS type, play_count FROM tracks WHERE title = 'So What'").get())
      .toEqual({ type: 'text', play_count: 42 })
    db.close()
  })

  it('takes no backup of a library that is already current or new', async () => {
    const db = bareDb(path)
    const backups = libraryBackups(() => db, path, () => {})

    expect(await openLibraryBackedUp(db, backups)).toBeNull()
    expect(await openLibraryBackedUp(db, backups)).toBeNull()
    expect(existsSync(join(folder, 'backups')) ? readdirSync(join(folder, 'backups')) : []).toEqual([])
    db.close()
  })
})
