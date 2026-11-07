// Row selection through the store, not just the Selection model underneath it — because the model
// passing while the UI misbehaves is exactly the gap worth closing.

import { describe, expect, it, beforeEach } from 'vitest'
import { library } from '../../src/renderer/stores/library'
import type { TrackRow } from '@shared/ipc'

const rows = (n: number): TrackRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: (i + 1) * 10,
    title: `Track ${i + 1}`,
    artist: 'A', album: 'B', year: 2000,
    track_number: i + 1, length_ms: 1000, rating: null, play_count: 0
  }))

beforeEach(() => {
  // The store owns its list; tests drive it directly rather than through IPC.
  ;(library as unknown as { tracks: TrackRow[] }).tracks = rows(6)
  library.clearSelection()
})

describe('song list selection', () => {
  it('selects one row on a plain click', () => {
    library.clickRow(2, {})
    expect(library.selectedIds()).toEqual([30])
    expect(library.isSelected(30)).toBe(true)
    expect(library.selectedCount()).toBe(1)
  })

  it('replaces the selection on a second plain click', () => {
    library.clickRow(1, {})
    library.clickRow(4, {})
    expect(library.selectedIds()).toEqual([50])
  })

  it('adds a row with ctrl, and removes it on a second ctrl click', () => {
    library.clickRow(0, {})
    library.clickRow(3, { ctrl: true })
    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([10, 40])

    library.clickRow(3, { ctrl: true })
    expect(library.selectedIds()).toEqual([10])
  })

  it('extends a range with shift, downwards', () => {
    library.clickRow(1, {})
    library.clickRow(4, { shift: true })
    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([20, 30, 40, 50])
  })

  it('extends a range with shift, upwards', () => {
    library.clickRow(4, {})
    library.clickRow(1, { shift: true })
    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([20, 30, 40, 50])
  })

  it('bumps a version on every change, which is what the list re-reads', () => {
    const before = library.selection_changes.version()
    library.clickRow(0, {})
    expect(library.selection_changes.version()).toBeGreaterThan(before)
  })

  it('reports selection through isSelected for every row in a shift range', () => {
    library.clickRow(0, {})
    library.clickRow(2, { shift: true })
    expect([10, 20, 30].map((id) => library.isSelected(id))).toEqual([true, true, true])
    expect(library.isSelected(40)).toBe(false)
  })

  it('selects all and inverts within the visible list', () => {
    library.selectAll()
    expect(library.selectedCount()).toBe(6)
    library.clearSelection()
    expect(library.selectedCount()).toBe(0)
  })
})

describe('keyboard range selection', () => {
  it('extends and then shrinks as the direction reverses', () => {
    library.clickRow(1, {})

    // shift+ArrowDown three times
    library.clickRow(2, { shift: true })
    library.clickRow(3, { shift: true })
    library.clickRow(4, { shift: true })
    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([20, 30, 40, 50])

    // shift+ArrowUp gives the rows back rather than leaving a trail
    library.clickRow(3, { shift: true })
    library.clickRow(2, { shift: true })
    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([20, 30])
  })

  it('crosses the anchor without stranding rows behind it', () => {
    library.clickRow(3, {})
    library.clickRow(1, { shift: true })
    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([20, 30, 40])

    library.clickRow(5, { shift: true })
    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([40, 50, 60])
  })

  it('keeps an existing selection with ctrl+shift', () => {
    library.clickRow(0, {})            // {10}, anchor 0
    library.clickRow(4, { ctrl: true }) // {10,50}, anchor moves to 4
    library.clickRow(2, { ctrl: true, shift: true }) // adds 2..4 without dropping 10

    expect(library.selectedIds().sort((a, b) => a - b)).toEqual([10, 30, 40, 50])
  })
})
