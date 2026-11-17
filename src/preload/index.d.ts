import type { BackupMethods } from '@x-tech-laboratories/x-libs/backup_protocol'
import type { Client } from '@x-tech-laboratories/x-libs/electron/bridge'
import type { EventsClient } from '@x-tech-laboratories/x-libs/electron/events'
import type { LocalMcpClient } from '@x-tech-laboratories/x-libs/local_mcp_protocol'
import type { XMusicApi, XMusicEvents, XMusicHistoryApi, XMusicPageApi } from '../shared/ipc'

declare global {
  interface Window {
    xMusic: Client<XMusicApi>
    xMusicPage: Client<XMusicPageApi>
    xMusicEvents: EventsClient<XMusicEvents>
    xMusicBackups: Client<BackupMethods>
    xMusicHistory: Client<XMusicHistoryApi>
    xMusicMcp: LocalMcpClient
  }
}

export {}
