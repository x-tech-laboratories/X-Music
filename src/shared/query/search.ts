// The search bar's language over X-Music's fields, read by X-Libs filter_query: `artist:beatles rating:>3
// year:1965..1970 -live played:<30d`, with plain words searched in the full-text index (DESIGN-SPEC §4.4).

// ── Imports ──────────────────────────────────────────────────────────────────

import { leaf, type FilterNode } from '@x-tech-laboratories/x-libs/filter'
import { parse_filter_query, type ParsedQuery, type QueryField, type QueryFieldKind } from '@x-tech-laboratories/x-libs/filter_query'

import { BUILTIN_FIELDS, stars_to_rating, type FieldDescriptor } from '../fields.ts'

// ── Names ────────────────────────────────────────────────────────────────────

// Short names people type besides each field's id and name.
const extra_names: Readonly<Record<string, readonly string[]>> = {
  last_played: ['played'],
  last_skipped: ['skipped'],
  play_count: ['plays'],
  skip_count: ['skips'],
  track_number: ['track'],
  disc_number: ['disc'],
  tags: ['label', 'labels'],
  album_artist: ['albumartist'],
  length: ['len', 'duration']
}

const names_of = (descriptor: FieldDescriptor): string[] => {
  const spelled = descriptor.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  return [...new Set([descriptor.id, spelled, spelled.replace(/_/g, ''), ...(extra_names[descriptor.id] ?? [])])]
}

// ── Values ───────────────────────────────────────────────────────────────────

// Up to 5 is stars, above it the stored 0 to 100.
export function parse_rating(text: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const number = Number(text)
  if (number <= 5) return stars_to_rating(number)
  return number <= 100 ? Math.round(number) : null
}

// A length as 4:05, 1:02:03, 4m, 90s or 1m30s, or plain seconds, in milliseconds.
export function parse_length(text: string): number | null {
  const clock = /^(?:(\d+):)?(\d+):(\d{1,2})$/.exec(text)
  if (clock) return ((Number(clock[1] ?? 0) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000)
  const spelled = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text)
  if (!spelled || text === '') return null
  return ((Number(spelled[1] ?? 0) * 60 + Number(spelled[2] ?? 0)) * 60 + Number(spelled[3] ?? 0)) * 1000
}

const plain_number = (text: string): number | null => (/^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null)

const kind_of: Readonly<Record<FieldDescriptor['type'], QueryFieldKind>> = {
  string: 'text', text: 'text', path: 'text', enum: 'text',
  set: 'set', artist: 'set',
  integer: 'number', float: 'number', rating: 'number', duration: 'number', bool: 'number',
  date: 'date', datelist: 'date'
}

// ── The language ─────────────────────────────────────────────────────────────

// The fields the search bar reads; a set field's values, when given, are found whatever case they are typed in.
export function search_fields(values: Readonly<Record<string, readonly string[]>> = {}): QueryField[] {
  return BUILTIN_FIELDS.filter((descriptor) => descriptor.flags.includes('filterable')).map((descriptor) => {
    const kind = kind_of[descriptor.type]
    const parse_number = descriptor.type === 'rating' ? parse_rating : descriptor.type === 'duration' ? parse_length : plain_number
    return {
      field: descriptor.id,
      kind,
      names: names_of(descriptor),
      label: descriptor.name,
      ...(kind === 'number' ? { parse_number } : {}),
      ...(kind === 'date' ? { clock: 'milliseconds' as const } : {}),
      ...(values[descriptor.id] ? { values: values[descriptor.id] } : {})
    }
  })
}

// Words for the full-text index: one quoted phrase, its last word matching as a prefix, so "beat" finds Beatles.
export function full_text(words: string): FilterNode {
  return leaf('title', 'matches', `"${words.replace(/"/g, '""')}"*`)
}

export function parse_search(text: string, values: Readonly<Record<string, readonly string[]>> = {}): ParsedQuery {
  return parse_filter_query(text, { fields: search_fields(values), text: full_text })
}

// The set fields a search names, whose values should be known before it is read.
export function set_fields_named(text: string): string[] {
  const by_name = new Map(search_fields().filter((field) => field.kind === 'set').flatMap((field) => field.names.map((name) => [name, field.field] as const)))
  const named = [...text.matchAll(/(?:^|\s)-?([A-Za-z_][\w-]*)[:=]/g)].map((match) => by_name.get(match[1]!.toLowerCase()))
  return [...new Set(named.filter((field): field is string => field !== undefined))]
}
