// The lists beside the player, after gmusicbrowser's TabbedLists: the queue and what is playing.

import { useState } from 'react'
import { Icon, CloseIcon } from '@x-tech-laboratories/x-libs/web/react/icons'
import { Facts, Tabs } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Empty, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import { player } from '../stores/player.ts'
import { library, type TrackId, type TrackName } from '../stores/library.ts'
import s from './TabbedLists.module.css'

const tabs = [
  { id: 'queue', label: 'Queue' },
  { id: 'info', label: 'Now playing' }
] as const

type Tab = (typeof tabs)[number]['id']

// ============================================================================
// Queue
// ============================================================================

interface Queued { position: number; id: TrackId; name: TrackName | undefined }

function Queue({ queue }: { queue: TrackId[] }) {
  // Queued tracks are named whether or not the library's filters show them.
  const names = use_resource(() => library.names_of(queue), [queue.map(String).join('\n')])

  if (queue.length === 0) {
    return <Empty title="The queue is empty." hint="Right-click tracks and choose Add to queue; they play before the list goes on." />
  }

  const title_of = (row: Queued): string => row.name?.title || 'Untitled track'
  const rows: Queued[] = queue.map((id, position) => ({ position, id, name: names.data?.get(id) }))
  // The queue plays in its own order, so its columns neither sort, filter nor group.
  const fixed = { sortable: false, filterable: false, groupable: false }
  const columns: TableColumn<Queued>[] = [
    { ...fixed, id: 'position', label: 'Position', header: '#', cell: (row) => row.position + 1, class: 'number', width: 48 },
    { ...fixed, id: 'title', label: 'Title', cell: title_of },
    { ...fixed, id: 'artist', label: 'Artist', cell: (row) => row.name?.artist ?? '' },
    {
      ...fixed, id: 'remove', label: 'Remove', header: '', width: 64, cell: (row) => (
        <button type="button" className="icon" aria-label={`Remove ${title_of(row)} from the queue`} onClick={() => void player.dequeue(row.position)}>
          <Icon icon={CloseIcon} />
        </button>
      )
    }
  ]

  return (
    <div className={s.queue}>
      <div className="panel-head">
        <span className="muted small">{plural(queue.length, 'track')} queued</span>
        <button type="button" onClick={() => void player.clearQueue()}>Clear queue</button>
      </div>
      <DataTable
        caption="Queue"
        wrap_class="scroll fit"
        columns={columns}
        rows={rows}
        row_key={(row) => row.position}
        column_hiding={false}
        fill_last_column={false}
        on_row_key_down={(row, event) => {
          if (event.key !== 'Delete') return
          event.preventDefault()
          void player.dequeue(row.position)
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
    <section className={s.tabbed}>
      <Tabs label="Lists" items={[...tabs]} active={tab} on_select={set_tab} />
      <div className={s.body}>{body}</div>
    </section>
  )
}
