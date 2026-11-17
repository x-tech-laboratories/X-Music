// Tries the library upgrade on a copy: `node scripts/dry_run_upgrade.ts <library.db> [--out <folder>]`. It copies the
// file and its write-ahead log, upgrades the copy, and reports what changed; the file it is given is only ever read.

// ── Imports ──────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { bytes } from '@x-tech-laboratories/x-libs/web/format'

import { describe_upgrade } from '../src/shared/library/legacy.ts'
import { open_library } from '../src/shared/library/store.ts'

// ── Arguments ────────────────────────────────────────────────────────────────

const [given, flag, out] = process.argv.slice(2)
if (!given || (flag !== undefined && (flag !== '--out' || !out))) {
  console.error('Usage: node scripts/dry_run_upgrade.ts <library.db> [--out <folder>]')
  process.exit(2)
}
const source = resolve(given)
if (!existsSync(source)) {
  console.error(`There is no library at ${source}.`)
  process.exit(2)
}

// ── Copying ──────────────────────────────────────────────────────────────────

const folder = out ? resolve(out) : mkdtempSync(join(tmpdir(), 'x-music-dry-run-'))
mkdirSync(folder, { recursive: true })
const copy = join(folder, basename(source))
if (copy === source) {
  console.error('The copy would land on the library itself; pick another --out folder.')
  process.exit(2)
}

// The log holds the latest changes until SQLite folds them in, so it travels with the file.
const companions = ['', '-wal', '-shm']
for (const suffix of companions) if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix)
const size = (path: string): number => companions.reduce((total, suffix) => total + (existsSync(path + suffix) ? statSync(path + suffix).size : 0), 0)
const size_before = size(copy)

// ── Upgrading ────────────────────────────────────────────────────────────────

const tables = [
  'tracks', 'media', 'media_tags', 'albums', 'values_', 'track_values', 'track_extras', 'play_history', 'tag_writes',
  'playlists', 'playlist_tracks', 'roots', 'settings', 'merge_journal', 'artwork', 'track_versions'
]

function counts(database: DatabaseSync): Map<string, number | null> {
  const has = (table: string) => database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
  return new Map(tables.map((table) => [table, has(table) ? (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total : null]))
}

const database = new DatabaseSync(copy)
const before = counts(database)
const started = performance.now()
let report: ReturnType<typeof open_library>
try {
  report = open_library(database)
} catch (error) {
  database.close()
  console.error(`The upgrade of the copy at ${copy} stopped, and would stop the same way on the library: ${(error as Error).message}`)
  process.exit(1)
}
const took = Math.round(performance.now() - started)
const after = counts(database)
const integrity = (database.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((row) => row.integrity_check)
const broken = database.prepare('PRAGMA foreign_key_check').all()
database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
database.close()

// ── Report ───────────────────────────────────────────────────────────────────

const shown = (total: number | null | undefined): string => (total === null || total === undefined ? '-' : String(total))
const lines = [
  `Upgraded a copy at ${copy} in ${took} ms`,
  report ? 'The library was at the old schema and was converted.' : 'The library was already on the current tables; only newer migrations ran.',
  `File size: ${bytes(size_before)} before, ${bytes(size(copy))} after`,
  'Rows per table, before and after:',
  ...tables.map((table) => `  ${table.padEnd(16)} ${shown(before.get(table)).padStart(9)} ${shown(after.get(table)).padStart(9)}`),
  'References and merges:',
  ...(report && (report.nulled.length > 0 || report.reused.length > 0) ? describe_upgrade(report).map((line) => `  ${line}`) : ['  none to report']),
  `Integrity check: ${integrity.join('; ')}`,
  `Foreign key check: ${broken.length === 0 ? 'ok' : `${broken.length} broken references`}`
]
console.info(lines.join('\n'))
