// @vitest-environment jsdom
// The song list on the X-Libs table: playing, keyboard selection and sorting reach the stores.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TrackRow } from '@shared/ipc'
import { library } from '../../src/renderer/stores/library'
import { SongList } from '../../src/renderer/widgets/SongList'

// ============================================================================
// Setup
// ============================================================================

const tracks = (count: number): TrackRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: (index + 1) * 10,
    title: `Track ${index + 1}`,
    artist: 'A', album: 'B', year: 2000,
    track_number: index + 1, length_ms: 61_000, rating: null, play_count: 0
  }))

const calls = new Map<string, ReturnType<typeof vi.fn>>()

const bridge = new Proxy({}, {
  get: (_target, channel: string) => {
    if (!calls.has(channel)) {
      const answer = channel === 'library:query' ? tracks(3)
        : channel === 'library:explain' ? { sql: '' }
        : channel.startsWith('player:') ? { state: 'idle', track: null, media: null, positionMs: 0, durationMs: null, volume: 80, repeat: 'off', shuffle: false, queue: [], contextLength: 0, contextIndex: -1 }
        : null
      calls.set(channel, vi.fn(async () => answer))
    }
    return calls.get(channel)
  }
})

beforeEach(() => {
  calls.clear()
  // jsdom lays nothing out, so there is nothing to scroll.
  Element.prototype.scrollIntoView = () => {}
  Object.assign(window, { xMusic: bridge, xMusicEvents: { on: () => () => {} } })
  ;(library as unknown as { tracks: TrackRow[] }).tracks = tracks(3)
  library.clearSelection()
})

afterEach(cleanup)

const row = (title: string): HTMLElement => screen.getByText(title).closest('tr')!

// ============================================================================
// Behaviour
// ============================================================================

describe('song list', () => {
  it('plays a double-clicked row with the whole list as its context', () => {
    render(<SongList />)

    fireEvent.doubleClick(row('Track 2'))

    expect(calls.get('player:playTrack')).toHaveBeenCalledWith({ trackId: 20, context: [10, 20, 30], index: 1 })
  })

  it('plays the row under the keyboard cursor on Enter', () => {
    render(<SongList />)

    fireEvent.keyDown(row('Track 3'), { key: 'Enter' })

    expect(calls.get('player:playTrack')).toHaveBeenCalledWith({ trackId: 30, context: [10, 20, 30], index: 2 })
  })

  it('extends the selection with Shift and an arrow key', () => {
    render(<SongList />)

    fireEvent.click(row('Track 1'))
    fireEvent.keyDown(row('Track 1'), { key: 'ArrowDown', shiftKey: true })

    expect(library.selectedIds().sort()).toEqual([10, 20])
    expect(row('Track 2').getAttribute('aria-selected')).toBe('true')
  })

  it('asks the library for a new sort when a header is clicked', async () => {
    render(<SongList />)

    fireEvent.click(screen.getByRole('button', { name: /^Title/ }))

    await vi.waitFor(() => expect(calls.get('library:query')).toHaveBeenCalledWith(expect.objectContaining({ sort: [{ field: 'title', dir: 'asc' }] })))
  })

  it('shows lengths as clock times', () => {
    render(<SongList />)

    expect(screen.getAllByText('1:01')).toHaveLength(3)
  })
})
