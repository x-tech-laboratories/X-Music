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
import { describe_keys } from '@x-tech-laboratories/x-libs/web/react/shortcuts'
import { VolumeButton } from '@x-tech-laboratories/x-libs/web/react/volume'
import type { RepeatMode } from '@shared/ipc'
import { rating_to_stars } from '@shared/fields'
import { player, player_position, player_status } from '../stores/player.ts'
import { TrackCover } from './Cover.tsx'
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
  const duration = track ? status?.duration_ms ?? track.length_ms : null
  const repeat = status?.repeat ?? 'off'
  const shuffle = status?.shuffle ?? false
  const queued = status?.queue.length ?? 0
  const playing = status?.state === 'playing'
  // A failure takes the time bar's place, since there is no position to show.
  const failed = status?.state === 'error' && Boolean(status.error)

  return (
    <section className={s.player} aria-label="Player">
      <div className={s.indicators}>
        <button className="icon" title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={() => void player.set_shuffle(!shuffle)}>
          <Icon icon={ShuffleIcon} />
        </button>
        <button className="icon" title={repeat_label[repeat]} aria-label={repeat_label[repeat]} aria-pressed={repeat !== 'off'} onClick={() => void player.set_repeat(next_repeat[repeat])}>
          <Icon icon={repeat === 'one' ? RepeatOneIcon : RepeatIcon} />
        </button>
        {queued > 0 && <Badge tone="info">{queued} queued</Badge>}
        <span className={s.spacer} />
        {track && <Rating value={rating_to_stars(track.rating)} />}
      </div>

      <div className={s.main}>
        <div className={s.text}>
          <div className={s.transport}>
            <button className="icon" aria-label="Previous" title={`Previous (${describe_keys('alt+arrowleft')})`} onClick={() => void player.previous()}>
              <Icon icon={PreviousIcon} />
            </button>
            <button className="icon" aria-label="Stop" title="Stop" onClick={() => void player.stop()}>
              <Icon icon={StopIcon} />
            </button>
            <button className="icon accent solid" aria-label={playing ? 'Pause' : 'Play'} title={`${playing ? 'Pause' : 'Play'} (${describe_keys('ctrl+space')})`} onClick={() => void player.toggle()}>
              <Icon icon={playing ? PauseIcon : PlayIcon} />
            </button>
            <button className="icon" aria-label="Next" title={`Next (${describe_keys('alt+arrowright')})`} onClick={() => void player.next()}>
              <Icon icon={NextIcon} />
            </button>
            <span className={s.spacer} />
            <VolumeButton volume={status?.volume ?? 80} on_change={(volume) => void player.set_volume(volume)} />
          </div>

          <div className={cx(s.line, s.title)} title={track?.title ?? ''}>{track?.title ?? 'Nothing playing'}</div>
          <div className={cx(s.line, s.artist)} title={track?.artist ?? ''}>{track?.artist ?? '—'}</div>
          <div className={cx(s.line, s.album)} title={track?.album ?? ''}>{track?.album ?? '—'}</div>

          {!failed && <TimeBar duration_in_milliseconds={duration} />}
        </div>

        <TrackCover track_id={track?.id ?? null} size="medium" />
      </div>

      {failed && (
        <div className={s.error} role="alert">
          {track && <button onClick={() => void player.toggle()}>Try again</button>}
          <span className={cx(s.message, 'tone-bad')}>{status.error}</span>
        </div>
      )}
    </section>
  )
}
