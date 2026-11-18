// @vitest-environment jsdom
// The lists beside the player: the queue names every queued track, removes one by button or Delete, and the playing track's facts.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { PlayerStatus, TrackDetails } from '@shared/ipc'
import { results } from '../src/web/stores/library.ts'
import { player_status } from '../src/web/stores/player.ts'
import { TabbedLists } from '../src/web/widgets/TabbedLists.tsx'
import { install_bridge } from './bridge.ts'

// ============================================================================
// Setup
// ============================================================================

const status = (queue: string[]): PlayerStatus => ({
  state: 'idle', track: null, media: null, position_ms: 0, duration_ms: null, volume: 80,
  repeat: 'off', shuffle: false, queue, context_length: 0, context_index: -1
})

const details = { id: '99', title: 'Hidden by the filters', fields: [{ field: 'artist', name: 'Artist', value: 'Sample Trio', multi: true }] } as unknown as TrackDetails
const dequeue = vi.fn(async () => status([]))
const move = vi.fn(async (_index: number, _to_index: number) => status(['1', '2', '3']))

beforeEach(() => {
  dequeue.mockClear()
  move.mockClear()
  install_bridge({ 'get_track': details, 'remove_from_queue': dequeue, 'move_in_queue': move })
  results.set({ stats: null, tracks: [], order: [], error: null })
})

afterEach(() => {
  cleanup()
  player_status.set(null)
})

// ============================================================================
// Queue
// ============================================================================

describe('queue', () => {
  it('names a queued track the library\'s filters hide', async () => {
    player_status.set(status(['99']))
    render(<TabbedLists />)

    expect(await screen.findByText('Hidden by the filters')).toBeTruthy()
    expect(screen.getByText('Sample Trio')).toBeTruthy()
    expect(screen.queryByText('Track 99')).toBeNull()
  })

  it('takes a track out with its remove button, named after it', async () => {
    player_status.set(status(['99']))
    render(<TabbedLists />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Hidden by the filters from the queue' }))

    expect(dequeue).toHaveBeenCalledWith(0)
  })

  it('takes the track under the keyboard out on Delete', async () => {
    player_status.set(status(['99']))
    render(<TabbedLists />)
    const row = (await screen.findByText('Hidden by the filters')).closest('tr')!

    fireEvent.keyDown(row, { key: 'Delete' })

    expect(dequeue).toHaveBeenCalledWith(0)
  })

  it('moves a track up and down with its row\'s buttons', async () => {
    player_status.set(status(['1', '2', '3']))
    render(<TabbedLists />)
    await screen.findAllByText('Hidden by the filters')
    const [first, second] = screen.getAllByRole('row').slice(1)

    expect((within(first!).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(first!).getByRole('button', { name: 'Move down' }))
    fireEvent.click(within(second!).getByRole('button', { name: 'Move up' }))

    expect(move.mock.calls).toEqual([[0, 1], [1, 0]])
  })

  it('moves the track under the keyboard with Alt and the arrow keys', async () => {
    player_status.set(status(['1', '2', '3']))
    render(<TabbedLists />)
    await screen.findAllByText('Hidden by the filters')
    const [, second, third] = screen.getAllByRole('row').slice(1)

    fireEvent.keyDown(second!, { key: 'ArrowDown', altKey: true })
    fireEvent.keyDown(third!, { key: 'ArrowDown', altKey: true })
    fireEvent.keyDown(second!, { key: 'ArrowUp', altKey: true })

    expect(move.mock.calls).toEqual([[1, 2], [1, 0]])
  })

  it('moves a dragged track to where it is dropped', async () => {
    player_status.set(status(['1', '2', '3']))
    render(<TabbedLists />)
    await screen.findAllByText('Hidden by the filters')
    const [first, , third] = screen.getAllByRole('row').slice(1)
    const dataTransfer = { types: [], setData: () => undefined, setDragImage: () => undefined, effectAllowed: '', dropEffect: '' }

    fireEvent.dragStart(first!, { dataTransfer })
    fireEvent.dragOver(third!, { dataTransfer })
    fireEvent.drop(third!, { dataTransfer })

    expect(move).toHaveBeenCalledWith(0, 2)
  })

  it('says so when nothing is queued', () => {
    player_status.set(status([]))
    render(<TabbedLists />)

    expect(screen.getByText('The queue is empty.')).toBeTruthy()
  })
})

// ============================================================================
// Now playing
// ============================================================================

describe('now playing', () => {
  it('shows the playing track\'s facts, or says nothing is playing', () => {
    render(<TabbedLists />)
    fireEvent.click(screen.getByRole('button', { name: 'Now playing' }))
    expect(screen.getByText('Nothing is playing.')).toBeTruthy()

    act(() => { player_status.set({ ...status([]), track: { id: '1', title: 'Song A', artist: 'Sample Trio', album: 'Album B', length_ms: 1000, rating: null } }) })
    expect(screen.getByText('Song A')).toBeTruthy()
  })
})
