// gmb's TabbedLists(pages="+PlayList +QueueList +@song_info +PictureBrowser").

import { useState } from 'react'
import { Facts, Tabs } from '@x-tech-laboratories/x-libs/web/react/layout'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { player } from '../stores/player'
import { library } from '../stores/library'
import s from './TabbedLists.module.css'

const tabs = [
  { id: 'playlist', label: 'Playlist' },
  { id: 'queue', label: 'Queue' },
  { id: 'info', label: 'Song info' },
  { id: 'pictures', label: 'Pictures' }
] as const

type Tab = (typeof tabs)[number]['id']

export function TabbedLists() {
  use_watch(player.status_changes)
  use_watch(library.data)
  const [tab, set_tab] = useState<Tab>('queue')

  const title_of = (id: number): string => library.tracks.find((track) => track.id === id)?.title ?? `Track ${id}`
  const artist_of = (id: number): string => library.tracks.find((track) => track.id === id)?.artist ?? ''

  const status = player.status
  const queue = status?.queue ?? []

  let body
  if (tab === 'queue') {
    body = queue.length === 0 ? (
      <p className="muted small">Queue is empty. Select tracks and press Queue, and they play before the list resumes.</p>
    ) : (
      <>
        <div className={s.queueHead}>
          <span className="muted small">{queue.length} queued</span>
          <button onClick={() => void player.clearQueue()}>Clear</button>
        </div>
        <ol className={s.queue}>
          {queue.map((id, index) => (
            <li key={`${id}-${index}`} className={s.item}>
              <span className={s.position}>{index + 1}</span>
              <span className={s.title} title={title_of(id)}>{title_of(id)}</span>
              <span className="muted">{artist_of(id)}</span>
              <button className="icon" aria-label={`Remove ${title_of(id)} from the queue`} onClick={() => void player.dequeue(index)}>✕</button>
            </li>
          ))}
        </ol>
      </>
    )
  } else if (tab === 'info') {
    body = status?.track ? (
      <Facts layout="rows" rows={[
        ['Title', status.track.title],
        ['Artist', status.track.artist],
        ['Album', status.track.album],
        ['File', status.media ? <code className="path">{status.media.uri}</code> : null]
      ]} />
    ) : (
      <p className="muted small">Nothing playing.</p>
    )
  } else {
    body = <p className="muted small">{tabs.find((each) => each.id === tab)?.label} — a later milestone.</p>
  }

  return (
    <section className={s.tabbed}>
      <Tabs label="Lists" items={[...tabs]} active={tab} on_select={set_tab} />
      <div className={s.body}>{body}</div>
    </section>
  )
}
