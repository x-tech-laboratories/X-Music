import { contextBridge, ipcRenderer } from 'electron'
import { x_music_backups_bridge, x_music_bridge, x_music_events, x_music_history_bridge, x_music_log_bridge, x_music_mcp_bridge, x_music_page_bridge } from '@shared/ipc'

// The page gets exactly the methods declared in the contract, and one event channel dispatched by name; a failed call reaches it as an Error with the message alone.
x_music_bridge.expose(contextBridge, ipcRenderer, { envelopes: true })
x_music_page_bridge.expose(contextBridge, ipcRenderer, { envelopes: true })
x_music_events.expose(contextBridge, ipcRenderer)
x_music_backups_bridge.expose(contextBridge, ipcRenderer, { envelopes: true })
x_music_history_bridge.expose(contextBridge, ipcRenderer, { envelopes: true })
x_music_mcp_bridge.expose(contextBridge, ipcRenderer, { envelopes: true })
x_music_log_bridge.expose(contextBridge, ipcRenderer, { envelopes: true })
