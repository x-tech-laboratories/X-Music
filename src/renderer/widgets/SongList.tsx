// The library's tracks in the X-Libs table: the library sorts them, the table shows the sort, and the list adds keyboard selection and playing.

import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Chip, Chips } from '@x-tech-laboratories/x-libs/web/react/badges'
import { SearchBox } from '@x-tech-laboratories/x-libs/web/react/controls'
import { open_context_menu } from '@x-tech-laboratories/x-libs/web/react/menus'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { row_after_key } from '@x-tech-laboratories/x-libs/web/selection'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import type { TrackRow } from '@shared/ipc'
import { field } from '@shared/fields'
import { library } from '../stores/library'
import { player } from '../stores/player'
import { logger } from '../lib/log'
import { Stars } from './Stars'
import { MergeView } from './MergeView'
import { SongProperties } from './SongProperties'

const log = logger('songlist')

// ============================================================================
// Columns
// ============================================================================

const column = (id: string, width: number, cell: (track: TrackRow) => ReactNode, number = false): TableColumn<TrackRow> => ({
  id,
  label: field(id).name,
  width,
  min_width: 44,
  cell,
  class: number ? 'number' : undefined
})

const columns: TableColumn<TrackRow>[] = [
  column('track_number', 56, (track) => track.track_number ?? '', true),
  column('title', 320, (track) => track.title ?? ''),
  column('artist', 220, (track) => track.artist ?? ''),
  column('album', 220, (track) => track.album ?? ''),
  column('year', 60, (track) => track.year ?? '', true),
  column('length', 70, (track) => format_clock(track.length_ms, ''), true),
  column('rating', 96, (track) => <Stars value={track.rating} />),
  column('play_count', 60, (track) => track.play_count, true)
]

type Modifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

// ============================================================================
// Song list
// ============================================================================

export function SongList() {
  use_watch(library.data)
  use_watch(library.selection_changes)
  use_watch(player.status_changes)

  const [merging, set_merging] = useState<number[] | null>(null)
  const [inspecting, set_inspecting] = useState<number | null>(null)
  // The keyboard cursor: which row arrow keys move from.
  const [cursor, set_cursor] = useState(0)
  const body = useRef<HTMLDivElement>(null)

  // Column layout is remembered per column id, so adding or reordering columns keeps the rest.
  const [widths, set_widths] = use_pref<Record<string, number>>('x-music.pref.songlist.widths', {})
  const [order, set_order] = use_pref<string[]>('x-music.pref.songlist.order', [])
  const [hidden, set_hidden] = use_pref<string[]>('x-music.pref.songlist.hidden', [])
  // Widths while an edge is dragged, kept once it is let go.
  const [dragged_widths, set_dragged_widths] = useState<Record<string, number> | null>(null)

  const tracks = library.tracks
  const positions = new Map(tracks.map((track, index) => [track.id, index]))
  const index_of = (track: TrackRow): number => positions.get(track.id) ?? 0

  function focus_row(index: number): void {
    const id = tracks[index]?.id
    const row = body.current?.querySelector<HTMLElement>(`tr[data-row-key="${id}"]`)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  }

  function select_row(index: number, event: Modifiers): void {
    const modifiers = { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }
    const anchor_before = library.inspectSelection().anchor
    library.clickRow(index, modifiers)

    // Which rows ended up selected, not just how many: a wrong range is usually a wrong anchor.
    const rows = library.selectedIds().map((id) => positions.get(id) ?? -1).filter((n) => n >= 0).sort((a, b) => a - b)
    log.debug('row clicked', {
      clicked: index,
      ...modifiers,
      anchorBefore: anchor_before,
      anchorAfter: library.inspectSelection().anchor,
      count: rows.length,
      rows: rows.length > 8 ? `${rows[0]}..${rows[rows.length - 1]}` : rows.join(',')
    })
  }

  // Playing from the list makes the whole visible list the context, as every player does.
  function play_from(index: number): void {
    const track = tracks[index]
    if (track) void player.playTrack(track.id, tracks.map((each) => each.id), index)
  }

  // Right-clicking a row that is not selected selects it, as every list does.
  function open_menu(track: TrackRow, event: MouseEvent): void {
    const index = index_of(track)
    if (!library.isSelected(track.id)) library.clickRow(index, {})
    const ids = library.selectedIds()
    const many = ids.length > 1

    open_context_menu(event, [
      { label: 'Play', hint: 'Enter', run: () => play_from(index) },
      { label: many ? `Play ${ids.length} next` : 'Play next', run: () => void player.enqueue(ids, 'next') },
      { label: many ? `Add ${ids.length} to queue` : 'Add to queue', run: () => void player.enqueue(ids, 'end') },
      { label: 'Properties', hint: 'Alt+Enter', separator_before: true, disabled: many, run: () => set_inspecting(track.id) },
      { label: `Merge ${ids.length} tracks…`, disabled: !many, run: () => set_merging(ids) }
    ])
  }

  // Arrows move the cursor and Shift extends the selection from the anchor; Ctrl alone moves without selecting.
  function on_row_key(track: TrackRow, event: KeyboardEvent): void {
    const index = index_of(track)
    const control = event.ctrlKey || event.metaKey

    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.altKey) set_inspecting(track.id)
      else play_from(index)
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      select_row(index, event)
      return
    }
    if (event.key === 'a' && control) {
      event.preventDefault()
      library.selectAll()
      return
    }
    if (event.key === 'Escape') {
      library.clearSelection()
      return
    }

    const rows_per_page = Math.max(1, Math.floor((body.current?.clientHeight ?? 400) / 28) - 1)
    const next = row_after_key(event.key, index, tracks.length - 1, rows_per_page)
    if (next === null) return
    event.preventDefault()
    set_cursor(next)
    if (!control || event.shiftKey) library.clickRow(next, { shift: event.shiftKey, ctrl: control })
    focus_row(next)
  }

  const selected_count = library.selectedCount()
  const current_id = player.currentId
  const chips = library.chips()

  return (
    <section className="song-list" aria-label="Song list">
      <div className="song-list-tools">
        <SearchBox key={library.searchResets} label="Search the library" value={library.search} on_input={(text) => void library.setSearch(text)} />
        {chips.length > 0 && (
          <Chips>
            {chips.map((chip) => (
              <Chip key={chip.id} title="Remove filter" on_click={() => void library.removeChip(chip.id)}>{chip.label} ✕</Chip>
            ))}
          </Chips>
        )}
        {library.hasFilters() && <button onClick={() => void library.clearFilters()}>Clear all</button>}
        {selected_count > 0 && <button onClick={() => library.clearSelection()}>{selected_count} selected ✕</button>}
        {selected_count > 0 && <button onClick={() => void player.enqueue(library.selectedIds())}>Queue {selected_count}</button>}
        {selected_count > 1 && <button className="accent" onClick={() => set_merging(library.selectedIds())}>Merge {selected_count}…</button>}
        <span className="song-list-spacer" />
        <span className="muted small" title="Click a column header to sort, Shift+click to add a sort key">
          ↑↓ to move · Shift+↑↓ to select · double-click to play · right-click for actions
        </span>
        <span className="muted small">{tracks.length.toLocaleString()} shown</span>
      </div>

      <div className="song-list-body" ref={body}>
        <DataTable
          caption="Tracks"
          columns={columns}
          rows={tracks}
          row_key={(track) => track.id}
          manual_sorting
          sorting={library.sorting()}
          on_sorting_change={(sorting) => void library.setSorting(sorting)}
          column_order={order}
          on_column_order_change={set_order}
          column_widths={dragged_widths ?? widths}
          on_column_widths_change={(next, done) => {
            set_dragged_widths(done ? null : next)
            if (done) set_widths(next)
          }}
          hidden_columns={hidden}
          on_hidden_columns_change={set_hidden}
          active_row={tracks[Math.min(cursor, tracks.length - 1)]?.id}
          row_selected={(track) => library.isSelected(track.id)}
          row_class={(track) => (track.id === current_id ? 'now-playing' : undefined)}
          on_row_click={(track, event) => { set_cursor(index_of(track)); select_row(index_of(track), event) }}
          on_row_double_click={(track) => play_from(index_of(track))}
          on_row_context_menu={open_menu}
          on_row_key_down={on_row_key}
        />
        {tracks.length === 0 && (
          <div className="empty">
            <p className="empty-title">No tracks match.</p>
            <p>Import your gmusicbrowser library from Settings, or clear the active filters.</p>
          </div>
        )}
      </div>

      {inspecting !== null && <SongProperties trackId={inspecting} onclose={() => set_inspecting(null)} />}

      {merging && (
        <MergeView
          ids={merging}
          onclose={(merged) => {
            set_merging(null)
            if (merged) library.clearSelection()
          }}
        />
      )}
    </section>
  )
}
