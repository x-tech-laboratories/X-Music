// @vitest-environment jsdom
// The song list on the X-Libs table: the whole library reachable, playing, keyboard selection, sorting and the filter chips.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { api_method_names, type TrackRow } from '@shared/ipc'
import { browse, library, results } from '../src/web/stores/library'
import { player, player_status } from '../src/web/stores/player'
import { SongList } from '../src/web/widgets/SongList'
import { install_bridge } from './bridge'

// ============================================================================
// Setup
// ============================================================================

const tracks = (count: number): TrackRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `track-${(index + 1) * 10}`,
    title: `Track ${index + 1}`,
    artist: 'A', album: 'B', year: 2000,
    track_number: index + 1, length_ms: 61_000, rating: null, play_count: 0
  }))

const stats = (count: number) => ({ tracks: count, media: count, albums: 1, missing: 0, totalMs: 0, schemaVersion: 4, path: '/tmp/x.db' })

const calls = new Map<string, ReturnType<typeof vi.fn>>()

// A bridge that records every call and answers the library's query with the given tracks.
function bridge(listed: TrackRow[]): void {
  calls.clear()
  const answers: Record<string, unknown> = {
    'list_tracks': listed,
    'get_library_stats': stats(listed.length),
    'list_track_groups': [],
    'get_player_status': { state: 'idle', track: null, media: null, positionMs: 0, durationMs: null, volume: 80, repeat: 'off', shuffle: false, queue: [], contextLength: 0, contextIndex: -1 }
  }
  // A plain object of every channel, as the preload exposes it.
  for (const channel of api_method_names) calls.set(channel, vi.fn(async () => answers[channel] ?? answers.get_player_status))
  Object.assign(window, { xMusic: Object.fromEntries(calls), xMusicEvents: { on: () => () => {} } })
}

function show(listed: TrackRow[]): void {
  results.set({ stats: stats(listed.length), tracks: listed, order: listed.map((track) => track.id), error: null })
}

beforeEach(() => {
  bridge(tracks(3))
  show(tracks(3))
  browse.set({ sort: [], panes: {}, search: '' })
  library.clear_selection()
  player_status.set(null)
})

afterEach(cleanup)

const row = (title: string): HTMLElement => screen.getByText(title).closest('tr')!

// ============================================================================
// The whole library
// ============================================================================

describe('the whole library', () => {
  it('asks for every track, with no limit on how many', async () => {
    install_bridge()
    bridge(tracks(3))

    await library.refresh()

    expect(calls.get('list_tracks')).toHaveBeenCalledTimes(1)
    expect(calls.get('list_tracks')!.mock.calls[0]![2]).toBeUndefined()
  })

  it('draws only the rows in view of a long list and reaches the last one by keyboard', () => {
    show(tracks(5000))
    render(<SongList />)

    expect(screen.getAllByRole('row').length).toBeLessThan(200)
    fireEvent.click(row('Track 1'))
    fireEvent.keyDown(row('Track 1'), { key: 'End' })

    expect(row('Track 5000')).toBeTruthy()
    expect(screen.getByText('5,000 tracks')).toBeTruthy()
  })

  it('draws only the cards in view of a long list on a phone', () => {
    const before = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
    show(tracks(5000))
    render(<SongList />)
    window.matchMedia = before

    expect(screen.getAllByRole('row').length).toBeLessThan(200)
  })

  it('keeps every cell on one line', () => {
    render(<SongList />)

    const wrap = screen.getByRole('table').closest('.table-wrap')!
    expect(wrap.classList.contains('fit')).toBe(true)
    expect(wrap.classList.contains('virtual')).toBe(true)
  })
})

// ============================================================================
// Playing and picking
// ============================================================================

describe('song list', () => {
  it('plays a double-clicked row with the whole list as its context', () => {
    render(<SongList />)

    fireEvent.doubleClick(row('Track 2'))

    expect(calls.get('play_track')).toHaveBeenCalledWith('track-20', ['track-10', 'track-20', 'track-30'], 1)
  })

  it('plays the row under the keyboard cursor on Enter', () => {
    render(<SongList />)

    fireEvent.keyDown(row('Track 3'), { key: 'Enter' })

    expect(calls.get('play_track')).toHaveBeenCalledWith('track-30', ['track-10', 'track-20', 'track-30'], 2)
  })

  it('extends the selection with Shift and an arrow key', () => {
    render(<SongList />)

    fireEvent.click(row('Track 1'))
    fireEvent.keyDown(row('Track 1'), { key: 'ArrowDown', shiftKey: true })

    expect(library.selected_ids()).toEqual(['track-10', 'track-20'])
    expect(row('Track 2').getAttribute('aria-selected')).toBe('true')
  })

  it('shows the picked rows in X-Libs\' selection bar, which queues them and lets them go', () => {
    render(<SongList />)

    fireEvent.click(row('Track 1'))
    fireEvent.click(row('Track 3'), { ctrlKey: true })
    const bar = screen.getByRole('toolbar', { name: 'Selected rows' })
    expect(within(bar).getByText('2 selected')).toBeTruthy()

    fireEvent.click(within(bar).getByRole('button', { name: 'Add to queue' }))
    expect(calls.get('queue_tracks')).toHaveBeenCalledWith(['track-10', 'track-30'], 'end')

    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('toolbar', { name: 'Selected rows' })).toBeNull()
  })

  it('asks the library for a new sort when a header is clicked', async () => {
    render(<SongList />)

    fireEvent.click(screen.getByRole('button', { name: /^Title/ }))

    await vi.waitFor(() => expect(calls.get('list_tracks')).toHaveBeenCalledWith(expect.anything(), [{ field: 'title', dir: 'asc' }]))
  })

  it('marks the playing track with Halon\'s now-playing row', () => {
    player_status.set({ state: 'playing', track: { id: 'track-20' }, positionMs: 0, durationMs: 61_000 } as unknown as typeof player.status)
    render(<SongList />)

    expect(row('Track 2').classList.contains('now-playing')).toBe(true)
    expect(row('Track 1').classList.contains('now-playing')).toBe(false)
  })

  it('draws a rating as stars', () => {
    show([{ ...tracks(1)[0]!, rating: 60 }])
    render(<SongList />)

    expect(screen.getByRole('slider', { name: 'Rating' }).getAttribute('aria-valuetext')).toBe('3 stars')
  })

  it('shows lengths as clock times', () => {
    render(<SongList />)

    expect(screen.getAllByText('1:01')).toHaveLength(3)
  })

  it('says so when no track passes the filters', () => {
    show([])
    render(<SongList />)

    expect(screen.getByText('No tracks match.')).toBeTruthy()
  })
})

// ============================================================================
// Filters
// ============================================================================

describe('filter chips', () => {
  it('names each chip\'s remove button and takes the filter off with it', async () => {
    browse.set({ sort: [], panes: { genre: ['Jazz'] }, search: '' })
    render(<SongList />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove the filter Genre: Jazz' }))

    await vi.waitFor(() => expect(browse.get().panes).toEqual({}))
    expect(calls.get('list_tracks')).toHaveBeenCalledWith(expect.anything(), expect.anything())
  })

  it('says how many of the library\'s tracks the filters let through', () => {
    results.set({ stats: stats(40), tracks: tracks(3), order: ['track-10', 'track-20', 'track-30'], error: null })
    render(<SongList />)

    expect(screen.getByText('3 of 40 tracks')).toBeTruthy()
  })

  it('names the keys as X-Libs writes them, each in a key cap', () => {
    render(<SongList />)

    expect(screen.getByText(/plays, right-click for more/)).toBeTruthy()
    expect(screen.getByText('Enter').tagName).toBe('KBD')
  })
})
