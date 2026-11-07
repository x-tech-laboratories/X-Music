// Renderer-side entry point for every IPC call.
//
// contextBridge clones arguments before any preload code runs, so an uncloneable value such as a
// Proxy has to be flattened here, in the page; calling window.xMusic directly skips that.

import { to_cloneable } from '@x-tech-laboratories/x-libs/electron/bridge'
import type { XMusicApi, Channel } from '@shared/ipc'

export function ipc<C extends Channel>(
  channel: C,
  ...args: Parameters<XMusicApi[C]>
): Promise<Awaited<ReturnType<XMusicApi[C]>>> {
  const plain = args.map(to_cloneable) as Parameters<XMusicApi[C]>
  const method = window.xMusic[channel] as (...plain: Parameters<XMusicApi[C]>) => Promise<Awaited<ReturnType<XMusicApi[C]>>>
  return method(...plain)
}
