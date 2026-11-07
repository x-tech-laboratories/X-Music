// A full-screen view over the library.
//
// Earlier full-page views could strand the user — the problem was never the format, it was the
// missing way out. So the exit is structural here rather than left to each caller: a persistent
// close control in the header, and Escape.

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { cx } from './cx'
import s from './Page.module.css'

export function Page({
  title,
  subtitle,
  onclose,
  actions,
  nav,
  children
}: {
  title: string
  subtitle?: string
  onclose?: () => void
  /** Buttons for the header's right side. */
  actions?: ReactNode
  /** Optional left-hand navigation column. */
  nav?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onclose?.()
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [onclose])

  return (
    <div className={s.page} role="dialog" aria-modal="true" aria-label={title}>
      <header className={s.header}>
        <div className={s.titles}>
          <h1 className={s.title}>{title}</h1>
          {subtitle && <p className={s.subtitle}>{subtitle}</p>}
        </div>

        <div className={s.actions}>
          {actions}
          <button className={s.close} onClick={onclose} title="Close (Esc)">Close</button>
        </div>
      </header>

      <div className={cx(s.body, nav != null && s.withNav)}>
        {nav != null && <nav className={s.nav}>{nav}</nav>}
        <main className={s.main}>{children}</main>
      </div>
    </div>
  )
}
