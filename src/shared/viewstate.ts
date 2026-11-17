// Validating remembered browse state.
//
// Sorts and filters are remembered across launches, which means they can outlive the fields they
// name: a user field gets deleted, a built-in gets renamed, an older version wrote a different
// shape. Restoring blindly would either crash the view or silently filter the library down to
// nothing with no visible cause, so everything restored is checked against the current catalogue
// and anything unrecognised is dropped.

import { FIELDS_BY_ID } from './fields.ts'
import type { SortKey } from './filter.ts'

const known = (fieldId: unknown): fieldId is string =>
  typeof fieldId === 'string' && FIELDS_BY_ID.has(fieldId)

export function sanitizeSortKeys(value: unknown): SortKey[] {
  if (!Array.isArray(value)) return []

  const out: SortKey[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const { field, dir } = entry as { field?: unknown; dir?: unknown }

    // `random` is a pseudo-field the catalogue does not contain but sorting understands.
    if (!known(field) && field !== 'random') continue
    if (seen.has(field as string)) continue

    seen.add(field as string)
    out.push({ field: field as string, dir: dir === 'desc' ? 'desc' : 'asc' })
  }

  return out
}

export function sanitizePaneValues(value: unknown): Record<string, string[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}

  const out: Record<string, string[]> = {}
  for (const [fieldId, values] of Object.entries(value as Record<string, unknown>)) {
    if (!known(fieldId)) continue
    if (!Array.isArray(values)) continue

    const strings = values.filter((v): v is string => typeof v === 'string' && v !== '')
    if (strings.length > 0) out[fieldId] = strings
  }
  return out
}

/** A pane remembers which field it is showing; an unknown field falls back to the default. */
export function sanitizePaneField(value: unknown, fallback: string): string {
  return known(value) ? value : fallback
}
