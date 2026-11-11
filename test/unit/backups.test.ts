// The library database is what years of ratings, play counts and merges live in, so its backups
// are checked end to end: taken beside it, kept inside X-Music's own data, and restored on restart.

import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { take_staged_restore } from '@x-tech-laboratories/x-libs/server/sqlite_backups'

import { libraryBackups } from '@main/backups'
import { ReadOnlyError, initSafety, setReadOnly } from '@main/safety'

let folder: string
let path: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'x-music-backups-'))
  path = join(folder, 'library.db')
  initSafety([folder])
  setReadOnly(true)
})

function library(): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec("CREATE TABLE IF NOT EXISTS tracks (title TEXT); INSERT INTO tracks VALUES ('Blue in Green')")
  return db
}

describe('library backups', () => {
  it('takes a backup into backups beside the database, even in read-only mode', async () => {
    const db = library()
    const backups = libraryBackups(db as never, path, () => {})

    const backup = await backups.methods.create_backup()
    backups.stop()

    expect(backup.name).toMatch(/^library-.*Z\.db$/)
    expect(existsSync(join(folder, 'backups', backup.name))).toBe(true)
    db.close()
  })

  it('stages a restore, restarts, and puts the backup in place before the library opens again', async () => {
    let db = library()
    let restarts = 0
    const backups = libraryBackups(db as never, path, () => restarts++)
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

  it('refuses to write backups outside X-Music\'s own data in read-only mode', async () => {
    initSafety([join(folder, 'elsewhere')])
    const db = library()
    const backups = libraryBackups(db as never, path, () => {})

    await expect(backups.methods.create_backup()).rejects.toThrow(ReadOnlyError)
    backups.stop()
    db.close()
  })
})
