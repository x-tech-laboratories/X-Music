// @vitest-environment jsdom
// The Settings page: preferences, the library database and its backups, and the version, on X-Libs' SettingsPage.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Dialogs } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { SettingsView } from '../../src/renderer/views/SettingsView'
import { library } from '../../src/renderer/stores/library'
import { install_bridge, type Call } from '../helpers/bridge'

const info = { version: '0.1.2', electron: '43.0.0', chrome: '140.0', node: '24.0.0', platform: 'linux' }

beforeEach(() => install_bridge())

afterEach(() => {
  cleanup()
  library.stats = null
})

describe('settings view', () => {
  it('outlines its categories and sections, with no tools among them', () => {
    render(<SettingsView info={info} density="normal" on_density={() => undefined} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    const categories = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(categories).toEqual(['General', 'Data', 'About'])
    const outline = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(outline).getAllByRole('link').map((link) => link.textContent)).toEqual(['Appearance', 'Library database', 'Backups', 'MCP server', 'X-Music'])
    for (const name of ['Folders', 'Import', 'Duplicates']) expect(screen.queryByRole('heading', { name })).toBeNull()
  })

  it('changes the density', () => {
    const on_density = vi.fn()
    render(<SettingsView info={info} density="normal" on_density={on_density} />)

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Density' })).getByRole('radio', { name: 'Compact' }))

    expect(on_density).toHaveBeenCalledWith('compact')
  })

  it('shows the library database and the version', () => {
    library.stats = { tracks: 1200, media: 1300, albums: 90, missing: 0, totalMs: 3_600_000, schemaVersion: 1, path: '/tmp/x-music-test.db' }
    render(<SettingsView info={info} density="normal" on_density={() => undefined} />)

    expect(screen.getByText('/tmp/x-music-test.db')).toBeTruthy()
    expect(screen.getByText(/1,200 tracks/)).toBeTruthy()
    expect(screen.getByText('0.1.2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear library…' })).toBeTruthy()
  })

  it('clears the library only once the dialog is confirmed', async () => {
    let cleared = 0
    install_bridge({ 'clear_library': () => { cleared += 1; return { cleared: true } } })
    render(<><SettingsView info={info} density="normal" on_density={() => undefined} /><Dialogs /></>)

    fireEvent.click(screen.getByRole('button', { name: 'Clear library…' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Removes every track, album, playlist, rating and play')
    expect(dialog.textContent).toContain('your music files are not touched')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(cleared).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Clear library…' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear library' }))

    await waitFor(() => expect(cleared).toBe(1))
  })

  it('keeps the MCP server off until it is switched on, then shows how to add it', async () => {
    let settings = { enabled: false, port: 3919 }
    const calls: Call[] = install_bridge({
      get_local_mcp_settings: () => settings,
      set_local_mcp_settings: (next: typeof settings) => { settings = next },
      get_local_mcp_status: () => settings.enabled ? { state: 'running', url: 'http://127.0.0.1:3919/mcp', error: '' } : { state: 'off', url: '', error: '' }
    })
    render(<SettingsView info={info} density="normal" on_density={() => undefined} />)

    const toggle = await screen.findByRole('switch', { name: 'MCP server' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(screen.queryByText(/claude mcp add/)).toBeNull()
    fireEvent.click(toggle)

    expect(await screen.findByText('claude mcp add --transport http x-music http://127.0.0.1:3919/mcp')).toBeTruthy()
    expect(calls.find((call) => call.channel === 'set_local_mcp_settings')?.args).toEqual([{ enabled: true, port: 3919 }])
  })
})
