// The lists beside the player, after gmusicbrowser's TabbedLists: the queue and what is playing.

import { useRef, useState, type KeyboardEvent } from 'react'
import { Facts, RowActions, Tabs } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Empty, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { DataTable, type DropPlacement, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { set_drag_badge } from '@x-tech-laboratories/x-libs/web/drag'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import { row_after_key } from '@x-tech-laboratories/x-libs/web/selection'
import { player } from '../stores/player.ts'
import { library, type TrackId, type TrackName } from '../stores/library.ts'

const tabs = [
  { id: 'queue', label: 'Queue' },
  { id: 'info', label: 'Now playing' }
] as const

type Tab = (typeof tabs)[number]['id']

// ============================================================================
// Queue
// ============================================================================

interface Queued { position: number; id: TrackId; name: TrackName | undefined }

// Where a row dropped before or after the one at target lands, counted once it has left its own place.
export function drop_index(from: number, target: number, placement: DropPlacement): number {
  const index = placement === 'after' ? target + 1 : target
  return index > from ? index - 1 : index
}

function Queue({ queue }: { queue: TrackId[] }) {
  // Queued tracks are named whether or not the library's filters show them.
  const names = use_resource(() => library.names_of(queue), [queue.map(String).join('\n')])
  // The keyboard cursor, which follows a track as it moves.
  const [cursor, set_cursor] = useState(0)
  const dragged = useRef<number | null>(null)

  if (queue.length === 0) {
    return <Empty title="The queue is empty." hint="Right-click tracks and choose Add to queue; they play before the list goes on." />
  }

  // Only a track the library has with no title is untitled; a lookup that failed or found nothing says so instead.
  function title_of(row: Queued): string {
    if (row.name) return row.name.title || 'Untitled track'
    if (names.error) return 'Name could not be loaded'
    return names.data ? 'Not in the library' : ''
  }
  const last = queue.length - 1

  function move(from: number, to: number): void {
    if (to < 0 || to > last || to === from) return
    set_cursor(to)
    void player.move_in_queue(from, to)
  }

  // Delete takes the track out, Alt with an arrow moves it, and the arrows alone move the cursor.
  function on_key(row: Queued, event: KeyboardEvent<HTMLTableRowElement>): void {
    if (event.key === 'Delete') {
      event.preventDefault()
      void player.dequeue(row.position)
      return
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      move(row.position, row.position + (event.key === 'ArrowUp' ? -1 : 1))
      return
    }
    const next = row_after_key(event.key, row.position, last, 10)
    if (next === null) return
    event.preventDefault()
    set_cursor(next)
  }

  const rows: Queued[] = queue.map((id, position) => ({ position, id, name: names.data?.get(id) }))
  // The queue plays in its own order, so its columns neither sort, filter nor group.
  const fixed = { sortable: false, filterable: false, groupable: false }
  const columns: TableColumn<Queued>[] = [
    { ...fixed, id: 'position', label: 'Position', header: '#', cell: (row) => row.position + 1, class: 'number', width: 48 },
    { ...fixed, id: 'title', label: 'Title', cell: title_of },
    { ...fixed, id: 'artist', label: 'Artist', cell: (row) => row.name?.artist ?? '' },
    {
      ...fixed, id: 'actions', label: 'Actions', header: <span className="visually-hidden">Actions</span>, class: 'actions-cell', hideable: false,
      cell: (row) => (
        <RowActions
          index={row.position}
          count={queue.length}
          on_move={move}
          on_remove={() => void player.dequeue(row.position)}
          remove_label={`Remove ${title_of(row)} from the queue`}
        />
      )
    }
  ]

  return (
    <div className="scroll-pane">
      <div className="panel-head">
        <span className="muted small">{plural(queue.length, 'track')} queued</span>
        <button type="button" onClick={() => void player.clear_queue()}>Clear queue</button>
      </div>
      <DataTable
        caption="Queue"
        wrap_class="scroll fit"
        single_line
        virtual={{}}
        columns={columns}
        rows={rows}
        row_key={(row) => row.position}
        column_hiding={false}
        fill_last_column={false}
        active_row={Math.min(cursor, last)}
        on_row_click={(row) => set_cursor(row.position)}
        on_row_key_down={on_key}
        on_row_drag_start={(row, event) => {
          dragged.current = row.position
          set_drag_badge(event, title_of(row))
        }}
        on_row_drag_end={() => { dragged.current = null }}
        allow_inside_drop={false}
        can_drop_on_row={() => dragged.current !== null}
        on_row_drop={(row, placement) => {
          const from = dragged.current
          dragged.current = null
          if (from !== null) move(from, drop_index(from, row.position, placement))
        }}
      />
    </div>
  )
}

// ============================================================================
// Lists
// ============================================================================

export function TabbedLists() {
  use_watch(player.status_changes)
  const [tab, set_tab] = useState<Tab>('queue')
  const status = player.status

  let body
  if (tab === 'queue') {
    body = <Queue queue={status?.queue ?? []} />
  } else if (status?.track) {
    body = (
      <Facts layout="rows" rows={[
        ['Title', status.track.title],
        ['Artist', status.track.artist],
        ['Album', status.track.album],
        ['File', status.media ? <code className="path">{status.media.uri}</code> : null]
      ]} />
    )
  } else {
    body = <Empty title="Nothing is playing." />
  }

  return (
    <section className="scroll-pane">
      <Tabs label="Lists" items={[...tabs]} active={tab} on_select={set_tab} />
      <div className="scroll-pane-body">{body}</div>
    </section>
  )
}
