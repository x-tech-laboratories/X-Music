import type { BackupMethods } from '@x-tech-laboratories/x-libs/backup_protocol'
import type { Client } from '@x-tech-laboratories/x-libs/electron/bridge'
import type { EventsClient } from '@x-tech-laboratories/x-libs/electron/events'
import type { XMusicApi, XMusicEvents } from '../shared/ipc'

declare global {
  interface Window {
    xMusic: Client<XMusicApi>
    xMusicEvents: EventsClient<XMusicEvents>
    xMusicBackups: Client<BackupMethods>
  }
}

export {}
