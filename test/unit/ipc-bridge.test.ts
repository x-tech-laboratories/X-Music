// The contract's method table and event channel, as the X-Libs bridge builds them for the preload and the main process.

import { describe, expect, it, vi } from 'vitest'
import { CHANNELS, x_music_bridge, x_music_events, type PlayerStatus } from '@shared/ipc'

describe('IPC bridge', () => {
  it('answers every channel in the contract once, each on its own IPC channel', () => {
    const handled: string[] = []
    const ipc_main = { handle: (channel: string) => void handled.push(channel), removeHandler: vi.fn() }

    x_music_bridge.handle(ipc_main, {} as never)

    expect(new Set(CHANNELS).size).toBe(CHANNELS.length)
    expect(handled).toEqual(CHANNELS.map((channel) => `xMusic:${channel}`))
  })

  it('exposes the client and the events where the page reads them', () => {
    const exposed: Record<string, unknown> = {}
    const context_bridge = { exposeInMainWorld: (key: string, api: unknown) => void (exposed[key] = api) }
    const ipc_renderer = { invoke: vi.fn(async () => null), on: vi.fn(), removeListener: vi.fn() }

    x_music_bridge.expose(context_bridge, ipc_renderer)
    x_music_events.expose(context_bridge, ipc_renderer)

    expect(Object.keys(exposed.xMusic as object).sort()).toEqual([...CHANNELS].sort())
    expect(typeof (exposed.xMusicEvents as { on: unknown }).on).toBe('function')
  })

  it('pushes an event to every window by name', () => {
    const send = vi.fn()
    const status = { state: 'idle' } as PlayerStatus

    x_music_events.emit([{ webContents: { send } }], 'player:status', status)

    expect(send).toHaveBeenCalledWith('xMusicEvents:event', { name: 'player:status', payload: status })
  })
})
