// gmb's VBplayer: indicator row, transport, the three text lines, and the time bar.

import type { ChangeEvent, CSSProperties } from 'react'
import { Badge } from '@x-tech-laboratories/x-libs/web/react/badges'
import { use_store } from '@x-tech-laboratories/x-libs/web/react/store'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import { cx } from '@x-tech-laboratories/x-libs/web/dom'
import {
  Icon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon, StopIcon
} from '@x-tech-laboratories/x-libs/web/react/icons'
import { Rating } from '@x-tech-laboratories/x-libs/web/react/rating'
import { VolumeButton } from '@x-tech-laboratories/x-libs/web/react/volume'
import type { RepeatMode } from '@shared/ipc'
import { ratingToStars } from '@shared/fields'
import { player, player_position, player_status } from '../stores/player'
import { TrackCover } from './Cover'
import s from './PlayerBlock.module.css'

// ============================================================================
// Repeat
// ============================================================================

const next_repeat: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }

const repeat_label: Record<RepeatMode, string> = { off: 'Repeat', all: 'Repeat all', one: 'Repeat this track' }

// ============================================================================
// Time bar
// ============================================================================

// The only part that reads the playback position, so each clock tick redraws just this row.
function TimeBar({ duration_in_milliseconds }: { duration_in_milliseconds: number | null }) {
  const position = use_store(player_position)
  const progress = duration_in_milliseconds && duration_in_milliseconds > 0
    ? Math.min(1000, Math.max(0, (position / duration_in_milliseconds) * 1000))
    : 0

  function on_seek(event: ChangeEvent<HTMLInputElement>): void {
    if (duration_in_milliseconds) void player.seek((Number(event.currentTarget.value) / 1000) * duration_in_milliseconds)
  }

  return (
    <div className={s.time}>
      <span className={s.clock}>{format_clock(position)}</span>
      <input
        className={cx(s.range, 'seek')} style={{ '--range-progress': `${progress / 10}%` } as CSSProperties}
        type="range" min="0" max="1000" value={progress} disabled={!duration_in_milliseconds} aria-label="Seek" onChange={on_seek}
      />
      <span className={s.clock}>{format_clock(duration_in_milliseconds)}</span>
    </div>
  )
}

// ============================================================================
// Player
// ============================================================================

export function PlayerBlock() {
  const status = use_store(player_status)
  const track = status?.track ?? null
  const duration = track ? status?.durationMs ?? track.lengthMs : null
  const repeat = status?.repeat ?? 'off'
  const shuffle = status?.shuffle ?? false
  const queued = status?.queue.length ?? 0
  const playing = status?.state === 'playing'

  return (
    <section className={s.player} aria-label="Player">
      <div className={s.indicators}>
        <button className="icon" title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={() => void player.setShuffle(!shuffle)}>
          <Icon icon={ShuffleIcon} />
        </button>
        <button className="icon" title={repeat_label[repeat]} aria-label={repeat_label[repeat]} aria-pressed={repeat !== 'off'} onClick={() => void player.setRepeat(next_repeat[repeat])}>
          <Icon icon={repeat === 'one' ? RepeatOneIcon : RepeatIcon} />
        </button>
        {queued > 0 && <Badge tone="info">{queued} queued</Badge>}
        <span className={s.spacer} />
        {track && <Rating value={ratingToStars(track.rating)} />}
      </div>

      <div className={s.main}>
        <div className={s.text}>
          <div className={s.transport}>
            <button className="icon" aria-label="Previous" title="Previous (Alt+←)" onClick={() => void player.previous()}>
              <Icon icon={PreviousIcon} />
            </button>
            <button className="icon" aria-label="Stop" title="Stop" onClick={() => void player.stop()}>
              <Icon icon={StopIcon} />
            </button>
            <button className="icon accent solid" aria-label={playing ? 'Pause' : 'Play'} title={`${playing ? 'Pause' : 'Play'} (Ctrl+Space)`} onClick={() => void player.toggle()}>
              <Icon icon={playing ? PauseIcon : PlayIcon} />
            </button>
            <button className="icon" aria-label="Next" title="Next (Alt+→)" onClick={() => void player.next()}>
              <Icon icon={NextIcon} />
            </button>
            <span className={s.spacer} />
            <VolumeButton volume={status?.volume ?? 80} on_change={(volume) => void player.setVolume(volume)} />
          </div>

          <div className={cx(s.line, s.title)} title={track?.title ?? ''}>{track?.title ?? 'Nothing playing'}</div>
          <div className={cx(s.line, s.artist)} title={track?.artist ?? ''}>{track?.artist ?? '—'}</div>
          <div className={cx(s.line, s.album)} title={track?.album ?? ''}>{track?.album ?? '—'}</div>

          {status?.state === 'error' && status.error && (
            <div className={s.error} role="alert">
              <span className={cx(s.line, 'tone-bad')} title={status.error}>{status.error}</span>
              {track && <button onClick={() => void player.toggle()}>Try again</button>}
            </div>
          )}

          <TimeBar duration_in_milliseconds={duration} />
        </div>

        <TrackCover track_id={track?.id ?? null} size={88} />
      </div>
    </section>
  )
}
