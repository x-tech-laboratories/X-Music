// @vitest-environment jsdom
// The Duplicates page: the ways of matching as switches, the groups found with their ratings as stars, and a quick merge undone from its toast.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Toasts } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { DuplicateGroup, MergeResult } from '@shared/ipc'
import { DuplicatesView } from '../../src/renderer/views/DuplicatesView'
import { install_bridge } from '../helpers/bridge'

// ============================================================================
// Setup
// ============================================================================

const group: DuplicateGroup = {
  key: 'audio:1', reason: 'audio_hash', confidence: 'certain', explanation: 'Identical audio in 2 files',
  members: [
    { trackId: 1, title: 'Blue in Green', artist: 'Miles Davis', album: 'Kind of Blue', year: 1959, lengthMs: 337_000, rating: 80, playCount: 12, mediaCount: 1, codecs: 'FLAC' },
    { trackId: 2, title: 'Blue in Green', artist: 'Miles Davis', album: 'Kind of Blue', year: 1959, lengthMs: 337_000, rating: null, playCount: 3, mediaCount: 1, codecs: 'MP3' }
  ]
}

const merged: MergeResult = { batchId: 'batch-1', survivor: 1, absorbed: [2], mediaMoved: 1, historyMoved: 3, playlistEntriesRepointed: 0 }

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

function show_page(): void {
  render(<><DuplicatesView /><Toasts /></>)
}

beforeEach(() => {
  localStorage.clear()
  install_bridge({
    'tracks:duplicates': [group],
    'tracks:mergePreview': { ids: [1, 2], survivor: 1, fields: [], media: [], statistics: { playCount: 15, skipCount: 0, rating: 80, firstPlayed: null, lastPlayed: null }, pinnedSources: [] },
    'tracks:merge': merged,
    'tracks:unmerge': { batchId: 'batch-1', restored: [2], survivor: 1 }
  })
})

afterEach(cleanup)

// ============================================================================
// Search
// ============================================================================

describe('duplicates view', () => {
  it('searches with the ways of matching switched on and the length tolerance', async () => {
    const calls = recorded_calls()
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
    const search = calls.find((call) => call.channel === 'tracks:duplicates')
    expect(search?.args[0]).toEqual({ reasons: ['audio_hash', 'tags', 'fuzzy'], lengthToleranceMs: 4000, limit: 200 })
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
    install_bridge({ 'tracks:duplicates': [] })
    show_page()

    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))

    expect(await screen.findByText('No duplicates found.')).toBeTruthy()
  })

  it('says why a search failed and searches again on Retry', async () => {
    let fails = true
    install_bridge({
      'tracks:duplicates': () => {
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
    const calls = recorded_calls()
    show_page()

    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))
    const panel = (await screen.findByText('Identical audio in 2 files')).closest('section')!
    await act(async () => fireEvent.click(within(panel).getByRole('button', { name: 'Quick merge' })))

    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('Merged 2 tracks into one')
    expect(within(panel).getByText('Merged')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Quick merge' })).toBeNull()
    expect(calls.find((call) => call.channel === 'tracks:merge')?.args[0]).toEqual({ ids: [1, 2], survivor: 1 })

    await act(async () => fireEvent.click(within(note).getByRole('button', { name: 'Undo' })))

    expect(calls.find((call) => call.channel === 'tracks:unmerge')?.args[0]).toBe('batch-1')
    expect(await within(panel).findByRole('button', { name: 'Quick merge' })).toBeTruthy()
  })
})
