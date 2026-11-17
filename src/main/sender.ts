// Which pages may call the main process: only X-Music's own, never a site a link led to.

import type { IpcMainEventLike } from '@x-tech-laboratories/x-libs/electron/bridge'
import { is_app_page } from '@x-tech-laboratories/x-libs/electron/window'

export interface AppPage {
  dev_url?: string
  file: string
}

export function trustedSender(page: AppPage): (event: IpcMainEventLike) => boolean {
  return (event) => is_app_page(event.senderFrame?.url ?? '', page)
}
