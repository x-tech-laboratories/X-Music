// gmb's VolumeIcon: a button that reveals a slider in a popover; scrolling it adjusts the volume and a middle-click mutes.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Popover } from '@x-tech-laboratories/x-libs/web/react/menus'
import s from './VolumeButton.module.css'

const STEP = 5

export function VolumeButton({ volume = 80, onchange }: { volume?: number; onchange?: (volume: number) => void }) {
  const [open, set_open] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // The level before muting, so unmuting returns to it.
  const before_mute = useRef(80)
  // The click that closed the popover by landing on its button must not open it again.
  const closed_at = useRef(0)
  const latest_volume = useRef(volume)
  latest_volume.current = volume

  const icon = volume === 0 ? '🔇' : volume < 34 ? '🔈' : volume < 67 ? '🔉' : '🔊'

  function set(next: number): void {
    onchange?.(Math.max(0, Math.min(100, Math.round(next))))
  }

  function toggle_mute(): void {
    if (volume > 0) {
      before_mute.current = volume
      set(0)
    } else {
      set(before_mute.current || 80)
    }
  }

  // React's wheel listener is passive and cannot stop the page scrolling, so this one is attached by hand.
  useEffect(() => {
    const on_wheel = (event: WheelEvent): void => {
      event.preventDefault()
      set(latest_volume.current + (event.deltaY < 0 ? STEP : -STEP))
    }
    const button = trigger.current!
    button.addEventListener('wheel', on_wheel, { passive: false })
    return () => button.removeEventListener('wheel', on_wheel)
  })

  return (
    <>
      <button
        ref={trigger}
        className="icon"
        aria-label={`Volume ${volume}%`}
        aria-expanded={open}
        title={`Volume ${volume}% — scroll to adjust, middle-click to mute`}
        onClick={() => { if (Date.now() - closed_at.current > 300) set_open(!open) }}
        onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); toggle_mute() } }}
      >{icon}</button>

      {open && (
        <Popover anchor={trigger.current} label="Volume" on_close={() => { closed_at.current = Date.now(); set_open(false) }}>
          <div className={s.volume}>
            <button className="icon" onClick={toggle_mute} aria-label={volume === 0 ? 'Unmute' : 'Mute'}>{volume === 0 ? '🔇' : '🔊'}</button>
            <input className="seek input-sm" style={{ '--range-progress': `${volume}%` } as CSSProperties} type="range" min="0" max="100" step={STEP} value={volume} aria-label="Volume" onChange={(event) => set(Number(event.currentTarget.value))} />
            <span className={s.percent}>{volume}%</span>
          </div>
        </Popover>
      )}
    </>
  )
}
