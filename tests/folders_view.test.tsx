// @vitest-environment jsdom
// The Folders page: the music folders with when each was scanned, a scan streaming each file's outcome into the log, and its summary.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { FileResult, Root, ScanReport } from '@shared/ipc'
import { FoldersView } from '../src/web/views/FoldersView.tsx'
import { install_bridge } from './bridge.ts'

// ============================================================================
// Setup
// ============================================================================

const now = new Date('2026-11-17T12:00:00Z').getTime()

const roots: Root[] = [
  { id: '1', path: '/tmp/x-music-fixture/music', enabled: true, slow: false, lastScan: now - 3 * 3600_000 },
  { id: '2', path: '/tmp/x-music-fixture/more', enabled: true, slow: false, lastScan: null }
]

const report: ScanReport = {
  filesFound: 3, filesRead: 2, filesSkipped: 1, tracksCreated: 1, tracksMatched: 0, movesDetected: 0,
  markedMissing: 0, errors: [{ path: '/tmp/x-music-fixture/music/broken.flac', message: 'not an audio file' }], durationMs: 2400
}

type Listener = (payload: unknown) => void

// Stands in for the main process's events, so a test can play a scan through.
function fake_events(): (event: string, payload: unknown) => void {
  const listeners = new Map<string, Set<Listener>>()
  Object.assign(window, {
    xMusicEvents: {
      on: (event: string, listener: Listener) => {
        const set = listeners.get(event) ?? new Set<Listener>()
        set.add(listener)
        listeners.set(event, set)
        return () => set.delete(listener)
      }
    }
  })
  return (event, payload) => act(() => { for (const listener of listeners.get(event) ?? []) listener(payload) })
}

beforeEach(() => {
  vi.useFakeTimers({ now, toFake: ['Date'] })
  install_bridge({ 'list_folders': roots, 'scan_folders': () => new Promise(() => undefined) })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ============================================================================
// Folders
// ============================================================================

describe('folders view', () => {
  it('lists the music folders with when each was scanned', async () => {
    render(<FoldersView />)

    expect(screen.getByRole('heading', { level: 1, name: 'Folders' })).toBeTruthy()
    const table = await screen.findByRole('table', { name: 'Music folders' })
    expect(within(table).getByText('/tmp/x-music-fixture/music')).toBeTruthy()
    expect(within(table).getByText('3h ago')).toBeTruthy()
    expect(within(table).getByText('Never')).toBeTruthy()
    expect(within(table).getAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
  })

  it('points at Import when there are no folders', async () => {
    install_bridge({ 'list_folders': [] })
    render(<FoldersView />)

    expect(await screen.findByText('No music folders yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Import' }).getAttribute('href')).toBe('#/import')
    expect((screen.getByRole('button', { name: 'Scan now' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // ==========================================================================
  // Scanning
  // ==========================================================================

  it('logs each file as the scan reads it and sums the scan up', async () => {
    const emit = fake_events()
    render(<FoldersView />)

    await screen.findByRole('table', { name: 'Music folders' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Scan now' })))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()

    const files: FileResult[] = [
      { path: '/tmp/x-music-fixture/music/a.flac', outcome: 'new', trackId: '7' },
      { path: '/tmp/x-music-fixture/music/b.flac', outcome: 'unchanged' },
      { path: '/tmp/x-music-fixture/music/broken.flac', outcome: 'error', detail: 'not an audio file' }
    ]
    emit('scan_files', files)
    emit('scan_done', report)

    const log = screen.getByRole('table', { name: 'Scanned files' })
    expect(within(log).getByText('a.flac')).toBeTruthy()
    expect(within(log).getByText('not an audio file')).toBeTruthy()
    const filter = screen.getByRole('radiogroup', { name: 'Show' })
    expect(within(filter).getAllByRole('radio').map((choice) => choice.textContent)).toEqual(['All 3', 'New 1', 'Unchanged 1', 'Failed 1'])
    expect(screen.getByText('Files read').previousElementSibling?.textContent).toBe('3')
    expect(screen.getByText('Took').previousElementSibling?.textContent).toBe('2 seconds')
    expect(screen.getByText(/1 file could not be read/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show the failed file' }))
    expect(within(filter).getByRole('radio', { name: 'Failed 1' }).getAttribute('aria-checked')).toBe('true')
  })

  it('says why a scan could not start', async () => {
    install_bridge({ 'list_folders': roots, 'scan_folders': () => { throw new Error('a scan is already running') } })
    render(<FoldersView />)

    await screen.findByRole('table', { name: 'Music folders' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Scan now' })))

    expect(screen.getByRole('alert').textContent).toContain('a scan is already running')
  })
})
