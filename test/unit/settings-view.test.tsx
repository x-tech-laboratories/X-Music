// @vitest-environment jsdom
// The Settings page: preferences, the library database and its backups, and the version, on X-Libs' SettingsPage.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SettingsView } from '../../src/renderer/views/SettingsView'
import { library } from '../../src/renderer/stores/library'
import { install_bridge } from '../helpers/bridge'

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
    expect(within(outline).getAllByRole('link').map((link) => link.textContent)).toEqual(['Appearance', 'Library database', 'Backups', 'X-Music'])
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
})
