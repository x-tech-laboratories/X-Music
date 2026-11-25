// @vitest-environment jsdom
// The song list on the X-Libs table: the whole library reachable, playing, keyboard selection, sorting and the filter chips.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api_method_names, type TrackRow } from '@shared/ipc'
import { browse, library, results } from '../src/web/stores/library.ts'
import { player, player_status } from '../src/web/stores/player.ts'
import { SongList } from '../src/web/widgets/SongList.tsx'
import { install_bridge } from './bridge.ts'

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

const stats = (count: number) => ({ tracks: count, media: count, albums: 1, missing: 0, total_ms: 0, schema_version: 4, path: '/tmp/x.db' })

const calls = new Map<string, ReturnType<typeof vi.fn>>()

// A bridge that records every call and answers the library's query with the given tracks.
function bridge(listed: TrackRow[]): void {
  calls.clear()
  const answers: Record<string, unknown> = {
    'list_tracks': listed,
    'get_library_stats': stats(listed.length),
    'list_track_groups': [],
    'get_track': new Promise(() => undefined),
    'get_merge_preview': new Promise(() => undefined),
    'get_player_status': { state: 'idle', track: null, media: null, position_ms: 0, duration_ms: null, volume: 80, repeat: 'off', shuffle: false, queue: [], context_length: 0, context_index: -1 }
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
  history.replaceState(null, '', '#/library')
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

    await vi.waitFor(() => expect(calls.get('list_tracks')).toHaveBeenCalledWith(expect.anything(), [{ field: 'title', descending: false }]))
  })

  it('marks the playing track with Halon\'s now-playing row', () => {
    player_status.set({ state: 'playing', track: { id: 'track-20' }, position_ms: 0, duration_ms: 61_000 } as unknown as typeof player.status)
    render(<SongList />)

    expect(row('Track 2').classList.contains('now-playing')).toBe(true)
    expect(row('Track 1').classList.contains('now-playing')).toBe(false)
  })

  it('draws a rating as stars', () => {
    show([{ ...tracks(1)[0]!, rating: 60 }])
    render(<SongList />)

    expect(screen.getByRole('slider', { name: 'Rating of Track 1' }).getAttribute('aria-valuetext')).toBe('3 stars')
  })

  it('rates a track by its stars, showing the new rating before the answer comes', async () => {
    render(<SongList />)

    const stars = screen.getByRole('slider', { name: 'Rating of Track 2' })
    fireEvent.click(within(stars).getByRole('button', { name: '4 stars' }))

    expect(calls.get('set_rating')).toHaveBeenCalledWith(['track-20'], 80)
    expect(stars.getAttribute('aria-valuetext')).toBe('4 stars')
    await vi.waitFor(() => expect(calls.get('list_tracks')).toHaveBeenCalled())
  })

  it('rates the picked tracks with a number key, and 0 makes them unrated', () => {
    render(<SongList />)
    fireEvent.click(row('Track 1'))
    fireEvent.click(row('Track 3'), { ctrlKey: true })

    fireEvent.keyDown(row('Track 3'), { key: '5' })
    expect(calls.get('set_rating')).toHaveBeenLastCalledWith(['track-10', 'track-30'], 100)

    fireEvent.keyDown(row('Track 3'), { key: '0' })
    expect(calls.get('set_rating')).toHaveBeenLastCalledWith(['track-10', 'track-30'], null)
  })

  it('rates only the row under the cursor when it is not picked', () => {
    render(<SongList />)
    fireEvent.click(row('Track 1'))

    fireEvent.keyDown(row('Track 2'), { key: '2' })

    expect(calls.get('set_rating')).toHaveBeenCalledWith(['track-20'], 40)
  })

  it('leaves keys the stars handled to the stars', () => {
    render(<SongList />)

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Rating of Track 1' }), { key: '0' })

    expect(calls.get('set_rating')).toHaveBeenCalledTimes(1)
    expect(calls.get('set_rating')).toHaveBeenCalledWith(['track-10'], null)
  })

  it('shows the rating the picked tracks share in the selection bar, and rates them all from it', () => {
    show([{ ...tracks(3)[0]!, rating: 60 }, { ...tracks(3)[1]!, rating: 60 }, { ...tracks(3)[2]!, rating: 20 }])
    render(<SongList />)
    fireEvent.click(row('Track 1'))
    fireEvent.click(row('Track 2'), { ctrlKey: true })

    const bar = screen.getByRole('toolbar', { name: 'Selected rows' })
    const stars = within(bar).getByRole('slider', { name: 'Rating of the picked tracks' })
    expect(stars.getAttribute('aria-valuetext')).toBe('3 stars')

    fireEvent.click(row('Track 3'), { ctrlKey: true })
    expect(within(bar).getByRole('slider', { name: 'Rating of the picked tracks' }).getAttribute('aria-valuetext')).toBe('Unrated')

    fireEvent.click(within(bar).getByRole('button', { name: '1 star' }))
    expect(calls.get('set_rating')).toHaveBeenCalledWith(['track-10', 'track-20', 'track-30'], 20)
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

  it('shows each term of the search as a chip, and its remove button takes that term out of the text', async () => {
    calls.get('list_track_groups')!.mockImplementation(async () => [{ group_id: 1, label: 'Jazz', count: 3, total_ms: 0 }])
    browse.set({ sort: [], panes: {}, search: 'blue genre:jazz rating:>3' })
    await library.refresh()
    render(<SongList />)

    expect(screen.getAllByRole('button', { name: /^Remove the filter/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Remove the filter "blue"', 'Remove the filter Genre has "jazz"', 'Remove the filter Rating over 3'
    ])
    expect(calls.get('list_track_groups')).toHaveBeenCalledWith({ op: 'and', children: [] }, 'genre')
    expect(calls.get('list_tracks')!.mock.calls.at(-1)![0]).toEqual({ op: 'and', children: [
      { field: 'title', op: 'matches', value: '"blue"*' },
      { field: 'genre', op: 'any', value: ['Jazz'] },
      { field: 'rating', op: '>', value: 60 }
    ] })

    fireEvent.click(screen.getByRole('button', { name: 'Remove the filter Genre has "jazz"' }))
    await vi.waitFor(() => expect(browse.get().search).toBe('blue rating:>3'))
  })

  it('says how many of the library\'s tracks the filters let through', () => {
    results.set({ stats: stats(40), tracks: tracks(3), order: ['track-10', 'track-20', 'track-30'], error: null })
    render(<SongList />)

    expect(screen.getByText('3 of 40 tracks')).toBeTruthy()
  })

  it('names the keys as X-Libs writes them, each in a key cap', () => {
    render(<SongList />)

    expect(screen.getByText(/rate, right-click for more/)).toBeTruthy()
    expect(screen.getByText('Enter').tagName).toBe('KBD')
    expect(screen.getByText('5').tagName).toBe('KBD')
  })
})

// ============================================================================
// Pages over the list
// ============================================================================

describe('pages over the song list', () => {
  it('opens a track\'s properties at an address of their own, which Back closes', async () => {
    render(<SongList />)

    act(() => void fireEvent.keyDown(row('Track 2'), { key: 'Enter', altKey: true }))

    await waitFor(() => expect(location.hash).toBe('#/library/properties/track-20'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    act(() => history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(location.hash).toBe('#/library')
  })

  it('shows the properties a reload lands on, and Close goes back to the library', async () => {
    history.replaceState(null, '', '#/library/properties/track-30')
    render(<SongList />)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(location.hash).toBe('#/library')
  })

  it('opens a merge of the picked tracks at an address naming them', async () => {
    render(<SongList />)
    fireEvent.click(row('Track 1'))
    fireEvent.click(row('Track 3'), { ctrlKey: true })

    fireEvent.click(screen.getByRole('button', { name: 'Merge…' }))

    await waitFor(() => expect(location.hash).toBe('#/library/merge/track-10/track-30'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

// ============================================================================
// Random sort
// ============================================================================

describe('a random sort', () => {
  it('asks for the same shuffle each time the list is fetched again', async () => {
    await library.set_sorting([{ key: 'random', descending: false }])
    const [key] = browse.get().sort
    expect(Number.isInteger(key!.seed)).toBe(true)

    await library.refresh()
    await library.set_sorting([{ key: 'random', descending: true }])

    const sorts = calls.get('list_tracks')!.mock.calls.map((call) => call[1])
    expect(sorts).toEqual([
      [{ field: 'random', descending: false, seed: key!.seed }],
      [{ field: 'random', descending: false, seed: key!.seed }],
      [{ field: 'random', descending: true, seed: key!.seed }]
    ])
  })
})
