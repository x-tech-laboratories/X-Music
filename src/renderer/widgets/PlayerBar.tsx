// Transport is presentational until the mpv engine lands in M3; the widget contract is what
// matters now, since the layout document references widgets by id.

import { useState } from 'react'
import { cx } from '../lib/cx'
import s from './PlayerBar.module.css'

export function PlayerBar() {
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)

  return (
    <footer className={s.player}>
      <div className={s.transport}>
        <button className={s.button} aria-label="Previous">⏮</button>
        <button className={cx(s.button, s.primary)} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className={s.button} aria-label="Next">⏭</button>
      </div>

      <div className={s.cover} aria-hidden="true"></div>

      <div className={s.now}>
        <div className={s.title}>Nothing playing</div>
        <div className={s.sub}>X-Music</div>
      </div>

      <div className={s.seek}>
        <input
          className={s.range}
          type="range" min="0" max="1000"
          value={position}
          aria-label="Seek"
          onChange={(e) => setPosition(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </div>

      <div className={s.right}>
        <input type="range" min="0" max="100" defaultValue="80" aria-label="Volume" className={cx(s.range, s.vol)} />
      </div>
    </footer>
  )
}
