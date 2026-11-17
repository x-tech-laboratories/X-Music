// @vitest-environment jsdom
// The lists beside the player: the queue names every queued track, removes one by button or Delete, and the playing track's facts.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PlayerStatus, TrackDetails } from '@shared/ipc'
import { results } from '../../src/renderer/stores/library'
import { player } from '../../src/renderer/stores/player'
import { TabbedLists } from '../../src/renderer/widgets/TabbedLists'
import { install_bridge } from '../helpers/bridge'

// ============================================================================
// Setup
// ============================================================================

const status = (queue: number[]): PlayerStatus => ({
  state: 'idle', track: null, media: null, positionMs: 0, durationMs: null, volume: 80,
  repeat: 'off', shuffle: false, queue, contextLength: 0, contextIndex: -1
})

const details = { id: 99, title: 'Hidden by the filters', fields: [{ field: 'artist', name: 'Artist', value: 'Sample Trio', multi: true }] } as unknown as TrackDetails
const dequeue = vi.fn(async () => status([]))

beforeEach(() => {
  dequeue.mockClear()
  install_bridge({ 'tracks:details': details, 'player:dequeue': dequeue })
  const bridge = window.xMusic as unknown as Record<string, unknown>
  Object.assign(window, { xMusic: new Proxy(bridge, { get: (target, channel: string) => channel === 'player:dequeue' ? dequeue : target[channel] }) })
  results.set({ stats: null, tracks: [], order: [], error: null })
})

afterEach(() => {
  cleanup()
  player.status = null
})

// ============================================================================
// Queue
// ============================================================================

describe('queue', () => {
  it('names a queued track the library\'s filters hide', async () => {
    player.status = status([99])
    render(<TabbedLists />)

    expect(await screen.findByText('Hidden by the filters')).toBeTruthy()
    expect(screen.getByText('Sample Trio')).toBeTruthy()
    expect(screen.queryByText('Track 99')).toBeNull()
  })

  it('takes a track out with its remove button, named after it', async () => {
    player.status = status([99])
    render(<TabbedLists />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Hidden by the filters from the queue' }))

    expect(dequeue).toHaveBeenCalledWith(0)
  })

  it('takes the track under the keyboard out on Delete', async () => {
    player.status = status([99])
    render(<TabbedLists />)
    const row = (await screen.findByText('Hidden by the filters')).closest('tr')!

    fireEvent.keyDown(row, { key: 'Delete' })

    expect(dequeue).toHaveBeenCalledWith(0)
  })

  it('says so when nothing is queued', () => {
    player.status = status([])
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

    act(() => { player.status = { ...status([]), track: { id: 1, title: 'Song A', artist: 'Sample Trio', album: 'Album B', lengthMs: 1000, rating: null } } })
    expect(screen.getByText('Song A')).toBeTruthy()
  })
})
