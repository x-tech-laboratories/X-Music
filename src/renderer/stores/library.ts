// View-model state for the library.
//
// The filter stack and sort state come from shared/view.ts, which is framework-free; this class only
// tells watching components when to re-read.

import type { FilterNode } from '@shared/filter'
import { leaf, or } from '@shared/filter'
import { FilterStack, Selection, SortState } from '@shared/view'
import type { GroupRow, LibraryStats, TrackRow } from '@shared/ipc'
import { field } from '@shared/fields'
import { readPref, writePref } from '@shared/prefs'
import { sanitizePaneValues, sanitizeSortKeys } from '@shared/viewstate'
import { ipc } from '../lib/ipc'
import { create_watch } from '../lib/watch'

const storage = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage

const KEY_SORT = 'x-music.pref.library.sort'
const KEY_PANES = 'x-music.pref.library.panes'
const KEY_SEARCH = 'x-music.pref.library.search'

const PAGE = 500

class LibraryStore {
  // Bumped when the results, stats, filters or error change.
  readonly data = create_watch()
  // Bumped when the selection changes, so a click does not re-render what only reads the results.
  readonly selection_changes = create_watch()

  private statsValue: LibraryStats | null = null
  private tracksValue: TrackRow[] = []
  private lastSqlValue = ''
  private errorValue: string | null = null
  private searchValue = ''

  private readonly stack = new FilterStack()
  private readonly sort = new SortState()
  /** Field id → selected values. Several values in one pane mean OR, as gmusicbrowser does. */
  private readonly paneValues = new Map<string, string[]>()
  /** Last clicked row per pane, so shift can extend from it. */
  private readonly paneAnchor = new Map<string, number>()
  private readonly selection = new Selection()

  get stats(): LibraryStats | null { return this.statsValue }
  set stats(v: LibraryStats | null) { this.statsValue = v; this.data.bump() }
  get tracks(): TrackRow[] { return this.tracksValue }
  set tracks(v: TrackRow[]) { this.tracksValue = v; this.data.bump() }
  get lastSql(): string { return this.lastSqlValue }
  set lastSql(v: string) { this.lastSqlValue = v; this.data.bump() }
  get error(): string | null { return this.errorValue }
  set error(v: string | null) { this.errorValue = v; this.data.bump() }
  get search(): string { return this.searchValue }
  set search(v: string) { this.searchValue = v; this.data.bump() }

  // Changes whenever the result set does, so panes can re-read without deep watching.
  get version(): number { return this.data.version() }

  constructor() {
    const saved = sanitizeSortKeys(readPref<unknown>(storage(), KEY_SORT, null))
    this.sort.set(saved.length > 0
      ? saved
      : [{ field: 'album' }, { field: 'disc_number' }, { field: 'track_number' }])

    // Pane selections and the search term are rebuilt into the filter stack, so the chips show up
    // and the user can see why the library is narrowed rather than wondering.
    for (const [fieldId, values] of Object.entries(
      sanitizePaneValues(readPref<unknown>(storage(), KEY_PANES, null))
    )) {
      this.applyPane(fieldId, values)
    }

    const search = readPref(storage(), KEY_SEARCH, '')
    if (typeof search === 'string' && search.trim() !== '') this.applySearch(search)
  }

  private persist(): void {
    writePref(storage(), KEY_SORT, this.sort.list())
    writePref(storage(), KEY_PANES, Object.fromEntries(this.paneValues))
    writePref(storage(), KEY_SEARCH, this.search)
  }

  private filter(): FilterNode {
    return this.stack.toFilter()
  }

  chips(): readonly { id: string; label: string }[] {
    return this.stack.list().filter((c) => c.removable).map((c) => ({ id: c.id, label: c.label }))
  }

  /**
   * The stack is the single source of truth for what is filtered, so a pane reads its own selection
   * back rather than keeping a private copy that could drift from the chips.
   */
  selectionFor(fieldId: string): readonly string[] {
    return this.paneValues.get(fieldId) ?? []
  }

  isPaneSelected(fieldId: string, value: string | null): boolean {
    const values = this.paneValues.get(fieldId)
    if (!values || values.length === 0) return value === null
    return value !== null && values.includes(value)
  }

  hasFilters(): boolean {
    return this.stack.list().some((c) => c.removable)
  }

  async clearFilters(): Promise<void> {
    this.stack.clear()
    this.paneValues.clear()
    this.paneAnchor.clear()
    this.search = ''
    this.persist()
    await this.refresh()
  }

  // ── selection ──────────────────────────────────────────────────────────
  isSelected(id: number): boolean {
    return this.selection.has(id)
  }

  selectedIds(): number[] {
    return this.selection.ids()
  }

  selectedCount(): number {
    return this.selection.size
  }

  /** Selection internals, for diagnostics only. */
  inspectSelection(): { size: number; anchor: number | null } {
    return this.selection.inspect()
  }

  clickRow(index: number, modifiers: { shift?: boolean; ctrl?: boolean }): void {
    const ordered = this.tracks.map((t) => t.id)
    const intent = modifiers.shift
      ? (modifiers.ctrl ? 'range-add' : 'range')
      : modifiers.ctrl ? 'toggle' : 'replace'

    this.selection.apply(ordered, index, intent)
    this.selection_changes.bump()
  }

  selectAll(): void {
    this.selection.selectAll(this.tracks.map((t) => t.id))
    this.selection_changes.bump()
  }

  clearSelection(): void {
    this.selection.clear()
    this.selection_changes.bump()
  }

  async refresh(): Promise<void> {
    try {
      this.error = null
      this.stats = await ipc('library:stats')

      const req = { filter: this.filter(), sort: [...this.sort.list()], limit: { count: PAGE } }
      this.tracks = await ipc('library:query', req)
      this.lastSql = (await ipc('library:explain', req)).sql

      // A narrowed result set must not leave selections pointing at rows nobody can see.
      this.selection.retain(this.tracks.map((t) => t.id))
      this.selection_changes.bump()
      this.data.bump()
    } catch (err) {
      this.error = (err as Error).message
    }
  }

  async groupsFor(fieldId: string): Promise<GroupRow[]> {
    try {
      return await ipc('library:groupBy', { filter: this.filter(), field: fieldId })
    } catch (err) {
      this.error = (err as Error).message
      return []
    }
  }

  /**
   * A pane click narrows the query. Several values within one pane are OR'd together, which is what
   * makes "Jazz and Blues" a single browse step rather than two.
   */
  async setPaneFilter(
    fieldId: string,
    value: string | null,
    modifiers: { shift?: boolean; ctrl?: boolean; index?: number; ordered?: readonly (string | null)[] } = {}
  ): Promise<void> {
    const current = this.paneValues.get(fieldId) ?? []
    let next: string[]

    if (value === null) {
      next = []
    } else if (modifiers.shift && modifiers.ordered && modifiers.index !== undefined) {
      const anchor = this.paneAnchor.get(fieldId) ?? modifiers.index
      const [lo, hi] = anchor <= modifiers.index
        ? [anchor, modifiers.index]
        : [modifiers.index, anchor]
      next = modifiers.ordered.slice(lo, hi + 1).filter((v): v is string => v !== null)
    } else if (modifiers.ctrl) {
      next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      this.paneAnchor.set(fieldId, modifiers.index ?? 0)
    } else {
      // A plain click on the only selected value clears it, which is how a toggle should feel.
      next = current.length === 1 && current[0] === value ? [] : [value]
      this.paneAnchor.set(fieldId, modifiers.index ?? 0)
    }

    this.applyPane(fieldId, next)
    this.persist()
    await this.refresh()
  }

  private applyPane(fieldId: string, values: readonly string[]): void {
    const id = `pane:${fieldId}`

    if (values.length === 0) {
      this.stack.remove(id)
      this.paneValues.delete(fieldId)
      return
    }

    this.paneValues.set(fieldId, [...values])
    const d = field(fieldId)

    const node = d.storage === 'multi'
      ? leaf(fieldId, 'any', [...values])
      : values.length === 1
        ? leaf(fieldId, 'is', d.type === 'integer' ? Number(values[0]) : values[0]!)
        : or(...values.map((v) => leaf(fieldId, 'is', d.type === 'integer' ? Number(v) : v)))

    const label = values.length === 1
      ? `${d.name}: ${values[0]}`
      : `${d.name}: ${values.length} selected`

    this.stack.push({ id, label, node, removable: true })
  }

  private applySearch(text: string): void {
    this.search = text
    const id = 'search'

    if (text.trim() === '') this.stack.remove(id)
    else {
      this.stack.push({
        id,
        label: `"${text}"`,
        node: leaf('title', 'contains', text.trim()),
        removable: true
      })
    }
  }

  async setSearch(text: string): Promise<void> {
    this.applySearch(text)
    this.persist()
    await this.refresh()
  }

  async removeChip(id: string): Promise<void> {
    this.stack.remove(id)
    if (id.startsWith('pane:')) {
      const fieldId = id.slice('pane:'.length)
      this.paneValues.delete(fieldId)
      this.paneAnchor.delete(fieldId)
    }
    if (id === 'search') this.search = ''
    this.persist()
    await this.refresh()
  }

  async toggleSort(fieldId: string, additive: boolean): Promise<void> {
    this.sort.toggle(fieldId, additive)
    this.persist()
    await this.refresh()
  }

  sortPriority(fieldId: string): number {
    return this.sort.priority(fieldId)
  }

  sortDir(fieldId: string): 'asc' | 'desc' | null {
    return this.sort.list().find((k) => k.field === fieldId)?.dir ?? null
  }
}

export const library = new LibraryStore()
