// Backups of the library database into backups/ beside it: one a day, kept to the schedule set in Settings, and any
// taken by hand. Every part of the main process holds the open database, so a restore is staged beside it and taken in
// as X-Music starts again, before the library opens.

import { dirname, join } from 'node:path'

import type { BackupMethods } from '@x-tech-laboratories/x-libs/backup_protocol'
import { backup_naming, keep_backing_up } from '@x-tech-laboratories/x-libs/backups'
import { json_backup_schedule } from '@x-tech-laboratories/x-libs/server/backup_routes'
import { sqlite_backups } from '@x-tech-laboratories/x-libs/server/sqlite_backups'

import type { DB } from './db'
import { log } from './log'
import { assertWritable } from './safety'

export function libraryBackups(db: DB, path: string, restart: () => void): { methods: BackupMethods; stop: () => void } {
  const folder = join(dirname(path), 'backups')
  const scheduleFile = join(dirname(path), 'backup-schedule.json')

  const kept = sqlite_backups({
    folder: () => {
      assertWritable('backup', folder)
      return folder
    },
    naming: backup_naming('library', '.db'),
    // better-sqlite3's statement types are narrower than X-Libs' SqlDatabase, though the calls are the same.
    database: () => db as never,
    database_path: () => path,
    after_staging: restart
  })
  const schedule = json_backup_schedule(scheduleFile)
  const backingUp = keep_backing_up(kept, schedule.get, {
    on_error: (error) => log.error('automatic backup failed', { error: String(error) })
  })

  return {
    methods: {
      list_backups: kept.list,
      create_backup: () => kept.create(),
      restore_backup: kept.restore,
      remove_backup: kept.remove,
      get_backup_schedule: schedule.get,
      set_backup_schedule: (next) => {
        assertWritable('backup', scheduleFile)
        schedule.set(next)
        void backingUp.check()
      }
    },
    stop: backingUp.stop
  }
}
