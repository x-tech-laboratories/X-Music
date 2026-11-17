// @vitest-environment jsdom
// The Import page: a gmusicbrowser configuration previewed, its options as switches, the import run, and no way to clear the library from here.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { GmbPreview, ImportReport } from '@shared/ipc'
import { ImportView } from '../../src/renderer/views/ImportView'
import { install_bridge } from '../helpers/bridge'

// ============================================================================
// Setup
// ============================================================================

const fixture_path = '/tmp/x-music-fixture/gmbrc'

const preview: GmbPreview = {
  path: fixture_path, exists: true, version: '1.1.16', baseFolder: '/tmp/x-music-fixture/music',
  songs: 1234, savedFilters: 2, savedLists: 3, playHistoryEntries: 5678, unmappedColumns: []
}

const report: ImportReport = {
  songsRead: 1234, tracksCreated: 1200, mediaCreated: 1234, missingFlagged: 0, playHistoryRows: 5678,
  playlistsCreated: 3, savedFiltersFound: 2, unmappedColumns: [], notes: ['34 songs were already in the library.']
}

interface Call { channel: string; args: unknown[] }

// Keeps every call the page makes, on top of the bridge's answers.
function recorded_calls(): Call[] {
  const calls: Call[] = []
  const inner = window.xMusic as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  Object.assign(window, {
    xMusic: Object.fromEntries(Object.keys(inner).map((channel) => [channel, (...args: unknown[]) => {
      calls.push({ channel, args })
      return inner[channel]!(...args)
    }]))
  })
  return calls
}

beforeEach(() => {
  install_bridge({ 'import:gmbDefaultPath': fixture_path, 'import:gmbPreview': preview, 'import:gmbRun': report })
})

afterEach(cleanup)

// ============================================================================
// Preview
// ============================================================================

describe('import view', () => {
  it('previews the configuration file it finds', async () => {
    render(<ImportView />)

    expect(screen.getByRole('heading', { level: 1, name: 'Import' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Import 1,234 tracks' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Configuration file' }) as HTMLInputElement).value).toBe(fixture_path)
    expect(screen.getByText('5,678')).toBeTruthy()
    expect(screen.getByText('/tmp/x-music-fixture/music')).toBeTruthy()
  })

  it('says where gmusicbrowser keeps the file when there is none at the path', async () => {
    install_bridge({ 'import:gmbDefaultPath': fixture_path, 'import:gmbPreview': { ...preview, exists: false, songs: 0 } })
    render(<ImportView />)

    expect(await screen.findByText(/No gmusicbrowser configuration at this path/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull()
  })

  it('offers no way to clear the library', async () => {
    render(<ImportView />)

    await screen.findByRole('button', { name: /^Import 1,234/ })
    expect(screen.queryByRole('button', { name: /Clear library/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('#/settings')
  })

  // ==========================================================================
  // Import
  // ==========================================================================

  it('imports with the options switched on and reports what came in', async () => {
    const calls = recorded_calls()
    render(<ImportView />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Saved lists as playlists' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 1,234 tracks' }))

    const imported = (await screen.findByRole('heading', { name: 'Imported' })).closest('section')!
    expect(within(imported).getByText(/1,200 tracks/)).toBeTruthy()
    expect(within(imported).getByText('34 songs were already in the library.')).toBeTruthy()
    expect(within(imported).getByRole('link', { name: 'Show the library' }).getAttribute('href')).toBe('#/library')
    const run = calls.find((call) => call.channel === 'import:gmbRun')
    expect(run?.args[0]).toEqual({ path: fixture_path, statistics: true, labels: true, playlists: false })
  })

  it('says why an import failed', async () => {
    install_bridge({
      'import:gmbDefaultPath': fixture_path,
      'import:gmbPreview': preview,
      'import:gmbRun': () => { throw new Error('the file is not a gmbrc') }
    })
    render(<ImportView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Import 1,234 tracks' }))

    expect((await screen.findByRole('alert')).textContent).toContain('the file is not a gmbrc')
  })
})
