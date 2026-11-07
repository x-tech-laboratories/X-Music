import { contextBridge, ipcRenderer } from 'electron'
import { x_music_bridge, x_music_events } from '@shared/ipc'

// The page gets exactly the methods declared in the contract, and one event channel dispatched by name.
x_music_bridge.expose(contextBridge, ipcRenderer)
x_music_events.expose(contextBridge, ipcRenderer)
