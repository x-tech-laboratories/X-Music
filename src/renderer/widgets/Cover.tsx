// Cover art for a track. Resolution is lazy in the main process, so this asks and waits; a track
// with no art shows a stable placeholder rather than a broken image or a flicker.

import { useEffect, useState } from 'react'
import { ipc } from '../lib/ipc'
import { cx } from '@x-tech-laboratories/x-libs/web/dom'
import s from './Cover.module.css'

export function Cover({
  trackId = null,
  size = 88,
  rounded = true
}: { trackId?: number | null; size?: number; rounded?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const id = trackId
    setUrl(null)

    if (id === null || id === undefined) return

    let cancelled = false
    setLoading(true)

    void ipc('art:forTrack', { trackId: id, size })
      .then((art) => {
        // A slower earlier request must not overwrite a newer track's cover.
        if (!cancelled) setUrl(art.url)
      })
      .catch(() => { if (!cancelled) setUrl(null) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [trackId, size])

  return (
    <div
      className={cx(s.cover, rounded && s.rounded)}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      {url ? (
        <img className={s.image} src={url} alt="" loading="lazy" />
      ) : !loading && (
        <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 18V5l10-2v13" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  )
}
