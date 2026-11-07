// gmb's TabbedLists(pages="+PlayList +QueueList +@song_info +PictureBrowser").
import { useState } from 'react'
import { player } from '../stores/player'
import { library } from '../stores/library'
import { cx } from '../lib/cx'
import { use_watch } from '../lib/watch'
import s from './TabbedLists.module.css'

const tabs = [
  { id: 'playlist', label: 'Playlist' },
  { id: 'queue', label: 'Queue' },
  { id: 'info', label: 'Song info' },
  { id: 'pictures', label: 'Pictures' }
] as const

export function TabbedLists() {
  use_watch(player.status_changes)
  use_watch(library.data)
  const [tab, setTab] = useState<'playlist' | 'queue' | 'info' | 'pictures'>('queue')

  const titleOf = (id: number): string =>
    library.tracks.find((t) => t.id === id)?.title ?? `Track ${id}`

  const artistOf = (id: number): string =>
    library.tracks.find((t) => t.id === id)?.artist ?? ''

  const status = player.status

  let body
  if (tab === 'queue') {
    body = (status?.queue.length ?? 0) === 0 ? (
      <p className={s.placeholder}>
        Queue is empty. Select tracks and press Queue, and they play before the list resumes.
      </p>
    ) : (
      <>
        <div className={s.qhead}>
          <span>{status!.queue.length} queued</span>
          <button className={s.qclear} onClick={() => player.clearQueue()}>Clear</button>
        </div>
        <ul className={s.queue}>
          {status!.queue.map((id, i) => (
            <li key={`${id}-${i}`} className={s.item}>
              <span className={s.pos}>{i + 1}</span>
              <span className={s.qtitle} title={titleOf(id)}>{titleOf(id)}</span>
              <span className={s.qartist}>{artistOf(id)}</span>
              <button className={s.drop} title="Remove" onClick={() => player.dequeue(i)}>✕</button>
            </li>
          ))}
        </ul>
      </>
    )
  } else if (tab === 'info') {
    body = status?.track ? (
      <dl className={s.info}>
        <dt className={s.term}>Title</dt><dd className={s.value}>{status.track.title ?? '—'}</dd>
        <dt className={s.term}>Artist</dt><dd className={s.value}>{status.track.artist ?? '—'}</dd>
        <dt className={s.term}>Album</dt><dd className={s.value}>{status.track.album ?? '—'}</dd>
        <dt className={s.term}>File</dt><dd className={cx(s.value, s.path)}>{status.media?.uri ?? '—'}</dd>
      </dl>
    ) : (
      <p className={s.placeholder}>Nothing playing.</p>
    )
  } else {
    body = (
      <p className={s.placeholder}>
        {tabs.find((t) => t.id === tab)?.label} — a later milestone.
      </p>
    )
  }

  return (
    <section className={s.tabbed}>
      <div className={s.tabs}>
        {tabs.map((t) => (
          <button key={t.id} className={cx(s.tab, tab === t.id && s.active)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={s.body}>{body}</div>
    </section>
  )
}
