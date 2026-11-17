// Renderer-side entry point for every IPC call. contextBridge clones arguments before any preload code runs, so an
// uncloneable value such as a Proxy is flattened here, in the page.

import { with_cloneable_arguments, type Client } from '@x-tech-laboratories/x-libs/electron/bridge'
import type { XMusicApi, Channel } from '@shared/ipc'

let client: Client<XMusicApi> | null = null
let wrapped: Client<XMusicApi> | null = null

export function ipc<C extends Channel>(
  channel: C,
  ...args: Parameters<XMusicApi[C]>
): Promise<Awaited<ReturnType<XMusicApi[C]>>> {
  if (client !== window.xMusic) wrapped = with_cloneable_arguments((client = window.xMusic))
  const method = wrapped![channel] as (...args: Parameters<XMusicApi[C]>) => Promise<Awaited<ReturnType<XMusicApi[C]>>>
  return method(...args)
}
