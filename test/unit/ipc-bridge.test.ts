// The contract's method table and event channel, as the X-Libs bridge builds them for the preload and the main process.

import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { trustedSender } from '@main/sender'
import { CHANNELS, history_channels, x_music_bridge, x_music_events, x_music_history_bridge, type PlayerStatus } from '@shared/ipc'

type Answer = (event: unknown, ...args: unknown[]) => Promise<unknown>

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

  it('names the history calls as the standard does, each on its own channel', () => {
    const handled: string[] = []
    const ipc_main = { handle: (channel: string) => void handled.push(channel), removeHandler: vi.fn() }

    x_music_history_bridge.handle(ipc_main, {} as never)

    expect([...history_channels]).toEqual(['list_versions', 'list_recent_versions', 'restore_version', 'get_history_keep_days', 'set_history_keep_days'])
    expect(handled).toEqual(history_channels.map((channel) => `xMusicHistory:${channel}`))
  })

  it('answers only X-Music\'s own page, and in envelopes the page unwraps', async () => {
    const answers = new Map<string, Answer>()
    const ipc_main = { handle: (channel: string, answer: Answer) => void answers.set(channel, answer), removeHandler: vi.fn() }
    const page = { file: '/opt/x-music/out/renderer/index.html' }
    const own = { senderFrame: { url: pathToFileURL(page.file).href } }
    const stranger = { senderFrame: { url: 'https://example.com/' } }

    x_music_bridge.handle(ipc_main, { 'theme:list': () => ['halon-light'] } as never, { trusted: trustedSender(page), envelopes: true })
    const answer = answers.get('xMusic:theme:list')!

    expect(await answer(own)).toEqual({ ok: true, result: ['halon-light'] })
    expect(await answer(stranger)).toEqual({ ok: false, error: 'Untrusted sender.' })
    expect(await answer({ senderFrame: { url: pathToFileURL(join('/opt', 'elsewhere', 'index.html')).href } })).toMatchObject({ ok: false })
  })

  it('trusts the dev server\'s origin while developing', () => {
    const trusted = trustedSender({ dev_url: 'http://localhost:5173/', file: '/unused/index.html' })

    expect(trusted({ senderFrame: { url: 'http://localhost:5173/index.html' } })).toBe(true)
    expect(trusted({ senderFrame: { url: 'http://localhost:9999/' } })).toBe(false)
    expect(trusted({ senderFrame: null })).toBe(false)
  })
})
