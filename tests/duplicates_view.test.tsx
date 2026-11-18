// @vitest-environment jsdom
// The Duplicates page: the ways of matching as switches, the groups found with their ratings as stars, and a quick merge undone from its toast.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Toasts } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { DuplicateGroup, MergeResult } from '@shared/ipc'
import { DuplicatesView } from '../src/web/views/DuplicatesView.tsx'
import { install_bridge, type Call } from './bridge.ts'

// ============================================================================
// Setup
// ============================================================================

const group: DuplicateGroup = {
  key: 'audio:1', reason: 'audio_hash', confidence: 'certain', explanation: 'Identical audio in 2 files',
  members: [
    { track_id: '1', title: 'Blue in Green', artist: 'Miles Davis', album: 'Kind of Blue', year: 1959, length_ms: 337_000, rating: 80, play_count: 12, media_count: 1, codecs: 'FLAC' },
    { track_id: '2', title: 'Blue in Green', artist: 'Miles Davis', album: 'Kind of Blue', year: 1959, length_ms: 337_000, rating: null, play_count: 3, media_count: 1, codecs: 'MP3' }
  ]
}

const merged: MergeResult = { batch_id: 'batch-1', survivor: '1', absorbed: ['2'], media_moved: 1, history_moved: 3, playlist_entries_repointed: 0 }

function show_page(): void {
  render(<><DuplicatesView /><Toasts /></>)
}

let calls: Call[] = []

beforeEach(() => {
  localStorage.clear()
  calls = install_bridge({
    'list_duplicates': [group],
    'get_merge_preview': { ids: ['1', '2'], survivor: '1', fields: [], media: [], statistics: { play_count: 15, skip_count: 0, rating: 80, first_played: null, last_played: null }, pinned_sources: [] },
    'merge_tracks': merged,
    'undo_merge': { batch_id: 'batch-1', restored: ['2'], survivor: '1' }
  })
})

afterEach(cleanup)

// ============================================================================
// Search
// ============================================================================

describe('duplicates view', () => {
  it('searches with the ways of matching switched on and the length tolerance', async () => {
    show_page()

    expect(screen.getByRole('heading', { level: 1, name: 'Duplicates' })).toBeTruthy()
    const similar = screen.getByRole('switch', { name: 'Similar tags and length' }) as HTMLInputElement
    expect(similar.checked).toBe(false)
    expect(screen.queryByRole('textbox', { name: 'Length tolerance' })).toBeNull()
    await act(async () => fireEvent.click(similar))
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'MusicBrainz recording' })))
    fireEvent.click(screen.getByRole('button', { name: 'More length tolerance' }))
    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))

    await screen.findByText('Identical audio in 2 files')
    const search = calls.find((call) => call.channel === 'list_duplicates')
    expect(search?.args).toEqual([['audio_hash', 'tags', 'fuzzy'], 4000, 200])
    expect(screen.getByText('1 group · 2 tracks')).toBeTruthy()
  })

  it('shows each track\'s rating as stars', async () => {
    show_page()

    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))

    const ratings = await screen.findAllByRole('slider', { name: 'Rating' })
    expect(ratings.map((rating) => rating.getAttribute('aria-valuetext'))).toEqual(['4 stars', 'Unrated'])
    expect(screen.getByText('Certain')).toBeTruthy()
  })

  it('says so when nothing is found', async () => {
    install_bridge({ 'list_duplicates': [] })
    show_page()

    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))

    expect(await screen.findByText('No duplicates found.')).toBeTruthy()
  })

  it('says why a search failed and searches again on Retry', async () => {
    let fails = true
    install_bridge({
      'list_duplicates': () => {
        if (fails) throw new Error('database is locked')
        return [group]
      }
    })
    show_page()

    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('database is locked')
    fails = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Identical audio in 2 files')).toBeTruthy()
  })

  // ==========================================================================
  // Merging
  // ==========================================================================

  it('merges a group at once and undoes it from the toast', async () => {
    show_page()

    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))
    const panel = (await screen.findByText('Identical audio in 2 files')).closest('section')!
    await act(async () => fireEvent.click(within(panel).getByRole('button', { name: 'Quick merge' })))

    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('Merged 2 tracks into one')
    expect(within(panel).getByText('Merged')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Quick merge' })).toBeNull()
    expect(calls.find((call) => call.channel === 'merge_tracks')?.args).toEqual([['1', '2'], '1'])

    await act(async () => fireEvent.click(within(note).getByRole('button', { name: 'Undo' })))

    expect(calls.find((call) => call.channel === 'undo_merge')?.args[0]).toBe('batch-1')
    expect(await within(panel).findByRole('button', { name: 'Quick merge' })).toBeTruthy()
  })

  it('finds the groups again when a reviewed merge is undone', async () => {
    show_page()
    const searches = () => calls.filter((call) => call.channel === 'list_duplicates').length

    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))
    const panel = (await screen.findByText('Identical audio in 2 files')).closest('section')!
    await act(async () => fireEvent.click(within(panel).getByRole('button', { name: 'Review' })))
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Merge' })))
    await screen.findByText('Identical audio in 2 files')
    const before_undo = searches()
    await act(async () => fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' })))

    await vi.waitFor(() => expect(searches()).toBe(before_undo + 1))
  })
})
