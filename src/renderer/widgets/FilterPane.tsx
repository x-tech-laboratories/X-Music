import { useEffect, useState } from 'react'
import type { GroupRow } from '@shared/ipc'
import { fieldsWith } from '@shared/fields'
import { sanitizePaneField } from '@shared/viewstate'
import { library } from '../stores/library'
import { use_pref } from '../lib/prefs'
import { use_watch } from '../lib/watch'
import { cx } from '../lib/cx'
import s from './FilterPane.module.css'

// Every groupable field, per DESIGN-SPEC §3.2.1: no field is second class, so the list is
// derived from the catalogue rather than being a hand-picked few.
const groupable = fieldsWith('groupable')
  .map((d) => ({ id: d.id, name: d.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

export function FilterPane({ field = 'genre', id = 'pane' }: { field?: string; id?: string }) {
  // The prop is the default; what the user last chose wins, if it still names a real field.
  const [remembered, remember] = use_pref<string>(`pane.${id}.field`, field)
  const current = sanitizePaneField(remembered, field)
  const setCurrent = remember
  use_watch(library.data)
  const [rows, setRows] = useState<GroupRow[]>([])

  // Read the selection back from the filter stack so a chip removal updates the pane too.
  const selectedCount = library.selectionFor(current).length

  const version = library.version
  useEffect(() => {
    void (async () => setRows(await library.groupsFor(current)))()
  }, [current, version])

  async function pick(row: GroupRow, index: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): Promise<void> {
    await library.setPaneFilter(current, row.label ?? null, {
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      index,
      ordered: rows.map((r) => r.label)
    })
  }

  async function clear(): Promise<void> {
    await library.setPaneFilter(current, null)
  }

  const total = rows.reduce((n, r) => n + r.n, 0)

  /** A rating is stored 0-100 but read as stars, so the pane shows what the user recognises. */
  function display(label: string | null): string {
    if (label === null || label === '') return '(none)'
    if (current !== 'rating') return label
    const n = Number(label)
    if (!Number.isFinite(n)) return label
    const stars = Math.round(n / 20)
    return `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`
  }

  return (
    <section className={s.pane} aria-label="Filter pane">
      <header className={s.header}>
        <select
          className={s.select}
          value={current}
          onChange={(e) => setCurrent((e.currentTarget as HTMLSelectElement).value)}
        >
          {groupable.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <span className={s.count}>
          {selectedCount > 1 ? `${selectedCount} of ${rows.length}` : rows.length}
        </span>
      </header>

      <ul className={s.list}>
        <li>
          <button className={cx(s.row, s.all, selectedCount === 0 && s.sel)} onClick={clear}>
            <span className={s.label}>All</span>
            <span className={s.n}>{total.toLocaleString()}</span>
          </button>
        </li>
        {rows.length === 0 ? (
          <li className={s.empty}>No values</li>
        ) : rows.map((g, i) => (
          <li key={g.gid}>
            <button
              className={cx(s.row, library.isPaneSelected(current, g.label ?? null) && s.sel)}
              onClick={(e) => pick(g, i, e)}
            >
              <span className={s.label}>{display(g.label)}</span>
              <span className={s.n}>{g.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
