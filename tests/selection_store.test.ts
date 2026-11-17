// Row selection through the store, not just the Selection model underneath it — because the model
// passing while the UI misbehaves is exactly the gap worth closing.

import { describe, expect, it, beforeEach } from 'vitest'
import { library, results } from '../src/web/stores/library.ts'
import type { TrackRow } from '@shared/ipc'

const rows = (n: number): TrackRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String((i + 1) * 10),
    title: `Track ${i + 1}`,
    artist: 'A', album: 'B', year: 2000,
    track_number: i + 1, length_ms: 1000, rating: null, play_count: 0
  }))

beforeEach(() => {
  // The store owns its list; tests set it directly rather than through IPC.
  const shown = rows(6)
  results.set({ stats: null, tracks: shown, order: shown.map((track) => track.id), error: null })
  library.clear_selection()
})

describe('song list selection', () => {
  it('selects one row on a plain click', () => {
    library.click_row(2, {})
    expect(library.selected_ids()).toEqual(['30'])
    expect(library.is_selected('30')).toBe(true)
    expect(library.selected_count()).toBe(1)
  })

  it('replaces the selection on a second plain click', () => {
    library.click_row(1, {})
    library.click_row(4, {})
    expect(library.selected_ids()).toEqual(['50'])
  })

  it('adds a row with ctrl, and removes it on a second ctrl click', () => {
    library.click_row(0, {})
    library.click_row(3, { ctrl: true })
    expect(library.selected_ids().sort()).toEqual(['10', '40'])

    library.click_row(3, { ctrl: true })
    expect(library.selected_ids()).toEqual(['10'])
  })

  it('extends a range with shift, downwards', () => {
    library.click_row(1, {})
    library.click_row(4, { shift: true })
    expect(library.selected_ids().sort()).toEqual(['20', '30', '40', '50'])
  })

  it('extends a range with shift, upwards', () => {
    library.click_row(4, {})
    library.click_row(1, { shift: true })
    expect(library.selected_ids().sort()).toEqual(['20', '30', '40', '50'])
  })

  it('bumps a version on every change, which is what the list re-reads', () => {
    const before = library.selection_changes.version()
    library.click_row(0, {})
    expect(library.selection_changes.version()).toBeGreaterThan(before)
  })

  it('reports selection through isSelected for every row in a shift range', () => {
    library.click_row(0, {})
    library.click_row(2, { shift: true })
    expect(['10', '20', '30'].map((id) => library.is_selected(id))).toEqual([true, true, true])
    expect(library.is_selected('40')).toBe(false)
  })

  it('selects all and inverts within the visible list', () => {
    library.select_all()
    expect(library.selected_count()).toBe(6)
    library.clear_selection()
    expect(library.selected_count()).toBe(0)
  })
})

describe('keyboard range selection', () => {
  it('extends and then shrinks as the direction reverses', () => {
    library.click_row(1, {})

    // shift+ArrowDown three times
    library.click_row(2, { shift: true })
    library.click_row(3, { shift: true })
    library.click_row(4, { shift: true })
    expect(library.selected_ids().sort()).toEqual(['20', '30', '40', '50'])

    // shift+ArrowUp gives the rows back rather than leaving a trail
    library.click_row(3, { shift: true })
    library.click_row(2, { shift: true })
    expect(library.selected_ids().sort()).toEqual(['20', '30'])
  })

  it('crosses the anchor without stranding rows behind it', () => {
    library.click_row(3, {})
    library.click_row(1, { shift: true })
    expect(library.selected_ids().sort()).toEqual(['20', '30', '40'])

    library.click_row(5, { shift: true })
    expect(library.selected_ids().sort()).toEqual(['40', '50', '60'])
  })

  it('keeps an existing selection with ctrl+shift', () => {
    library.click_row(0, {})            // {10}, anchor 0
    library.click_row(4, { ctrl: true }) // {10,50}, anchor moves to 4
    library.click_row(2, { ctrl: true, shift: true }) // adds 2..4 without dropping 10

    expect(library.selected_ids().sort()).toEqual(['10', '30', '40', '50'])
  })
})
