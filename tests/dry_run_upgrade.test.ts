// The dry run upgrades a copy of a library and reports on it, so the owner can try the upgrade before X-Music ever
// opens the real file; the file it is given must come out exactly as it went in.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { legacy_library } from './legacy.ts'

const script = join(process.cwd(), 'scripts/dry_run_upgrade.ts')
const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('upgrade dry run', () => {
  it('upgrades a copy, reports on it and leaves the library it was given untouched', () => {
    const folder = mkdtempSync(join(tmpdir(), 'x-music-dry-run-'))
    const library = join(folder, 'library.db')
    const db = legacy_library(library)
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec(`UPDATE tracks SET album_id = 99 WHERE id = 2;
             INSERT INTO tracks (id, title, added, modified) VALUES (9, 'Unrelated new song', 20000, 20000);`)
    db.close()
    const before = digest(library)

    const output = execFileSync(process.execPath, [script, library, '--out', join(folder, 'copy')], { encoding: 'utf8' })

    expect(digest(library)).toBe(before)
    expect(existsSync(`${library}-wal`)).toBe(false)
    expect(output).toMatch(/^Upgraded a copy at .*copy\/library\.db in \d+ ms$/m)
    expect(output).toMatch(/^File size: [\d.]+ \w*B before, [\d.]+ \w*B after$/m)
    expect(output).toMatch(/^ {2}tracks +4 +4$/m)
    expect(output).toMatch(/^ {2}play_history +4 +4$/m)
    expect(output).toContain('emptied tracks.album_id in 1 row, which named a row that was gone')
    expect(output).toContain('merge merge-9500-3 named tracks 9, which later rows had taken; undoing it leaves those rows alone')
    expect(output).toMatch(/^Integrity check: ok$/m)
    expect(output).toMatch(/^Foreign key check: ok$/m)

    const copy = new DatabaseSync(join(folder, 'copy', 'library.db'), { readOnly: true })
    expect(copy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 })
    copy.close()
  })

  it('says why it cannot upgrade, and stops, when a row names nothing', () => {
    const folder = mkdtempSync(join(tmpdir(), 'x-music-dry-run-'))
    const library = join(folder, 'library.db')
    const db = legacy_library(library)
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec("INSERT INTO media (id, track_id, kind, uri, added) VALUES (99, 999, 'file', '/music/orphan.flac', 0)")
    db.close()
    const before = digest(library)

    const result = spawnSync(process.execPath, [script, library, '--out', join(folder, 'copy')], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('media.track_id: 1 row points at no tracks row')
    expect(digest(library)).toBe(before)
  })

  it('refuses a path that is not there', () => {
    const result = spawnSync(process.execPath, [script, join(tmpdir(), 'no-such-library.db')], { encoding: 'utf8' })

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/no library at/)
  })
})
