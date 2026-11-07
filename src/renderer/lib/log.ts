// The renderer's logger. Records are forwarded to the main process so everything lands in one
// stream, in order, with one configuration; a renderer-only console is invisible from a terminal.

import { create_logger, parse_level_spec, type Level, type Logger } from '@x-tech-laboratories/x-libs/log'
import { ipc } from './ipc'

// The renderer cannot read the environment, so the main process states the level at start-up.
let spec = parse_level_spec(undefined)

export function configureLogging(levelSpec: string | undefined): void {
  spec = parse_level_spec(levelSpec)
}

const sink = (record: { level: Level; scope: string; message: string; data?: unknown }): void => {
  void ipc('app:log', {
    level: record.level,
    scope: record.scope,
    message: record.message,
    data: record.data
  })
}

// Read through a function, so loggers made before configureLogging still pick up the real level.
export const logger = (scope: string): Logger => create_logger(scope, () => spec, sink)
export const log = logger('renderer')
