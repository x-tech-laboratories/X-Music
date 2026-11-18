// The page's log on X-Libs: records join the main process's log at the levels it sets, uncaught errors included.

import { create_page_log } from '@x-tech-laboratories/x-libs/web/page_log'

// Read from the window at each call, so a test's stand-in bridge is the one used.
export const page_log = create_page_log({
  write_log: (record) => window.xMusicLog.write_log(record),
  get_log_levels: () => window.xMusicLog.get_log_levels()
})

export const logger = page_log.logger

export const log = logger('renderer')
