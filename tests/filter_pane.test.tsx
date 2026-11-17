// @vitest-environment jsdom
// A filter pane: a listbox of a field's values named by its field, worked by keyboard, narrowing the library by every other pane.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { GroupRow } from '@shared/ipc'
import { browse } from '../src/web/stores/library'
import { FilterPane } from '../src/web/widgets/FilterPane'
import { install_bridge } from './bridge'

// ============================================================================
// Setup
// ============================================================================

const group = (label: string | null, n: number): GroupRow => ({ gid: label, label, n, total_ms: 0 })

const group_by = vi.fn(async (_filter: unknown, field: string): Promise<GroupRow[]> => field === 'rating'
  ? [group('80', 2), group('20', 1)]
  : [group('Blues', 3), group('Jazz', 5), group('Rock', 2), group(null, 4)])
const query = vi.fn(async () => [])

beforeEach(() => {
  localStorage.clear()
  group_by.mockClear()
  query.mockClear()
  install_bridge({ list_track_groups: group_by, list_tracks: query })
  browse.set({ sort: [], panes: {}, search: '' })
})

afterEach(cleanup)

const option = (name: RegExp | string) => screen.getByRole('option', { name })

// ============================================================================
// Behaviour
// ============================================================================

describe('filter pane', () => {
  it('is a listbox named by its field, so several panes tell apart', async () => {
    render(<><FilterPane id="first" field="genre" /><FilterPane id="second" field="album_artist" /></>)

    expect(await screen.findByRole('listbox', { name: 'Genre' })).toBeTruthy()
    expect(await screen.findByRole('listbox', { name: 'Album artist' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Genre' })).toBeTruthy()
  })

  it('lists each value with its count after All, and leaves out tracks with no value', async () => {
    render(<FilterPane field="genre" />)

    const list = await screen.findByRole('listbox', { name: 'Genre' })
    expect(within(list).getAllByRole('option').map((each) => each.textContent)).toEqual(['All14', 'Blues3', 'Jazz5', 'Rock2'])
    expect(option(/^All/).getAttribute('aria-selected')).toBe('true')
  })

  it('picks a value by keyboard and narrows the library to it', async () => {
    render(<FilterPane field="genre" />)
    await screen.findByRole('listbox', { name: 'Genre' })

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })

    expect(browse.get().panes).toEqual({ genre: ['Jazz'] })
    await vi.waitFor(() => expect(query).toHaveBeenCalledWith(expect.objectContaining({ field: 'genre', op: 'any', value: ['Jazz'] }), expect.anything()))
  })

  it('stretches the picks with Shift and goes back to All on Escape', async () => {
    render(<FilterPane field="genre" />)
    await screen.findByRole('listbox', { name: 'Genre' })

    fireEvent.click(option(/^Blues/))
    fireEvent.click(option(/^Rock/), { shiftKey: true })
    expect(browse.get().panes.genre).toEqual(['Blues', 'Jazz', 'Rock'])

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(browse.get().panes.genre).toEqual([])
  })

  it('offers every value of its own field while it narrows the others', async () => {
    browse.set({ sort: [], panes: { genre: ['Jazz'] }, search: '' })
    render(<><FilterPane id="first" field="genre" /><FilterPane id="second" field="album_artist" /></>)
    await screen.findByRole('listbox', { name: 'Album artist' })

    const asked = Object.fromEntries(group_by.mock.calls.map(([filter, field]) => [field, filter]))
    expect(asked.genre).toEqual({ op: 'and', children: [] })
    expect(asked.album_artist).toEqual(expect.objectContaining({ field: 'genre', value: ['Jazz'] }))
  })

  it('lets go of a remembered pick the library no longer holds', async () => {
    browse.set({ sort: [], panes: { genre: ['Jazz', 'Polka'] }, search: '' })
    render(<FilterPane field="genre" />)

    await vi.waitFor(() => expect(browse.get().panes.genre).toEqual(['Jazz']))
  })

  it('draws a rating as stars', async () => {
    render(<FilterPane field="rating" />)
    await screen.findByRole('listbox', { name: 'Rating' })

    expect(screen.getByRole('slider', { name: '4 stars' })).toBeTruthy()
  })

  it('remembers the field the user chose to browse by', async () => {
    render(<FilterPane id="first" field="genre" />)
    await screen.findByRole('listbox', { name: 'Genre' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Field to browse by' }), { target: { value: 'rating' } })

    expect(await screen.findByRole('listbox', { name: 'Rating' })).toBeTruthy()
    expect(localStorage.getItem('x-music.pref.pane.first.field')).toBe('"rating"')
  })
})
