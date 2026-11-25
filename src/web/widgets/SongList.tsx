// The library's tracks in the X-Libs table, every one of them drawn only where it shows: the library sorts them, the table shows the sort, and the list adds keyboard selection and playing.

import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Chip, Chips } from '@x-tech-laboratories/x-libs/web/react/badges'
import { SearchBox } from '@x-tech-laboratories/x-libs/web/react/controls'
import { SelectionBar } from '@x-tech-laboratories/x-libs/web/react/layout'
import { open_context_menu } from '@x-tech-laboratories/x-libs/web/react/menus'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { use_route } from '@x-tech-laboratories/x-libs/web/react/shell'
import { Rating } from '@x-tech-laboratories/x-libs/web/react/rating'
import { describe_keys } from '@x-tech-laboratories/x-libs/web/react/shortcuts'
import { Empty, Skeleton } from '@x-tech-laboratories/x-libs/web/react/states'
import { use_store } from '@x-tech-laboratories/x-libs/web/react/store'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { format_count, plural } from '@x-tech-laboratories/x-libs/web/format'
import { row_after_key } from '@x-tech-laboratories/x-libs/web/selection'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import type { TrackRow } from '@shared/ipc'
import { field, rating_to_stars, stars_to_rating } from '@shared/fields'
import { browse, chips_of, library, loading, results, type TrackId } from '../stores/library.ts'
import { player } from '../stores/player.ts'
import { logger } from '../lib/log.ts'
import { MergeView } from './MergeView.tsx'
import { SongProperties } from './SongProperties.tsx'
import { close_overlay, open_overlay, overlay_of } from '../views/routes.ts'

const log = logger('songlist')

// ============================================================================
// Columns
// ============================================================================

// The library does the sorting and filtering, so the table's own filters and groups stay out.
const column = (id: string, width: number, cell: (track: TrackRow) => ReactNode, number = false): TableColumn<TrackRow> => ({
  id,
  label: field(id).name,
  width,
  min_width: 44,
  cell,
  filterable: false,
  groupable: false,
  class: number ? 'number' : undefined
})

const columns: TableColumn<TrackRow>[] = [
  column('track_number', 56, (track) => track.track_number ?? '', true),
  column('title', 320, (track) => track.title ?? ''),
  column('artist', 220, (track) => track.artist ?? ''),
  column('album', 220, (track) => track.album ?? ''),
  column('year', 60, (track) => track.year ?? '', true),
  column('length', 70, (track) => format_clock(track.length_ms, ''), true),
  column('rating', 96, (track) => (
    <Rating value={rating_to_stars(track.rating)} label={`Rating of ${track.title ?? 'this track'}`} on_change={(stars) => void rate([track.id], stars)} />
  )),
  column('play_count', 60, (track) => track.play_count, true)
]

type Modifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

// ============================================================================
// Ratings
// ============================================================================

const rate = (ids: readonly TrackId[], stars: number | null): Promise<void> => library.rate(ids, stars === null ? null : stars_to_rating(stars))

// The rating every one of the tracks has, or null when they differ or none is rated.
function shared_rating(tracks: readonly TrackRow[], ids: readonly TrackId[]): number | null {
  const picked = new Set(ids)
  let shared: number | null | undefined
  for (const track of tracks) {
    if (!picked.has(track.id)) continue
    if (shared === undefined) shared = track.rating
    else if (shared !== track.rating) return null
  }
  return shared ?? null
}

// How tall a drawn row is, for how far Page Up and Page Down move.
function drawn_row_height(body: HTMLElement | null): number {
  return body?.querySelector('tbody tr:not(.virtual-spacer)')?.getBoundingClientRect().height || 32
}

// ============================================================================
// Search
// ============================================================================

let search_area: HTMLElement | null = null

// Puts the cursor in the library's search field, for the window's search shortcut.
export function focus_search(): void {
  search_area?.querySelector('input')?.focus()
}

// ============================================================================
// Song list
// ============================================================================

export function SongList() {
  const { tracks, order, stats } = use_store(results)
  const busy = use_store(loading)
  const state = use_store(browse)
  use_watch(library.selection_changes)
  use_watch(player.status_changes)

  // Properties and Merge open at their own address, so Back closes them and a reload returns to them.
  const overlay = overlay_of(use_route().parts)
  const inspect = (track_id: TrackId): void => open_overlay('library', { kind: 'properties', track_id })
  const merge = (track_ids: TrackId[]): void => open_overlay('library', { kind: 'merge', track_ids })
  // The keyboard cursor: which row arrow keys move from.
  const [cursor, set_cursor] = useState(0)
  const body = useRef<HTMLDivElement>(null)

  // Column layout is remembered per column id, so adding or reordering columns keeps the rest.
  const [widths, set_widths] = use_pref<Record<string, number>>('x-music.pref.songlist.widths', {})
  const [column_order, set_column_order] = use_pref<string[]>('x-music.pref.songlist.order', [])
  const [hidden, set_hidden] = use_pref<string[]>('x-music.pref.songlist.hidden', [])
  // Widths while an edge is dragged, kept once it is let go.
  const [dragged_widths, set_dragged_widths] = useState<Record<string, number> | null>(null)

  const positions = useMemo(() => new Map(order.map((id, index) => [id, index])), [order])
  const index_of = (track: TrackRow): number => positions.get(track.id) ?? 0

  function select_row(index: number, event: Modifiers): void {
    const modifiers = { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }
    const anchor_before = library.inspect_selection().anchor
    library.click_row(index, modifiers)
    log.debug('row clicked', { clicked: index, ...modifiers, anchor_before, anchor_after: library.inspect_selection().anchor, count: library.selected_count() })
  }

  // Playing from the list makes the whole list the context, as every player does.
  function play_from(index: number): void {
    const id = order[index]
    if (id !== undefined) void player.play_track(id, order, index)
  }

  // Right-clicking a row that is not picked picks it, as every list does.
  function open_menu(track: TrackRow, event: MouseEvent): void {
    const index = index_of(track)
    if (!library.is_selected(track.id)) library.click_row(index, {})
    const ids = library.selected_ids()
    const many = ids.length > 1

    open_context_menu(event, [
      { label: 'Play', hint: describe_keys('enter'), run: () => play_from(index) },
      { label: many ? `Play ${ids.length} next` : 'Play next', run: () => void player.enqueue(ids, 'next') },
      { label: many ? `Add ${ids.length} to queue` : 'Add to queue', run: () => void player.enqueue(ids, 'end') },
      { label: 'Properties', hint: describe_keys('alt+enter'), separator_before: true, disabled: many, run: () => inspect(track.id) },
      { label: `Merge ${ids.length} tracks…`, disabled: !many, run: () => merge(ids) }
    ])
  }

  // Arrows move the cursor and Shift stretches the picks from the anchor; Ctrl alone moves without picking.
  function on_row_key(track: TrackRow, event: KeyboardEvent): void {
    // The stars in a row handle their own keys.
    if (event.defaultPrevented) return
    const index = index_of(track)
    const control = event.ctrlKey || event.metaKey

    // 1 to 5 rate the picked tracks, or the one under the cursor, and 0 makes them unrated.
    if (/^[0-5]$/.test(event.key) && !control && !event.altKey) {
      event.preventDefault()
      const ids = library.is_selected(track.id) ? library.selected_ids() : [track.id]
      void rate(ids, event.key === '0' ? null : Number(event.key))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.altKey) inspect(track.id)
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
      library.select_all()
      return
    }
    if (event.key === 'Escape') {
      library.clear_selection()
      return
    }

    const rows_per_page = Math.max(1, Math.floor((body.current?.clientHeight ?? 400) / drawn_row_height(body.current)) - 1)
    const next = row_after_key(event.key, index, order.length - 1, rows_per_page)
    if (next === null) return
    event.preventDefault()
    set_cursor(next)
    if (!control || event.shiftKey) library.click_row(next, { shift: event.shiftKey, ctrl: control })
  }

  const selected_count = library.selected_count()
  const current_id = player.current_id
  const chips = chips_of(state)
  const narrowed = stats !== null && tracks.length < stats.tracks
  const keys = (combination: string) => <kbd>{describe_keys(combination)}</kbd>

  let content
  if (tracks.length === 0 && busy) {
    content = <Skeleton lines={6} />
  } else if (tracks.length === 0) {
    content = <Empty title="No tracks match." hint="Remove a filter above, or pick All in the panes." />
  } else {
    content = (
      <DataTable
        caption="Tracks"
        wrap_class="fit"
        single_line
        virtual={{}}
        columns={columns}
        rows={tracks}
        row_key={(track) => track.id}
        manual_sorting
        sorting={library.sorting()}
        on_sorting_change={(sorting) => void library.set_sorting(sorting)}
        column_order={column_order}
        on_column_order_change={set_column_order}
        column_widths={dragged_widths ?? widths}
        on_column_widths_change={(next, done) => {
          set_dragged_widths(done ? null : next)
          if (done) set_widths(next)
        }}
        hidden_columns={hidden}
        on_hidden_columns_change={set_hidden}
        active_row={order[Math.min(cursor, order.length - 1)]}
        row_selected={(track) => library.is_selected(track.id)}
        row_class={(track) => (track.id === current_id ? 'now-playing' : undefined)}
        on_row_click={(track, event) => { set_cursor(index_of(track)); select_row(index_of(track), event) }}
        on_row_double_click={(track) => play_from(index_of(track))}
        on_row_context_menu={open_menu}
        on_row_key_down={on_row_key}
      />
    )
  }

  return (
    <section className="scroll-pane" aria-label="Tracks">
      <div className="song-list-tools">
        <span ref={(element) => { search_area = element }}>
          <SearchBox label="Search the library" value={state.search} on_input={(text) => void library.set_search(text)} />
        </span>
        {chips.length > 0 && (
          <Chips>
            {chips.map((chip) => (
              <Chip key={chip.id} on_remove={() => void library.remove_chip(chip.id)} remove_label={`Remove the filter ${chip.label}`}>{chip.label}</Chip>
            ))}
          </Chips>
        )}
        {chips.length > 1 && <button type="button" onClick={() => void library.clear_filters()}>Clear filters</button>}
        <span className="song-list-spacer" />
        <span className="muted small">
          {keys('arrowup')} {keys('arrowdown')} move, {keys('shift+arrowdown')} picks, {keys('enter')} plays, {keys('1')}–{keys('5')} rate, right-click for more
        </span>
        <span className="muted small">
          {narrowed ? `${format_count(tracks.length)} of ${plural(stats.tracks, 'track')}` : plural(tracks.length, 'track')}
        </span>
      </div>

      <div className="song-list-body" ref={body}>{content}</div>

      {selected_count > 0 && (
        <SelectionBar count={selected_count} total={order.length} on_clear={() => library.clear_selection()} on_select_all={() => library.select_all()}>
          <Rating
            value={rating_to_stars(shared_rating(tracks, library.selected_ids()))}
            label="Rating of the picked tracks"
            on_change={(stars) => void rate(library.selected_ids(), stars)}
          />
          <button type="button" onClick={() => void player.enqueue(library.selected_ids(), 'next')}>Play next</button>
          <button type="button" onClick={() => void player.enqueue(library.selected_ids(), 'end')}>Add to queue</button>
          {selected_count > 1 && <button type="button" onClick={() => merge(library.selected_ids())}>Merge…</button>}
        </SelectionBar>
      )}

      {overlay?.kind === 'properties' && <SongProperties track_id={overlay.track_id} on_close={close_overlay} />}

      {overlay?.kind === 'merge' && (
        <MergeView
          key={overlay.track_ids.join('/')}
          ids={overlay.track_ids}
          on_close={(merged) => {
            close_overlay()
            if (merged) library.clear_selection()
          }}
        />
      )}
    </section>
  )
}
