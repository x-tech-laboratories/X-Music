// The filter AST (DESIGN-SPEC §4.1). One representation serves saved filters, smart playlists,
// the search bar and the browser panes — and it is imported by both the query engine and the UI
// that builds queries, which is the main structural payoff of a single-language stack.

export type ScalarOp =
  | 'is' | 'not_is' | 'contains' | 'starts' | 'ends' | 'regex'
  | '>' | '<' | '>=' | '<=' | 'between' | 'not_between'
  | 'top' | 'bottom'
  | 'empty' | 'defined'

export type SetOp = 'any' | 'all' | 'none' | 'count'
export type DateOp = 'before' | 'after' | 'in_last' | 'not_in_last'
export type RefOp = 'in_playlist' | 'in_filter'
export type FtsOp = 'matches'

export type LeafOp = ScalarOp | SetOp | DateOp | RefOp | FtsOp

export type DateUnit = 'hour' | 'day' | 'week' | 'month' | 'year'
export interface RelativeDate { n: number; unit: DateUnit }

export type FilterValue =
  | string | number | boolean | null
  | readonly string[] | readonly number[]
  | RelativeDate

export interface LeafNode {
  field: string
  op: LeafOp
  value?: FilterValue
  /** Case-sensitive comparison; defaults to false for string ops. */
  cs?: boolean
}

export interface GroupNode {
  op: 'and' | 'or' | 'not'
  children: readonly FilterNode[]
}

export type FilterNode = LeafNode | GroupNode

export const is_group = (n: FilterNode): n is GroupNode =>
  (n as GroupNode).children !== undefined

export interface SortKey {
  field: string
  dir?: 'asc' | 'desc'
  /** Seed policy for the `random` pseudo-field. */
  seed?: string
}

export interface Limit {
  count: number
  by?: 'tracks' | 'duration' | 'filesize'
}

export interface SavedFilter {
  id: string
  name: string
  filter: FilterNode
  sort?: readonly SortKey[]
  limit?: Limit
  refresh?: 'live' | 'on_open' | 'manual'
}

export const and = (...children: FilterNode[]): GroupNode => ({ op: 'and', children })
export const or = (...children: FilterNode[]): GroupNode => ({ op: 'or', children })
export const not = (child: FilterNode): GroupNode => ({ op: 'not', children: [child] })
export const leaf = (field: string, op: LeafOp, value?: FilterValue): LeafNode =>
  value === undefined ? { field, op } : { field, op, value }

/** Walks the tree, collecting every field the filter touches. */
export function referenced_fields(node: FilterNode, into = new Set<string>()): Set<string> {
  if (is_group(node)) node.children.forEach((c) => referenced_fields(c, into))
  else into.add(node.field)
  return into
}

/** Rejects cycles created by `in_filter` composition before a filter is saved. */
export function find_cycle(
  id: string,
  node: FilterNode,
  resolve: (ref: string) => FilterNode | undefined,
  seen: readonly string[] = []
): string[] | null {
  if (is_group(node)) {
    for (const c of node.children) {
      const cycle = find_cycle(id, c, resolve, seen)
      if (cycle) return cycle
    }
    return null
  }
  if (node.op !== 'in_filter' || typeof node.value !== 'string') return null

  const ref = node.value
  if (ref === id || seen.includes(ref)) return [...seen, ref]

  const target = resolve(ref)
  return target ? find_cycle(id, target, resolve, [...seen, ref]) : null
}
