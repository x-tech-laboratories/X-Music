// gmb's VBplayer: indicator row, transport, the three text lines, and the time bar.

import type { ChangeEvent } from 'react'
import { player } from '../stores/player'
import { use_watch } from '../lib/watch'
import { cx } from '../lib/cx'
import { Stars } from './Stars'
import { VolumeButton } from './VolumeButton'
import { Cover } from './Cover'
import s from './PlayerBlock.module.css'

const mmss = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '0:00'
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** The only part that reads the playback position, so each clock tick re-renders just this row. */
function TimeBar({ durationMs }: { durationMs: number | null }) {
  use_watch(player.position_changes)
  const progress = durationMs && durationMs > 0
    ? Math.min(1000, Math.max(0, (player.positionMs / durationMs) * 1000))
    : 0

  function onSeek(e: ChangeEvent<HTMLInputElement>): void {
    const value = Number(e.currentTarget.value)
    if (durationMs) void player.seek((value / 1000) * durationMs)
  }

  return (
    <div className={s.time}>
      <span className={s.clock}>{mmss(player.positionMs)}</span>
      <input
        className={s.range}
        type="range" min="0" max="1000"
        value={progress}
        disabled={!durationMs}
        aria-label="Seek"
        onChange={onSeek}
      />
      <span className={s.clock}>{mmss(durationMs)}</span>
    </div>
  )
}

export function PlayerBlock() {
  use_watch(player.status_changes)
  const status = player.status
  const track = status?.track ?? null
  const durationMs = status?.durationMs ?? track?.lengthMs ?? null

  const repeatLabel = status?.repeat === 'one' ? '🔂' : status?.repeat === 'all' ? '🔁' : '🔁'

  function cycleRepeat(): void {
    const next = player.status?.repeat === 'off' ? 'all'
      : player.status?.repeat === 'all' ? 'one' : 'off'
    void player.setRepeat(next)
  }

  return (
    <section className={s.vbplayer}>
      <div className={s.indicators}>
        <button
          className={cx(s.button, s.chip, status?.shuffle && s.on)}
          title="Shuffle"
          onClick={() => player.setShuffle(!player.status?.shuffle)}
        >🔀</button>
        <button
          className={cx(s.button, s.chip, status?.repeat !== 'off' && s.on)}
          title={`Repeat: ${status?.repeat ?? 'off'}`}
          onClick={cycleRepeat}
        >{repeatLabel}</button>
        {(status?.queue.length ?? 0) > 0 && (
          <span className={cx(s.chip, s.queued)}>{status!.queue.length} queued</span>
        )}
        <span className={s.spacer}></span>
        <Stars value={track?.rating ?? null} />
      </div>

      <div className={s.main}>
        <div className={s.text}>
          <div className={s.transport}>
            <button className={s.button} aria-label="Previous" onClick={() => player.previous()}>⏮</button>
            <button className={s.button} aria-label="Stop" onClick={() => player.stop()}>⏹</button>
            <button
              className={cx(s.button, s.primary)}
              aria-label={player.playing ? 'Pause' : 'Play'}
              onClick={() => player.toggle()}
            >{player.playing ? '⏸' : '▶'}</button>
            <button className={s.button} aria-label="Next" onClick={() => player.next()}>⏭</button>
            <span className={s.spacer}></span>
            <VolumeButton
              volume={status?.volume ?? 80}
              onchange={(v) => player.setVolume(v)}
            />
          </div>

          <div className={cx(s.line, s.title)} title={track?.title ?? ''}>
            {track?.title ?? 'Nothing playing'}
          </div>
          <div className={cx(s.line, s.artist)} title={track?.artist ?? ''}>{track?.artist ?? '—'}</div>
          <div className={cx(s.line, s.album)} title={track?.album ?? ''}>{track?.album ?? '—'}</div>

          {status?.error && (
            <div className={cx(s.line, s.err)}>{status.error}</div>
          )}

          <TimeBar durationMs={durationMs} />
        </div>

        <Cover trackId={track?.id ?? null} size={88} />
      </div>
    </section>
  )
}
