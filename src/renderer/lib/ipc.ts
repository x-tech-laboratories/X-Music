// Renderer-side entry point for every IPC call. contextBridge clones arguments before any preload code runs, so an
// uncloneable value such as a Proxy is flattened here, in the page.

import { with_cloneable_arguments, type Client } from '@x-tech-laboratories/x-libs/electron/bridge'
import type { ApiName, PageName, XMusicApi, XMusicPageApi } from '@shared/ipc'

type Methods<Table> = Record<keyof Table, (...args: never[]) => unknown>

// The same client with cloneable arguments, made again whenever the window's client is replaced, as tests do.
function cloneable<Table extends Methods<Table>>(read: () => Client<Table>): () => Client<Table> {
  let client: Client<Table> | null = null
  let wrapped: Client<Table> | null = null
  return () => {
    if (client !== read()) wrapped = with_cloneable_arguments((client = read()))
    return wrapped!
  }
}

const api_client = cloneable<XMusicApi>(() => window.xMusic)
const page_client = cloneable<XMusicPageApi>(() => window.xMusicPage)

// A call other programs can make too, through the MCP server.
export function ipc<Name extends ApiName>(name: Name, ...args: Parameters<XMusicApi[Name]>): Promise<Awaited<ReturnType<XMusicApi[Name]>>> {
  const method = api_client()[name] as (...args: Parameters<XMusicApi[Name]>) => Promise<Awaited<ReturnType<XMusicApi[Name]>>>
  return method(...args)
}

// A call only the window makes: dialogs, the file manager, cover images and the log.
export function page_ipc<Name extends PageName>(name: Name, ...args: Parameters<XMusicPageApi[Name]>): Promise<Awaited<ReturnType<XMusicPageApi[Name]>>> {
  const method = page_client()[name] as (...args: Parameters<XMusicPageApi[Name]>) => Promise<Awaited<ReturnType<XMusicPageApi[Name]>>>
  return method(...args)
}
