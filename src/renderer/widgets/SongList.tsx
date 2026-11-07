import { memo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { TrackRow } from '@shared/ipc'
import { field } from '@shared/fields'
import { library } from '../stores/library'
import { player } from '../stores/player'
import { Stars } from './Stars'
import { MergeView } from './MergeView'
import { SongProperties } from './SongProperties'
import { ContextMenu, type MenuItem } from '../lib/ContextMenu'
import { use_pref } from '../lib/prefs'
import { use_watch } from '../lib/watch'
import { logger } from '../lib/log'
import { cx } from '../lib/cx'
import s from './SongList.module.css'

const log = logger('songlist')

const DEFAULT_WIDTHS: Record<string, number> = {
  track_number: 56, title: 320, artist: 220, album: 220,
  year: 60, length: 70, rating: 96, play_count: 60
}

const MIN_WIDTH = 44

const heading = (id: string): string => field(id).name
const align = (id: string): 'left' | 'right' | 'center' => field(id).align ?? 'left'

const hint = (id: string): string => {
  const dir = library.sortDir(id)
  const p = library.sortPriority(id)
  const state = dir === null
    ? 'Not sorted'
    : `Sorted ${dir === 'asc' ? 'ascending' : 'descending'}${p > 1 ? `, key ${p}` : ''}`
  return `${heading(id)} — ${state}\nClick to sort by this column\nShift+click to add it as an extra sort key`
}

const arrow = (id: string): string => {
  const dir = library.sortDir(id)
  if (!dir) return ''
  const p = library.sortPriority(id)
  return `${dir === 'asc' ? '▲' : '▼'}${p > 1 ? p : ''}`
}

const mmss = (ms: number | null): string => {
  if (ms === null) return ''
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What a row calls back into the list with; the list swaps these every render. */
interface RowHandlers {
  click(index: number, e: MouseEvent): void
  play(index: number): void
  menu(e: MouseEvent, index: number): void
  inspect(id: number): void
  select(index: number, e: KeyboardEvent): void
}

// Rows take only primitives and a stable handler holder, so a selection change re-renders just the rows it touches.
const Row = memo(function Row({
  track: t,
  index: i,
  sel,
  playing,
  focusable,
  template,
  handlers
}: {
  track: TrackRow
  index: number
  sel: boolean
  playing: boolean
  focusable: boolean
  template: string
  handlers: { current: RowHandlers }
}) {
  return (
    <div
      className={cx(s.row, sel && s.sel, playing && s.playing)}
      style={{ gridTemplateColumns: template }}
      role="row"
      tabIndex={focusable ? 0 : -1}
      data-row={i}
      onClick={(e) => handlers.current.click(i, e)}
      onDoubleClick={() => handlers.current.play(i)}
      onContextMenu={(e) => handlers.current.menu(e, i)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.altKey) { e.preventDefault(); handlers.current.inspect(t.id); return }
        if (e.key === 'Enter') { e.preventDefault(); handlers.current.play(i); return }
        if (e.key !== ' ') return
        e.preventDefault()
        handlers.current.select(i, e)
      }}
    >
      <div className={cx(s.cell, s.num)}>{t.track_number ?? ''}</div>
      <div className={s.cell}>{t.title ?? ''}</div>
      <div className={s.cell}>{t.artist ?? ''}</div>
      <div className={s.cell}>{t.album ?? ''}</div>
      <div className={cx(s.cell, s.num)}>{t.year ?? ''}</div>
      <div className={cx(s.cell, s.num)}>{mmss(t.length_ms)}</div>
      <div className={s.cell}><Stars value={t.rating} /></div>
      <div className={cx(s.cell, s.num)}>{t.play_count}</div>
    </div>
  )
})

export function SongList() {
  use_watch(library.data)
  use_watch(library.selection_changes)
  use_watch(player.status_changes)
  const [merging, setMerging] = useState<number[] | null>(null)
  const [inspecting, setInspecting] = useState<number | null>(null)

  /** The keyboard cursor: which row arrow keys move from. */
  const [cursor, setCursor] = useState(0)
  const bodyEl = useRef<HTMLDivElement>(null)

  function focusRow(index: number): void {
    const el = bodyEl.current?.querySelector<HTMLElement>(`[data-row="${index}"]`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest' })
  }

  /**
   * Arrow keys move the cursor; holding shift extends the selection from the anchor instead of
   * replacing it, which is what makes a range adjustable without the mouse.
   */
  function onListKeydown(e: KeyboardEvent): void {
    const last = library.tracks.length - 1
    if (last < 0) return

    const rowsPerPage = Math.max(1, Math.floor((bodyEl.current?.clientHeight ?? 400) / 28) - 1)

    let next: number | null = null
    switch (e.key) {
      case 'ArrowDown': next = Math.min(last, cursor + 1); break
      case 'ArrowUp': next = Math.max(0, cursor - 1); break
      case 'PageDown': next = Math.min(last, cursor + rowsPerPage); break
      case 'PageUp': next = Math.max(0, cursor - rowsPerPage); break
      case 'Home': next = 0; break
      case 'End': next = last; break
      case 'a':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); library.selectAll() }
        return
      case 'Escape':
        library.clearSelection()
        return
      default:
        return
    }

    e.preventDefault()
    setCursor(next)

    // Ctrl alone moves the cursor without disturbing the selection, as lists conventionally do.
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey) {
      library.clickRow(next, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
    }
    focusRow(next)
  }
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  /** Right-clicking a row that is not selected selects it, as every list does. */
  function openMenu(e: MouseEvent, index: number): void {
    e.preventDefault()
    const t = library.tracks[index]
    if (!t) return
    if (!library.isSelected(t.id)) library.clickRow(index, {})

    const ids = library.selectedIds()
    const many = ids.length > 1

    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'play', label: 'Play', hint: 'Enter', action: () => playFrom(index) },
        { id: 'next', label: many ? `Play ${ids.length} next` : 'Play next',
          action: () => void player.enqueue(ids, 'next') },
        { id: 'queue', label: many ? `Add ${ids.length} to queue` : 'Add to queue',
          action: () => void player.enqueue(ids, 'end') },
        { id: 'props', label: 'Properties', hint: 'Alt+Enter', separatorBefore: true,
          disabled: many, action: () => setInspecting(t.id) },
        { id: 'merge', label: `Merge ${ids.length} tracks…`, disabled: !many,
          action: () => setMerging(ids) }
      ]
    })
  }

  function selectRow(index: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    const modifiers = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }
    const anchorBefore = library.inspectSelection().anchor

    library.clickRow(index, modifiers)

    // Which rows ended up selected, not just how many: a wrong range is usually a wrong anchor.
    const ids = library.selectedIds()
    const positions = ids
      .map((id) => library.tracks.findIndex((t) => t.id === id))
      .filter((n) => n >= 0)
      .sort((a, b) => a - b)

    log.debug('row clicked', {
      clicked: index,
      shift: modifiers.shift,
      ctrl: modifiers.ctrl,
      anchorBefore,
      anchorAfter: library.inspectSelection().anchor,
      count: ids.length,
      rows: positions.length > 8
        ? `${positions[0]}..${positions[positions.length - 1]}`
        : positions.join(',')
    })
  }

  /** Playing from the list makes the whole visible list the context, as every player does. */
  function playFrom(index: number): void {
    const t = library.tracks[index]
    if (!t) return
    void player.playTrack(t.id, library.tracks.map((x) => x.id), index)
  }

  // Rows hold this one object, so memoised rows still call the latest handlers.
  const handlers = useRef<RowHandlers>(null as unknown as RowHandlers)
  handlers.current = {
    click: (i, e) => { setCursor(i); selectRow(i, e) },
    play: playFrom,
    menu: openMenu,
    inspect: setInspecting,
    select: selectRow
  }

  // Column set is data, so the header context menu can edit it without touching this component.
  const [columns] = useState(['track_number', 'title', 'artist', 'album', 'year', 'length', 'rating', 'play_count'])

  // Widths are remembered per column id, so adding or reordering columns keeps the rest intact.
  const [widths, setWidths] = use_pref<Record<string, number>>('songlist.widths', {})
  // Pointer handlers outlive a render, so they read and write the latest widths through this.
  const latestWidths = useRef(widths)
  latestWidths.current = widths

  const widthOf = (id: string): number =>
    widths[id] ?? DEFAULT_WIDTHS[id] ?? 120

  /** The last column takes the remaining space, so the row always fills the viewport. */
  const template =
    columns.map((c, i) => (i === columns.length - 1 ? '1fr' : `${widthOf(c)}px`)).join(' ')

  const [dragging, setDragging] = useState<string | null>(null)

  function startResize(id: string, event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    event.stopPropagation()

    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)

    const originX = event.clientX
    const originWidth = widthOf(id)
    setDragging(id)

    const move = (e: globalThis.PointerEvent): void => {
      const next = Math.max(MIN_WIDTH, Math.round(originWidth + (e.clientX - originX)))
      setWidths({ ...latestWidths.current, [id]: next })
    }

    const done = (): void => {
      setDragging(null)
      handle.releasePointerCapture(event.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', done)
      handle.removeEventListener('pointercancel', done)
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', done)
    handle.addEventListener('pointercancel', done)
  }

  /** Double-clicking a divider restores that column's default. */
  function resetWidth(id: string): void {
    const next = { ...widths }
    delete next[id]
    setWidths(next)
  }

  const tracks = library.tracks
  const currentId = player.currentId
  const selectedCount = library.selectedCount()

  return (
    <>
      <section className={s.songlist} aria-label="Song list">
        <div className={s.hbsonglist}>
          <input
            className={s.search}
            type="search"
            placeholder="Search…"
            value={library.search}
            onChange={(e) => library.setSearch((e.currentTarget as HTMLInputElement).value)}
          />
          {library.chips().map((chip) => (
            <button key={chip.id} className={s.chip} onClick={() => library.removeChip(chip.id)} title="Remove filter">
              {chip.label} ✕
            </button>
          ))}
          {library.hasFilters() && (
            <button className={s.clear} onClick={() => library.clearFilters()}>Clear all</button>
          )}
          {selectedCount > 0 && (
            <button className={s.clear} onClick={() => library.clearSelection()}>
              {selectedCount} selected ✕
            </button>
          )}
          {selectedCount > 0 && (
            <button className={s.clear} onClick={() => player.enqueue(library.selectedIds())}>
              Queue {selectedCount}
            </button>
          )}
          {selectedCount > 1 && (
            <button className={s.merge} onClick={() => setMerging(library.selectedIds())}>
              Merge {selectedCount}…
            </button>
          )}
          <span className={s.spacer}></span>
          <span className={s.hint} title="Click a column header to sort. Shift+click another to sort by it next.">
            ↑↓ to move · shift+↑↓ to select · double-click to play · right-click for actions
          </span>
          <span className={s.count}>{tracks.length.toLocaleString()} shown</span>
        </div>

        <div className={s.head} style={{ gridTemplateColumns: template }}>
          {columns.map((c, i) => (
            <div key={c} className={s.headSlot}>
              <button
                className={cx(s.cell, s.headCell, library.sortDir(c) !== null && s.sorted)}
                style={{ textAlign: align(c) }}
                title={hint(c)}
                onClick={(e) => library.toggleSort(c, e.shiftKey)}
              >{heading(c)} <span className={s.arrow}>{arrow(c)}</span></button>

              {i < columns.length - 1 && (
                <div
                  className={cx(s.grip, dragging === c && s.active)}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${heading(c)} column`}
                  tabIndex={0}
                  onPointerDown={(e) => startResize(c, e)}
                  onDoubleClick={() => resetWidth(c)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                    e.preventDefault()
                    const step = e.shiftKey ? 32 : 8
                    setWidths({
                      ...widths,
                      [c]: Math.max(MIN_WIDTH, widthOf(c) + (e.key === 'ArrowRight' ? step : -step))
                    })
                  }}
                ></div>
              )}
            </div>
          ))}
        </div>

        <div className={s.body} ref={bodyEl} role="rowgroup" onKeyDown={onListKeydown}>
          {tracks.length === 0 ? (
            <div className={s.empty}>
              <p>No tracks match.</p>
              <p className={s.hint}>
                Import your gmusicbrowser library from the Library menu, or clear the active filters.
              </p>
            </div>
          ) : tracks.map((t, i) => (
            <Row
              key={t.id}
              track={t}
              index={i}
              sel={library.isSelected(t.id)}
              playing={currentId === t.id}
              focusable={i === cursor}
              template={template}
              handlers={handlers}
            />
          ))}
        </div>
      </section>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => setMenu(null)} />
      )}

      {inspecting !== null && (
        <SongProperties trackId={inspecting} onclose={() => setInspecting(null)} />
      )}

      {merging && (
        <MergeView
          ids={merging}
          onclose={(merged) => {
            setMerging(null)
            if (merged) library.clearSelection()
          }}
        />
      )}
    </>
  )
}
