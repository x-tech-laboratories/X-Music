// The store's own calls: music folders, the counts the status bar shows, and clearing the library, which is backed up
// first and does not happen at all when the backup fails.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { posix } from 'node:path'
import fc from 'fast-check'

import { clearLibraryBackedUp } from '@main/backups'
import { folder_of } from '@shared/library/albums'
import { join_path } from '@shared/import/gmb_import'
import { record_history } from '@shared/library/history'
import { createUpserter } from '@shared/library/identity'
import {
  add_root, enabled_root_paths, library_stats, list_roots, mark_roots_scanned, remove_root
} from '@shared/library/store'
import { freshDb, type TestDb } from './sqlite.ts'

let db: TestDb

beforeEach(() => { db = freshDb() })
afterEach(() => db.close())

const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

function fill(): void {
  const upsert = createUpserter(db)
  upsert({ title: 'So What', lengthMs: 1000, sets: { artist: ['Miles Davis'], genre: ['Jazz'] } }, { uri: '/music/a.flac' }, { metadata: true })
  upsert({ title: 'Blue in Green', album: 'Kind of Blue', artist: 'Miles Davis', lengthMs: 2000 }, { uri: '/music/b.flac', present: false }, { metadata: true })
  record_history(db)
}

describe('music folders', () => {
  it('adds a folder once, lists folders by path and forgets a removed one', () => {
    const music = add_root(db, '/music')
    expect(add_root(db, '/music').id).toBe(music.id)
    const archive = add_root(db, '/archive')

    expect(list_roots(db).map((root) => root.path)).toEqual(['/archive', '/music'])
    expect(music).toMatchObject({ path: '/music', enabled: true, slow: false, lastScan: null })

    remove_root(db, archive.id)
    mark_roots_scanned(db, 1234)

    expect(enabled_root_paths(db)).toEqual(['/music'])
    expect(list_roots(db)[0]!.lastScan).toBe(1234)
  })
})

describe('library counts', () => {
  it('counts tracks, files, albums, missing files and total length', () => {
    fill()

    expect(library_stats(db, '/tmp/library.db')).toEqual({
      tracks: 2, media: 2, albums: 1, missing: 1, totalMs: 3000, schemaVersion: 2, path: '/tmp/library.db'
    })
  })
})

describe('clearing the library', () => {
  it('backs up first, then empties the tracks and their history but keeps folders and settings', async () => {
    fill()
    add_root(db, '/music')
    db.prepare("INSERT INTO settings (key, value) VALUES ('ui.density', '\"compact\"')").run()
    const order: string[] = []
    const backups = { create: async () => { order.push(`backup with ${count('tracks')} tracks`); return { name: 'b', automatic: false, size: 0, created: '' } as never } }

    await clearLibraryBackedUp(db, backups)

    expect(order).toEqual(['backup with 2 tracks'])
    for (const table of ['tracks', 'media', 'albums', 'values_', 'track_values', 'play_history', 'merge_journal', 'track_versions']) {
      expect(count(table), table).toBe(0)
    }
    expect(count('roots')).toBe(1)
    expect(count('settings')).toBe(1)
  })

  it('leaves the library as it is when the backup fails', async () => {
    fill()
    const backups = { create: async () => { throw new Error('disk full') } }

    await expect(clearLibraryBackedUp(db, backups)).rejects.toThrow('disk full')

    expect(count('tracks')).toBe(2)
  })
})

describe('paths without Node', () => {
  const segment = fc.constantFrom('music', 'a b', '.', '..', '', 'Disc 1', 'x.flac')
  const path = fc.tuple(fc.boolean(), fc.array(segment, { maxLength: 6 }), fc.boolean())
    .map(([absolute, parts, trailing]) => `${absolute ? '/' : ''}${parts.join('/')}${trailing ? '/' : ''}`)

  it('finds a file\'s folder as Node\'s POSIX dirname does', () => {
    fc.assert(fc.property(path, (each) => { expect(folder_of(each)).toBe(posix.dirname(each)) }))
  })

  it('joins a folder and file name as Node\'s POSIX join does', () => {
    fc.assert(fc.property(path, path, (folder, file) => { expect(join_path(folder, file)).toBe(posix.join(folder, file)) }))
  })
})
