// The contract's method table and event channel, as the X-Libs bridge builds them for the preload and the main process.

import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { trusted_sender } from '@main/sender'
import { is_read_only } from '@shared/api'
import { api_method_names, history_channels, page_method_names, x_music_bridge, x_music_events, x_music_history_bridge, x_music_log_bridge, x_music_page_bridge, type PlayerStatus } from '@shared/ipc'

type Answer = (event: unknown, ...args: unknown[]) => Promise<unknown>

describe('IPC bridge', () => {
  it('answers every call in the contract once, each on its own IPC channel', () => {
    const handled: string[] = []
    const ipc_main = { handle: (channel: string) => void handled.push(channel), removeHandler: vi.fn() }

    x_music_bridge.handle(ipc_main, {} as never)
    x_music_page_bridge.handle(ipc_main, {} as never)

    const names = [...api_method_names, ...page_method_names]
    expect(new Set(names).size).toBe(names.length)
    expect(handled).toEqual([...api_method_names.map((name) => `xMusic:${name}`), ...page_method_names.map((name) => `xMusicPage:${name}`)])
  })

  it('names every call in snake case, a read with list_ or get_', () => {
    for (const name of [...api_method_names, ...page_method_names]) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/)
    expect(api_method_names.filter((name) => /^(list|get)_/.test(name))).toEqual([
      'get_app_info', 'get_library_stats', 'list_tracks', 'list_track_groups', 'get_track', 'list_playlists', 'list_duplicates', 'get_merge_preview',
      'list_folders', 'get_default_gmbrc_path', 'get_gmbrc_preview', 'get_player_status'
    ])
    expect(page_method_names.filter((name) => is_read_only(name))).toEqual(['get_picard_setup'])
  })

  it('exposes the client and the events where the page reads them', () => {
    const exposed: Record<string, unknown> = {}
    const context_bridge = { exposeInMainWorld: (key: string, api: unknown) => void (exposed[key] = api) }
    const ipc_renderer = { invoke: vi.fn(async () => null), on: vi.fn(), removeListener: vi.fn() }

    x_music_bridge.expose(context_bridge, ipc_renderer)
    x_music_page_bridge.expose(context_bridge, ipc_renderer)
    x_music_events.expose(context_bridge, ipc_renderer)

    expect(Object.keys(exposed.xMusic as object).sort()).toEqual([...api_method_names].sort())
    expect(Object.keys(exposed.xMusicPage as object).sort()).toEqual([...page_method_names].sort())
    expect(typeof (exposed.xMusicEvents as { on: unknown }).on).toBe('function')
  })

  it('takes the page\'s log records on a bridge of their own, with the levels the main process sets', () => {
    const handled: string[] = []
    const ipc_main = { handle: (channel: string) => void handled.push(channel), removeHandler: vi.fn() }

    x_music_log_bridge.handle(ipc_main, {} as never)

    expect(handled).toEqual(['xMusicLog:write_log', 'xMusicLog:get_log_levels'])
  })

  it('pushes an event to every window by name', () => {
    const send = vi.fn()
    const status = { state: 'idle' } as PlayerStatus

    x_music_events.emit([{ webContents: { send } }], 'player_status', status)

    expect(send).toHaveBeenCalledWith('xMusicEvents:event', { name: 'player_status', payload: status })
  })

  it('names the history calls as the standard does, each on its own channel', () => {
    const handled: string[] = []
    const ipc_main = { handle: (channel: string) => void handled.push(channel), removeHandler: vi.fn() }

    x_music_history_bridge.handle(ipc_main, {} as never)

    expect([...history_channels]).toEqual(['list_versions', 'list_recent_versions', 'restore_version', 'get_history_keep_days', 'set_history_keep_days', 'list_recent_merges'])
    expect(handled).toEqual(history_channels.map((channel) => `xMusicHistory:${channel}`))
  })

  it('answers only X-Music\'s own page, and in envelopes the page unwraps', async () => {
    const answers = new Map<string, Answer>()
    const ipc_main = { handle: (channel: string, answer: Answer) => void answers.set(channel, answer), removeHandler: vi.fn() }
    const page = { file: '/opt/x-music/out/renderer/index.html' }
    const own = { senderFrame: { url: pathToFileURL(page.file).href } }
    const stranger = { senderFrame: { url: 'https://example.com/' } }

    x_music_bridge.handle(ipc_main, { get_default_gmbrc_path: () => '/home/user/.config/gmusicbrowser/gmbrc' } as never, { trusted: trusted_sender(page), envelopes: true })
    const answer = answers.get('xMusic:get_default_gmbrc_path')!

    expect(await answer(own)).toEqual({ ok: true, result: '/home/user/.config/gmusicbrowser/gmbrc' })
    expect(await answer(stranger)).toEqual({ ok: false, error: 'Untrusted sender.' })
    expect(await answer({ senderFrame: { url: pathToFileURL(join('/opt', 'elsewhere', 'index.html')).href } })).toMatchObject({ ok: false })
  })

  it('trusts the dev server\'s origin while developing', () => {
    const trusted = trusted_sender({ dev_url: 'http://localhost:5173/', file: '/unused/index.html' })

    expect(trusted({ senderFrame: { url: 'http://localhost:5173/index.html' } })).toBe(true)
    expect(trusted({ senderFrame: { url: 'http://localhost:9999/' } })).toBe(false)
    expect(trusted({ senderFrame: null })).toBe(false)
  })
})
