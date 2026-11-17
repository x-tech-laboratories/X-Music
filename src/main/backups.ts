// Backups of the library database into backups/ beside it: one a day, kept to the schedule set in Settings, any taken
// by hand, and one before anything replaces the data, such as a schema upgrade or clearing the library. Every part of
// the main process holds the open database, so a restore is staged beside it and taken in as X-Music starts again.

import { dirname, join } from 'node:path'

import type { Backup, BackupMethods } from '@x-tech-laboratories/x-libs/backup_protocol'
import { backup_naming, keep_backing_up } from '@x-tech-laboratories/x-libs/backups'
import { json_backup_schedule } from '@x-tech-laboratories/x-libs/server/backup_routes'
import { sqlite_backups } from '@x-tech-laboratories/x-libs/server/sqlite_backups'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { clear_library, needs_upgrade, open_library, type UpgradeReport } from '@shared/library/store'

import { log } from './log.ts'

export interface LibraryBackups {
  methods: BackupMethods
  // Takes a backup now, such as before a schema upgrade or before the library is cleared.
  create: () => Promise<Backup>
  // Starts the daily backups, once the library is open.
  start: () => void
  stop: () => void
}

export function libraryBackups(database: () => SqlDatabase, path: string, restart: () => void): LibraryBackups {
  const folder = join(dirname(path), 'backups')
  const scheduleFile = join(dirname(path), 'backup-schedule.json')

  const kept = sqlite_backups({
    folder: () => folder,
    naming: backup_naming('library', '.db'),
    database,
    database_path: () => path,
    after_staging: restart
  })
  const schedule = json_backup_schedule(scheduleFile)
  let backingUp: ReturnType<typeof keep_backing_up> | null = null

  return {
    methods: {
      list_backups: kept.list,
      create_backup: () => kept.create(),
      restore_backup: kept.restore,
      remove_backup: kept.remove,
      get_backup_schedule: schedule.get,
      set_backup_schedule: (next) => {
        schedule.set(next)
        void backingUp?.check()
      }
    },
    create: () => kept.create(),
    start: () => {
      backingUp ??= keep_backing_up(kept, schedule.get, {
        on_error: (error) => log.error('automatic backup failed', { error: String(error) })
      })
    },
    stop: () => backingUp?.stop()
  }
}

// Opens the library, backing it up first when opening would upgrade its schema; gives back that backup, if one was
// taken, and what converting an older library did.
export async function openLibraryBackedUp(
  database: SqlDatabase, backups: Pick<LibraryBackups, 'create'>
): Promise<{ backup: Backup | null; report: UpgradeReport | null }> {
  const backup = needs_upgrade(database) ? await backups.create() : null
  return { backup, report: open_library(database) }
}

// Clears the library after a backup of it, and not at all if the backup fails.
export async function clearLibraryBackedUp(database: SqlDatabase, backups: Pick<LibraryBackups, 'create'>): Promise<Backup> {
  const backup = await backups.create()
  clear_library(database)
  return backup
}
