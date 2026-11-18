// @vitest-environment jsdom
// Merging tracks: the sources side by side on X-Libs' merge grid, the picked winners sent as resolutions, and Undo in a toast.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Toasts } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { MergePreview, MergeResult } from '@shared/ipc'
import { MergeView } from '../src/web/widgets/MergeView.tsx'
import { record_calls } from './calls.ts'

const preview: MergePreview = {
  ids: ['track-11', 'track-12'],
  survivor: 'track-11',
  fields: [
    { field: 'title', name: 'Title', multi: false, conflict: false, value: 'Morning Tone' },
    { field: 'length', name: 'Length', multi: false, conflict: true, options: [{ from: 'track-11', value: 30_000 }, { from: 'track-12', value: 30_041 }] },
    { field: 'album', name: 'Album', multi: false, conflict: true, options: [{ from: 'track-11', value: 'First Light' }, { from: 'track-12', value: 'Live' }] },
    { field: 'genre', name: 'Genre', multi: true, conflict: true, options: [{ from: 'track-11', value: ['Ambient'] }, { from: 'track-12', value: ['Electronic'] }], union: ['Ambient', 'Electronic'] }
  ],
  media: [
    { id: 'file-1', from: 'track-11', uri: '/music/a.flac', codec: 'flac', bitrate: 900, present: true },
    { id: 'file-2', from: 'track-12', uri: '/music/b.mp3', codec: 'mp3', bitrate: 320, present: false }
  ],
  statistics: { play_count: 4, skip_count: 1, rating: 60, first_played: null, last_played: null },
  pinned_sources: []
}

const result: MergeResult = { batch_id: 'batch-1', survivor: 'track-11', absorbed: ['track-12'], media_moved: 1, history_moved: 0, playlist_entries_repointed: 0 }

afterEach(cleanup)

function cell_button(field: string, text: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name: field }).closest('tr')!
  return within(row).getByRole('button', { name: text })
}

describe('merge view', () => {
  it('lays the sources side by side with what disagrees as buttons', async () => {
    record_calls({ 'get_merge_preview': preview })

    render(<MergeView ids={['track-11', 'track-12']} />)

    expect(await screen.findByRole('table', { name: 'Tracks to merge' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /Source 1/ }).textContent).toContain('1 file')
    expect(cell_button('Album', 'First Light').getAttribute('aria-pressed')).toBe('true')
    expect(cell_button('Genre', 'Keep all').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('2 fields disagree; pick which value to keep')).toBeTruthy()
    expect(screen.getAllByText('0:30').length).toBeGreaterThan(0)
    const files = screen.getByRole('table', { name: 'Files the surviving track will hold' })
    expect(within(files).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['FLAC/music/a.flacSource 1', 'MP3/music/b.mp3 MissingSource 2'])
    // The switch is named once, by the words beside it.
    const only_differences = screen.getByRole('switch', { name: 'Only differences' })
    expect(only_differences.getAttribute('aria-label')).toBeNull()
    expect(only_differences.closest('label')?.textContent).toBe('Only differences')
  })

  it('warns that merging replaces an earlier decision made by hand', async () => {
    record_calls({ 'get_merge_preview': { ...preview, pinned_sources: ['track-11', 'track-12'] } })
    render(<MergeView ids={['track-11', 'track-12']} />)
    expect(await screen.findByText(/^2 sources of these were merged or split by hand before\./)).toBeTruthy()
    cleanup()

    record_calls({ 'get_merge_preview': { ...preview, pinned_sources: ['track-12'] } })
    render(<MergeView ids={['track-11', 'track-12']} />)
    expect(await screen.findByText(/^1 source of these was merged or split by hand before\./)).toBeTruthy()
  })

  it('sends the winners the grid shows, then offers Undo in a toast', async () => {
    const calls = record_calls({ 'get_merge_preview': preview, 'merge_tracks': result, 'undo_merge': { restored: 1 } })
    const on_close = vi.fn()
    const on_undone = vi.fn()

    render(<><MergeView ids={['track-11', 'track-12']} on_close={on_close} on_undone={on_undone} /><Toasts /></>)
    fireEvent.click(await screen.findByRole('button', { name: 'Live' }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() => expect(on_close).toHaveBeenCalledWith(true))
    expect(calls.find((call) => call.channel === 'merge_tracks')?.args).toEqual([
      ['track-11', 'track-12'], 'track-11',
      { length: { kind: 'value', from: 'track-11' }, album: { kind: 'value', from: 'track-12' }, genre: { kind: 'union' } }
    ])
    expect(screen.getByText('Merged 2 tracks into one holding 2 files')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(on_undone).toHaveBeenCalled())
    expect(calls.find((call) => call.channel === 'undo_merge')?.args).toEqual(['batch-1'])
  })

  it('takes every field and the survivor from one source', async () => {
    const calls = record_calls({ 'get_merge_preview': preview, 'merge_tracks': result })

    render(<MergeView ids={['track-11', 'track-12']} on_close={() => undefined} />)
    const second = await screen.findByRole('columnheader', { name: /Source 2/ })
    fireEvent.click(within(second).getByRole('button', { name: 'Take all from this' }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() => expect(calls.some((call) => call.channel === 'merge_tracks')).toBe(true))
    expect(calls.find((call) => call.channel === 'merge_tracks')?.args.slice(1)).toMatchObject([
      'track-12', { album: { kind: 'value', from: 'track-12' }, genre: { kind: 'value', from: 'track-12' } }
    ])
  })

  it('keeps the view open and says why when the merge fails', async () => {
    record_calls({ 'get_merge_preview': preview, 'merge_tracks': () => { throw new Error("Error invoking remote method 'merge_tracks': Error: the library is locked") } })
    const onclose = vi.fn()

    render(<><MergeView ids={['track-11', 'track-12']} on_close={onclose} /><Toasts /></>)
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not merge: the library is locked'))
    expect(onclose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy()
  })
})
