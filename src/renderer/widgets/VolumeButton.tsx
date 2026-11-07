// gmb's VolumeIcon: a button that reveals a slider, rather than a slider taking up bar space
// permanently. Scrolling the button adjusts volume without opening anything, which is how most
// players behave and is the fastest path for small changes.

import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import s from './VolumeButton.module.css'

export function VolumeButton({
  volume = 80,
  onchange
}: { volume?: number; onchange?: (v: number) => void }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  /** Remembers the level before muting, so unmuting returns to it. */
  const beforeMute = useRef(80)

  const icon = volume === 0 ? '🔇' : volume < 34 ? '🔈' : volume < 67 ? '🔉' : '🔊'

  function set(v: number): void {
    onchange?.(Math.max(0, Math.min(100, Math.round(v))))
  }

  // React's wheel listener is passive and cannot stop the page scrolling, so this one is attached by hand.
  const trigger = useRef<HTMLButtonElement>(null)
  const latestVolume = useRef(volume)
  latestVolume.current = volume
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      set(latestVolume.current + (e.deltaY < 0 ? 5 : -5))
    }
    const el = trigger.current!
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  function toggleMute(): void {
    if (volume > 0) {
      beforeMute.current = volume
      set(0)
    } else {
      set(beforeMute.current || 80)
    }
  }

  // The keys only act while the popover is open, so the listener exists only then.
  useEffect(() => {
    if (!open) return
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(volume + 5) }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(volume - 5) }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [open, volume, onchange])

  // Clicking anywhere else dismisses the popover, which is what makes it feel like a menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      const el = wrapper.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div className={s.wrap} ref={wrapper}>
      <button
        ref={trigger}
        className={cx(s.trigger, open && s.open)}
        aria-label={`Volume ${volume}%`}
        aria-expanded={open}
        title={`Volume ${volume}% — scroll to adjust, middle-click to mute`}
        onClick={() => setOpen(!open)}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); toggleMute() } }}
      >{icon}</button>

      {open && (
        <div className={s.popover} role="group" aria-label="Volume">
          <button className={s.mute} onClick={toggleMute} title={volume === 0 ? 'Unmute' : 'Mute'}>
            {volume === 0 ? '🔇' : '🔊'}
          </button>
          <input
            className={s.range}
            type="range" min="0" max="100"
            value={volume}
            aria-label="Volume"
            onChange={(e) => set(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span className={s.pct}>{volume}%</span>
        </div>
      )}
    </div>
  )
}
