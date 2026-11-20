// Filters and sorts as earlier versions of X-Music saved them, read into the shapes X-Libs' filter takes now: `cs` became
// `case_sensitive`, a span `{n, unit}` became `{count, unit}`, a sort key's `dir` became `descending` and its `seed` went,
// and a limit `{count}` became a plain number. Anything already in today's shape passes through unchanged.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FilterNode, SortKey } from '@x-tech-laboratories/x-libs/filter'

// ── Filters ──────────────────────────────────────────────────────────────────

const is_object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function upgrade_value(value: unknown): unknown {
  if (!is_object(value) || !('n' in value) || !('unit' in value) || 'count' in value) return value
  const { n, ...rest } = value
  return { count: n, ...rest }
}

// A filter tree in today's shape, from either shape.
export function upgrade_filter(node: unknown): FilterNode {
  if (!is_object(node)) return node as FilterNode
  if (Array.isArray(node.children)) return { ...node, children: node.children.map(upgrade_filter) } as unknown as FilterNode

  const { cs, ...rest } = node
  const leaf: Record<string, unknown> = 'value' in rest ? { ...rest, value: upgrade_value(rest.value) } : rest
  if (cs !== undefined && !('case_sensitive' in leaf)) leaf.case_sensitive = cs
  return leaf as unknown as FilterNode
}

// ── Sorts and limits ─────────────────────────────────────────────────────────

// One sort key in today's shape, from either shape; null for anything that is not one.
export function upgrade_sort_key(key: unknown): SortKey | null {
  if (!is_object(key) || typeof key.field !== 'string') return null
  return { field: key.field, descending: key.descending === true || key.dir === 'desc' }
}

export function upgrade_sort(keys: unknown): SortKey[] {
  return Array.isArray(keys) ? keys.map(upgrade_sort_key).filter((key): key is SortKey => key !== null) : []
}

// A row count from either shape; a limit by length or file size has no row count and stays as it was.
export function upgrade_limit(limit: unknown): unknown {
  if (!is_object(limit) || typeof limit.count !== 'number') return limit
  return limit.by === undefined || limit.by === 'tracks' ? limit.count : limit
}

// A saved definition in today's shape: a bare filter tree, or a filter with its sort and limit.
export function upgrade_definition(definition: unknown): unknown {
  if (!is_object(definition)) return definition
  if (!('filter' in definition)) return upgrade_filter(definition)

  const upgraded: Record<string, unknown> = { ...definition, filter: upgrade_filter(definition.filter) }
  if ('sort' in definition) upgraded.sort = upgrade_sort(definition.sort)
  if ('limit' in definition) upgraded.limit = upgrade_limit(definition.limit)
  return upgraded
}
