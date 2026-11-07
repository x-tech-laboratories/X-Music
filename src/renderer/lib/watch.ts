// A change counter a store bumps and a component watches, so only the components that read a store re-render when it changes.

import { useSyncExternalStore } from 'react'

export interface Watch {
  version: () => number
  bump: () => void
  subscribe: (listener: () => void) => () => void
}

export function create_watch(): Watch {
  let version = 0
  const listeners = new Set<() => void>()
  return {
    version: () => version,
    bump: () => {
      version += 1
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

// Re-renders the calling component whenever the watch is bumped.
export function use_watch(watch: Watch): number {
  return useSyncExternalStore(watch.subscribe, watch.version)
}
