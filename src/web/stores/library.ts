// The library's browse state as X-Libs stores: the tracks the filters let through, how they are sorted and narrowed, and the picked rows.

import { browser_storage, read_pref, write_pref } from '@x-tech-laboratories/x-libs/web/prefs'
import { describe_error } from '@x-tech-laboratories/x-libs/web/errors'
import { intent_for, Selection } from '@x-tech-laboratories/x-libs/web/selection'
import { create_store } from '@x-tech-laboratories/x-libs/web/store'
import type { Sorting } from '@x-tech-laboratories/x-libs/web/tables'
import { create_watch } from '@x-tech-laboratories/x-libs/web/watch'
import { FilterStack, leaf, or, type FilterNode, type SortKey } from '@x-tech-laboratories/x-libs/filter'
import type { GroupRow, LibraryStats, TrackRow } from '@shared/ipc'
import { field } from '@shared/fields'
import { sanitize_pane_values, sanitize_sort_keys } from '@shared/viewstate'
import { ipc } from '../lib/ipc.ts'

// A track's id as the main process hands it over, never read as a number.
export type TrackId = TrackRow['id']

// ============================================================================
// Stores
// ============================================================================

export interface Results {
  stats: LibraryStats | null
  // Every track the filters let through, in the library's sort.
  tracks: TrackRow[]
  // The tracks' ids in the same order, which selection ranges and playing read.
  order: TrackId[]
  error: string | null
}

export interface Browse {
  sort: SortKey[]
  // Field id to the values picked in its pane; several values in one pane mean any of them.
  panes: Record<string, string[]>
  search: string
}

const SORT_KEY = 'x-music.pref.library.sort'
const PANES_KEY = 'x-music.pref.library.panes'
const SEARCH_KEY = 'x-music.pref.library.search'

const DEFAULT_SORT: SortKey[] = [{ field: 'album' }, { field: 'disc_number' }, { field: 'track_number' }]

function remembered(): Browse {
  const storage = browser_storage()
  const sort = sanitize_sort_keys(read_pref<unknown>(storage, SORT_KEY, null))
  const search = read_pref<unknown>(storage, SEARCH_KEY, '')
  return {
    sort: sort.length > 0 ? sort : DEFAULT_SORT,
    panes: sanitize_pane_values(read_pref<unknown>(storage, PANES_KEY, null)),
    search: typeof search === 'string' ? search : ''
  }
}

export const results = create_store<Results>({ stats: null, tracks: [], order: [], error: null })
export const browse = create_store<Browse>(remembered())
// True while the tracks are being fetched again.
export const loading = create_store(false)

const selection = new Selection<TrackId>()
const selection_changes = create_watch()

browse.watch.subscribe(() => {
  const storage = browser_storage()
  const state = browse.get()
  write_pref(storage, SORT_KEY, state.sort)
  write_pref(storage, PANES_KEY, state.panes)
  write_pref(storage, SEARCH_KEY, state.search)
})

// ============================================================================
// Filters
// ============================================================================

function pane_node(field_id: string, values: readonly string[]): FilterNode {
  const descriptor = field(field_id)
  if (descriptor.storage === 'multi') return leaf(field_id, 'any', [...values])
  const typed = (value: string) => (descriptor.type === 'integer' ? Number(value) : value)
  return values.length === 1 ? leaf(field_id, 'is', typed(values[0]!)) : or(...values.map((value) => leaf(field_id, 'is', typed(value))))
}

// The filter stack the browse state stands for, leaving out one pane so that pane can still offer every value.
function stack_of(state: Browse, leave_out?: string): FilterStack {
  const stack = new FilterStack()
  for (const [field_id, values] of Object.entries(state.panes)) {
    if (field_id === leave_out || values.length === 0) continue
    const name = field(field_id).name
    const label = values.length === 1 ? `${name}: ${values[0]}` : `${name}: ${values.length} picked`
    stack.push({ id: `pane:${field_id}`, label, node: pane_node(field_id, values), removable: true })
  }
  if (state.search.trim() !== '') {
    stack.push({ id: 'search', label: `Title: ${state.search.trim()}`, node: leaf('title', 'contains', state.search.trim()), removable: true })
  }
  return stack
}

export const filter_of = (state: Browse, leave_out?: string): FilterNode => stack_of(state, leave_out).to_filter()

// The chips that say why the list is narrowed, each one removable.
export const chips_of = (state: Browse): { id: string; label: string }[] =>
  stack_of(state).list().map((chip) => ({ id: chip.id, label: chip.label }))

// ============================================================================
// Loading
// ============================================================================

let latest_request = 0

// Fetches the stats and every track the filters let through; a reply overtaken by a newer request is dropped.
async function refresh(): Promise<void> {
  const request = ++latest_request
  loading.set(true)
  try {
    const state = browse.get()
    const [stats, tracks] = await Promise.all([
      ipc('get_library_stats'),
      ipc('list_tracks', filter_of(state), [...state.sort])
    ])
    if (request !== latest_request) return
    const order = tracks.map((track) => track.id)
    // A narrowed list must not leave picks on rows nobody can see.
    selection.retain(order)
    selection_changes.bump()
    results.set({ stats, tracks, order, error: null })
  } catch (error) {
    if (request === latest_request) results.update((before) => ({ ...before, error: describe_error(error) }))
  } finally {
    if (request === latest_request) loading.set(false)
  }
}

function change_browse(make: (state: Browse) => Browse): Promise<void> {
  browse.update(make)
  return refresh()
}

// The values of a field under every filter but its own pane's, which throws so the pane can show why.
function groups_for(field_id: string): Promise<GroupRow[]> {
  return ipc('list_track_groups', filter_of(browse.get(), field_id), field_id)
}

// ============================================================================
// Track names
// ============================================================================

export interface TrackName { title: string; artist: string }

const names_fetched = new Map<TrackId, TrackName>()

// The title and artist of each id, from the loaded list or else asked of the library once, for tracks the filters hide.
async function names_of(ids: readonly TrackId[]): Promise<Map<TrackId, TrackName>> {
  const loaded = new Map(results.get().tracks.map((track) => [track.id, track]))
  const names = new Map<TrackId, TrackName>()
  await Promise.all(ids.map(async (id) => {
    const track = loaded.get(id)
    if (track) return void names.set(id, { title: track.title ?? '', artist: track.artist ?? '' })
    if (!names_fetched.has(id)) {
      const details = await ipc('get_track', id)
      const artist = details?.fields.find((each) => each.field === 'artist')?.value ?? ''
      names_fetched.set(id, { title: details?.title ?? '', artist })
    }
    names.set(id, names_fetched.get(id)!)
  }))
  return names
}

// ============================================================================
// Library
// ============================================================================

export const library = {
  // Bumps when the results change; the status bar and Settings read it.
  data: results.watch,
  selection_changes,

  get stats(): LibraryStats | null { return results.get().stats },
  get error(): string | null { return results.get().error },
  get tracks(): TrackRow[] { return results.get().tracks },

  refresh,
  groups_for,
  names_of,

  // ── Panes and search ──

  set_pane: (field_id: string, values: readonly string[]): Promise<void> =>
    change_browse((state) => ({ ...state, panes: { ...state.panes, [field_id]: [...values] } })),

  set_search: (search: string): Promise<void> => change_browse((state) => ({ ...state, search })),

  remove_chip: (id: string): Promise<void> => change_browse((state) => {
    if (id === 'search') return { ...state, search: '' }
    const panes = { ...state.panes }
    delete panes[id.slice('pane:'.length)]
    return { ...state, panes }
  }),

  clear_filters: (): Promise<void> => change_browse((state) => ({ ...state, panes: {}, search: '' })),

  // ── Sorting ──

  sorting: (): Sorting[] => browse.get().sort.map((key) => ({ key: key.field, descending: key.descending === true })),

  set_sorting: (sorting: readonly Sorting[]): Promise<void> =>
    change_browse((state) => ({ ...state, sort: sorting.map((key) => ({ field: key.key, descending: key.descending })) })),

  // ── Picked rows ──

  is_selected: (id: TrackId): boolean => selection.has(id),
  selected_ids: (): TrackId[] => selection.ids(),
  selected_count: (): number => selection.size,
  // The picks and the anchor, for finding why a range came out wrong.
  inspect_selection: () => selection.inspect(),

  click_row(index: number, modifiers: { shift?: boolean; ctrl?: boolean }): void {
    selection.apply(results.get().order, index, intent_for(modifiers))
    selection_changes.bump()
  },

  select_all(): void {
    selection.select_all(results.get().order)
    selection_changes.bump()
  },

  clear_selection(): void {
    selection.clear()
    selection_changes.bump()
  }
}
