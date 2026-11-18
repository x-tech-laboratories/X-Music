// Validating remembered browse state.
// Sorts and filters are remembered across launches, which means they can outlive the fields they
// name: a user field gets deleted, a built-in gets renamed, an older version wrote a different
// shape. Restoring blindly would either crash the view or silently filter the library down to
// nothing with no visible cause, so everything restored is checked against the current catalogue
// and anything unrecognised is dropped.

import { random_field, type SortKey } from '@x-tech-laboratories/x-libs/filter'

import { FIELDS_BY_ID } from './fields.ts'
import { upgrade_sort } from './filter_shapes.ts'

const known = (field_id: unknown): field_id is string =>
  typeof field_id === 'string' && FIELDS_BY_ID.has(field_id)

// Sort keys in today's shape from either saved shape, each field once and only fields that still exist.
export function sanitize_sort_keys(value: unknown): SortKey[] {
  const out: SortKey[] = []
  for (const key of upgrade_sort(value)) {
    // `random` is a pseudo-field the catalogue does not contain but sorting understands.
    if (!known(key.field) && key.field !== random_field) continue
    if (out.some((kept) => kept.field === key.field)) continue
    out.push(key)
  }
  return out
}

export function sanitize_pane_values(value: unknown): Record<string, string[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}

  const out: Record<string, string[]> = {}
  for (const [field_id, values] of Object.entries(value as Record<string, unknown>)) {
    if (!known(field_id)) continue
    if (!Array.isArray(values)) continue

    const strings = values.filter((v): v is string => typeof v === 'string' && v !== '')
    if (strings.length > 0) out[field_id] = strings
  }
  return out
}

// A pane remembers which field it is showing; an unknown field falls back to the default.
export function sanitize_pane_field(value: unknown, fallback: string): string {
  return known(value) ? value : fallback
}
