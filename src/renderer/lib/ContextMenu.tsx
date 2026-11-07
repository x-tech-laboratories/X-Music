// A right-click menu positioned at the pointer, kept on screen, dismissed by Escape, a click
// elsewhere, or choosing something. Items are data so callers describe a menu rather than build
// one — which is what the layout system will need when menus become user-configurable (§6.1).

import { Fragment } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './cx'
import s from './ContextMenu.module.css'

export interface MenuItem {
  id: string
  label: string
  /** Right-aligned hint, for a keyboard shortcut. */
  hint?: string
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  action: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onclose
}: { x: number; y: number; items: MenuItem[]; onclose?: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Handlers attached once read the latest callback through this.
  const close = useRef(onclose)
  close.current = onclose

  // Flip rather than overflow: a menu opened near an edge should stay fully visible.
  useLayoutEffect(() => {
    const el = menu.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    setPos({
      left: x + rect.width + pad > window.innerWidth ? Math.max(pad, x - rect.width) : x,
      top: y + rect.height + pad > window.innerHeight ? Math.max(pad, y - rect.height) : y
    })
  }, [x, y])

  useEffect(() => {
    const dismiss = (e: Event): void => {
      if (menu.current && !menu.current.contains(e.target as Node)) close.current?.()
    }
    const onBlur = (): void => close.current?.()
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close.current?.() }
    }

    // Attaching immediately could register these while the very click that opened the menu is
    // still bubbling, and the menu would dismiss itself the instant it appeared.
    const attach = setTimeout(() => {
      document.addEventListener('pointerdown', dismiss)
      document.addEventListener('contextmenu', dismiss)
      window.addEventListener('blur', onBlur)
    }, 0)
    window.addEventListener('keydown', onKeydown)

    return () => {
      clearTimeout(attach)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('contextmenu', dismiss)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeydown)
    }
  }, [])

  function choose(item: MenuItem): void {
    if (item.disabled) return
    item.action()
    onclose?.()
  }

  return (
    <div
      className={s.menu}
      ref={menu}
      role="menu"
      tabIndex={-1}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore && <div className={s.sep} role="separator"></div>}
          <button
            role="menuitem"
            className={cx(s.item, item.danger && s.danger)}
            disabled={item.disabled}
            onClick={() => choose(item)}
          >
            <span className={s.label}>{item.label}</span>
            {item.hint && <span className={s.hint}>{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
