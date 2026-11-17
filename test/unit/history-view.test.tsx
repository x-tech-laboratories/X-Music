// @vitest-environment jsdom
// The History page: the latest track changes and merges in one list, what each version changed, restoring a version
// from a track's history, bringing back a removed track and undoing a merge, each after a confirm.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Dialogs } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { Toasts } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { MergeEntry, TrackSnapshot, Version } from '@shared/ipc'
import { changes_between, HistoryView } from '../../src/renderer/views/HistoryView'
import { record_calls, type Call } from '../helpers/calls'

// ============================================================================
// Fixtures
// ============================================================================

function snapshot(title: string, changes: Partial<TrackSnapshot['track']> = {}, genres: string[] = []): TrackSnapshot {
  return {
    track: {
      title, album_id: null, album: 'Kind of Blue', year: 1959, track_number: 1, disc_number: null, length_ms: 545_000, compilation: 0, bpm: null,
      mb_recording_id: null, acoustid: null, identity_source: 'heuristic', identity_key: null, pinned: 0, rating: null, loved: 0,
      rg_track_gain: null, rg_album_gain: null, added: 1_700_000_000_000, primary_media_id: null, play_count: 0, skip_count: 0,
      first_played: null, last_played: null, last_skipped: null, bookmark_ms: null, ...changes
    },
    values: [{ field_id: 1, value: 'Miles Davis', ordinal: 0 }, ...genres.map((genre, ordinal) => ({ field_id: 4, value: genre, ordinal }))],
    extras: [],
    media: ['file-1']
  }
}

const so_what = snapshot('So What', {}, ['Jazz'])
const so_what_rated = snapshot('So What', { rating: 80 }, ['Jazz', 'Modal'])

const edited: Version<TrackSnapshot> = {
  id: 'version-2', item_id: 'track-1', changed_at: '2026-11-10T12:00:00.000Z', kind: 'edited', origin: 'here', restored_from: null,
  snapshot: so_what_rated, previous: so_what
}
const created: Version<TrackSnapshot> = {
  id: 'version-1', item_id: 'track-1', changed_at: '2026-11-01T12:00:00.000Z', kind: 'created', origin: 'here', restored_from: null,
  snapshot: so_what, previous: null
}
const removed: Version<TrackSnapshot> = {
  id: 'version-9', item_id: 'track-2', changed_at: '2026-11-05T12:00:00.000Z', kind: 'deleted', origin: 'here', restored_from: null,
  snapshot: snapshot('Blue in Green'), previous: snapshot('Blue in Green')
}
const merge: MergeEntry = {
  batch_id: 'merge-a', at: Date.parse('2026-11-08T12:00:00.000Z'), survivor_id: 'track-3', survivor_title: 'Freddie Freeloader',
  absorbed: [{ id: 'track-4', title: 'Freddie Freeloader (copy)' }], undone: false
}
const undone_merge: MergeEntry = { ...merge, batch_id: 'merge-b', at: Date.parse('2026-11-02T12:00:00.000Z'), undone: true }

// ============================================================================
// Setup
// ============================================================================

let calls: Call[]
let history: Record<string, ReturnType<typeof vi.fn>>

function install_history(overrides: Record<string, (...args: never[]) => unknown> = {}): void {
  history = {
    list_recent_versions: vi.fn(async () => [edited, removed, created]),
    list_recent_merges: vi.fn(async () => [merge, undone_merge]),
    list_versions: vi.fn(async () => [edited, created]),
    restore_version: vi.fn(async () => undefined),
    ...Object.fromEntries(Object.entries(overrides).map(([name, answer]) => [name, vi.fn(async (...args: never[]) => answer(...args))]))
  }
  Object.assign(window, { xMusicHistory: history })
}

function show(): void {
  render(<><HistoryView /><Dialogs /><Toasts /></>)
}

const rows = async (): Promise<HTMLElement[]> => {
  const table = await screen.findByRole('table', { name: 'Latest changes' })
  return within(table).getAllByRole('row').slice(1)
}

beforeEach(() => {
  calls = record_calls({ 'tracks:unmerge': { batchId: 'merge-a', restored: ['track-4'], survivor: 'track-3' } })
  install_history()
})

afterEach(cleanup)

// ============================================================================
// Listing
// ============================================================================

describe('history page', () => {
  it('lists track changes and merges together, newest first', async () => {
    show()

    expect(screen.getByRole('heading', { level: 1, name: 'History' })).toBeTruthy()
    const listed = await rows()
    expect(listed.map((row) => row.textContent)).toEqual([
      expect.stringContaining('So What'),
      expect.stringContaining('Freddie Freeloader'),
      expect.stringContaining('Blue in Green'),
      expect.stringContaining('Merge undone'),
      expect.stringContaining('Added to the library')
    ])
    expect(listed[0]!.textContent).toContain('Edited')
    expect(listed[1]!.textContent).toContain('Took in Freddie Freeloader (copy)')
    expect(history.list_recent_versions).toHaveBeenCalledWith(50)
    expect(history.list_recent_merges).toHaveBeenCalledWith(50)
  })

  it('says what a version changed, field by field', async () => {
    show()

    const [first] = await rows()
    expect(first!.textContent).toContain('Rating')
    expect(first!.textContent).toContain('4 stars')
    expect(first!.textContent).toContain('Jazz, Modal')
  })

  it('shows only merges when asked', async () => {
    show()
    await rows()

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Show' })).getByRole('radio', { name: 'Merges' }))

    expect((await rows()).every((row) => row.textContent?.includes('Freddie Freeloader'))).toBe(true)
  })

  it('says when there is nothing yet', async () => {
    install_history({ list_recent_versions: () => [], list_recent_merges: () => [] })
    show()

    expect(await screen.findByText('No changes yet.')).toBeTruthy()
  })

  it('says why the history could not load and loads it again on Retry', async () => {
    let fails = true
    install_history({ list_recent_versions: () => { if (fails) throw new Error('database is locked'); return [] }, list_recent_merges: () => [] })
    show()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('database is locked')
    fails = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No changes yet.')).toBeTruthy()
  })
})

// ============================================================================
// Restoring
// ============================================================================

describe('restoring', () => {
  it('restores an earlier version from the track\'s history after a confirm', async () => {
    show()
    const [first] = await rows()

    fireEvent.click(within(first!).getByRole('button', { name: 'History of So What' }))
    const dialog = await screen.findByRole('dialog', { name: 'History of So What' })
    const versions = within(await within(dialog).findByRole('table')).getAllByRole('row').slice(1)
    expect(within(versions[0]!).queryByRole('button', { name: 'Restore' })).toBeNull()
    fireEvent.click(within(versions[1]!).getByRole('button', { name: 'Restore' }))

    const confirm = await screen.findByRole('dialog', { name: 'Restore So What?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(history.restore_version).not.toHaveBeenCalled()

    fireEvent.click(within(versions[1]!).getByRole('button', { name: 'Restore' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Restore So What?' })).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(history.restore_version).toHaveBeenCalledWith('version-1'))
    expect(await screen.findByText('So What is back as it was')).toBeTruthy()
    expect(calls.some((call) => call.channel === 'library:stats')).toBe(true)
  })

  it('brings back a removed track from the page', async () => {
    show()
    const removed_row = (await rows())[2]!

    fireEvent.click(within(removed_row).getByRole('button', { name: 'Bring back' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Bring back Blue in Green?' })).getByRole('button', { name: 'Bring back' }))

    await waitFor(() => expect(history.restore_version).toHaveBeenCalledWith('version-9'))
  })

  it('says why a restore failed', async () => {
    install_history({ restore_version: () => { throw new Error('no such version: version-9') } })
    show()

    fireEvent.click(within((await rows())[2]!).getByRole('button', { name: 'Bring back' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Bring back Blue in Green?' })).getByRole('button', { name: 'Bring back' }))

    expect(await screen.findByText(/Could not restore Blue in Green: .*no such version/)).toBeTruthy()
  })
})

// ============================================================================
// Merges
// ============================================================================

describe('merges', () => {
  it('undoes a merge after a confirm, and offers no Undo once undone', async () => {
    show()
    const listed = await rows()
    expect(within(listed[3]!).queryByRole('button', { name: 'Undo merge' })).toBeNull()

    fireEvent.click(within(listed[1]!).getByRole('button', { name: 'Undo merge' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Undo the merge into Freddie Freeloader?' })).getByRole('button', { name: 'Undo merge' }))

    await waitFor(() => expect(calls.some((call) => call.channel === 'tracks:unmerge' && call.args[0] === 'merge-a')).toBe(true))
    await waitFor(() => expect(screen.getAllByText('Merge undone').some((text) => !text.classList.contains('badge'))).toBe(true))
    await waitFor(() => expect(history.list_recent_merges).toHaveBeenCalledTimes(2))
  })
})

// ============================================================================
// Changes
// ============================================================================

describe('changes_between', () => {
  it('names each changed field with how it read before and after', () => {
    expect(changes_between(so_what, so_what_rated)).toEqual([
      { field: 'Rating', before: '', after: '4 stars' },
      { field: 'Genre', before: 'Jazz', after: 'Jazz, Modal' }
    ])
  })

  it('leaves out counts of plays, which are not edits', () => {
    expect(changes_between(so_what, { ...so_what, track: { ...so_what.track, play_count: 9 } })).toEqual([])
  })
})
