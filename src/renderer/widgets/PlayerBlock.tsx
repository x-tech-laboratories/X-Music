// gmb's VBplayer: indicator row, transport, the three text lines, and the time bar.

import type { ChangeEvent } from 'react'
import { Badge } from '@x-tech-laboratories/x-libs/web/react/badges'
import { use_watch } from '@x-tech-laboratories/x-libs/web/react/watch'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import { player } from '../stores/player'
import { cx } from '../lib/cx'
import { Stars } from './Stars'
import { VolumeButton } from './VolumeButton'
import { Cover } from './Cover'
import s from './PlayerBlock.module.css'

// The only part that reads the playback position, so each clock tick re-renders just this row.
function TimeBar({ durationMs }: { durationMs: number | null }) {
  use_watch(player.position_changes)
  const progress = durationMs && durationMs > 0
    ? Math.min(1000, Math.max(0, (player.positionMs / durationMs) * 1000))
    : 0

  function on_seek(event: ChangeEvent<HTMLInputElement>): void {
    if (durationMs) void player.seek((Number(event.currentTarget.value) / 1000) * durationMs)
  }

  return (
    <div className={s.time}>
      <span className={s.clock}>{format_clock(player.positionMs)}</span>
      <input className={s.range} type="range" min="0" max="1000" value={progress} disabled={!durationMs} aria-label="Seek" onChange={on_seek} />
      <span className={s.clock}>{format_clock(durationMs)}</span>
    </div>
  )
}

export function PlayerBlock() {
  use_watch(player.status_changes)
  const status = player.status
  const track = status?.track ?? null
  const durationMs = status?.durationMs ?? track?.lengthMs ?? null
  const repeat = status?.repeat ?? 'off'
  const queued = status?.queue.length ?? 0

  function cycle_repeat(): void {
    void player.setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')
  }

  return (
    <section className={s.player} aria-label="Player">
      <div className={s.indicators}>
        <button className="icon" title="Shuffle" aria-label="Shuffle" aria-pressed={status?.shuffle ?? false} onClick={() => void player.setShuffle(!status?.shuffle)}>🔀</button>
        <button className="icon" title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`} aria-pressed={repeat !== 'off'} onClick={cycle_repeat}>
          {repeat === 'one' ? '🔂' : '🔁'}
        </button>
        {queued > 0 && <Badge tone="info">{queued} queued</Badge>}
        <span className={s.spacer} />
        <Stars value={track?.rating ?? null} />
      </div>

      <div className={s.main}>
        <div className={s.text}>
          <div className={s.transport}>
            <button className="icon" aria-label="Previous" title="Previous (Alt+←)" onClick={() => void player.previous()}>⏮</button>
            <button className="icon" aria-label="Stop" onClick={() => void player.stop()}>⏹</button>
            <button className="icon accent solid" aria-label={player.playing ? 'Pause' : 'Play'} title="Play or pause (Ctrl+Space)" onClick={() => void player.toggle()}>
              {player.playing ? '⏸' : '▶'}
            </button>
            <button className="icon" aria-label="Next" title="Next (Alt+→)" onClick={() => void player.next()}>⏭</button>
            <span className={s.spacer} />
            <VolumeButton volume={status?.volume ?? 80} onchange={(volume) => void player.setVolume(volume)} />
          </div>

          <div className={cx(s.line, s.title)} title={track?.title ?? ''}>{track?.title ?? 'Nothing playing'}</div>
          <div className={cx(s.line, s.artist)} title={track?.artist ?? ''}>{track?.artist ?? '—'}</div>
          <div className={cx(s.line, s.album)} title={track?.album ?? ''}>{track?.album ?? '—'}</div>
          {status?.error && <div className={cx(s.line, 'tone-bad')}>{status.error}</div>}

          <TimeBar durationMs={durationMs} />
        </div>

        <Cover trackId={track?.id ?? null} size={88} />
      </div>
    </section>
  )
}
