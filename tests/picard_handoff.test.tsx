// @vitest-environment jsdom
// Tagging with Picard from the window: a warning first, the hand-off, and word when the Picard window closes.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Dialogs } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { Toasts } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { ScanReport, TrackRow } from '@shared/ipc'
import { browse, library, results } from '../src/web/stores/library.ts'
import { describe_picard_closed, listen_for_picard } from '../src/web/widgets/picard.tsx'
import { SongList } from '../src/web/widgets/SongList.tsx'
import { emit_event, empty_stats, install_bridge, type Call } from './bridge.ts'

// ============================================================================
// Setup
// ============================================================================

const rows: TrackRow[] = [1, 2].map((number) => ({
  id: `track-${number}`, title: `Track ${number}`, artist: 'A', album: 'B', year: 2000,
  track_number: number, length_ms: 61_000, rating: null, play_count: 0
}))

let calls: Call[]

beforeEach(() => {
  calls = install_bridge({ 'tag_with_picard': (ids: string[]) => ({ files: ids.length, skipped: 0, picard: '/usr/bin/picard' }) })
  results.set({ stats: { ...empty_stats, tracks: 2 }, tracks: rows, order: rows.map((row) => row.id), error: null })
  browse.set({ sort: [], panes: {}, search: '', playlist: null })
  library.clear_selection()
})

afterEach(cleanup)

const report = (changes: Partial<ScanReport> = {}): ScanReport => ({
  files_found: 0, files_read: 0, files_skipped: 0, tracks_created: 0, tracks_matched: 0,
  moves_detected: 0, marked_missing: 0, errors: [], duration_ms: 0, ...changes
})

// ============================================================================
// Handing off
// ============================================================================

describe('tag with picard', () => {
  it('warns that Picard writes to the files, and hands the picked tracks over only once confirmed', async () => {
    render(<><SongList /><Dialogs /><Toasts /></>)
    fireEvent.click(screen.getByText('Track 1').closest('tr')!)
    fireEvent.click(screen.getByText('Track 2').closest('tr')!, { ctrlKey: true })

    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selected rows' })).getByRole('button', { name: 'Tag with Picard…' }))
    const dialog = screen.getByRole('dialog', { name: 'Tag 2 tracks with Picard?' })
    expect(dialog.textContent).toContain('Picard writes tags into the files')
    expect(calls.some((call) => call.channel === 'tag_with_picard')).toBe(false)

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Open in Picard' })) })

    expect(calls.find((call) => call.channel === 'tag_with_picard')?.args).toEqual([['track-1', 'track-2']])
    expect(await screen.findByText('Picard is open with 2 files.')).toBeTruthy()
  })

  it('says when Picard closes, from the event the main process sends', async () => {
    render(<Toasts />)
    const stop = listen_for_picard()

    act(() => emit_event('picard_closed', { files: 3, report: report({ moves_detected: 1 }) }))

    expect(await screen.findByText('Picard closed; 3 files read again, 1 moved file followed.')).toBeTruthy()
    stop()
  })
})

describe('what a closed Picard says', () => {
  it('names a failure, a skipped rescan and a rescan', () => {
    expect(describe_picard_closed({ files: 1, report: null, error: 'Picard ended with exit code 1' }))
      .toEqual({ text: 'Picard closed: Picard ended with exit code 1.', tone: 'bad' })
    expect(describe_picard_closed({ files: 2, report: null }).text).toBe('Picard closed. Scan your music folders to pick up its changes to 2 files.')
    expect(describe_picard_closed({ files: 1, report: report() }).text).toBe('Picard closed; 1 file read again.')
  })
})
