// The main process's log on X-Libs: X_MUSIC_LOG sets the levels, such as warn,play:debug, and X_MUSIC_LOG_FILE adds a file.

import { create_main_log } from '@x-tech-laboratories/x-libs/electron/log'

export const main_log = create_main_log({ setting: process.env.X_MUSIC_LOG, file: process.env.X_MUSIC_LOG_FILE })

export const log = main_log.logger('app')

export const logger = main_log.logger
