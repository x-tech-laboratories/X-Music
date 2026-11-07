// The native predicate: the second compilation target for the filter AST (DESIGN-SPEC §4.2).
//
// This is the path the UI hits on every keystroke. It must agree with the SQL compiler exactly —
// including SQLite's quirks, which is why the string helpers below fold only ASCII case and why
// every comparison against a NULL yields false rather than throwing.

import { field, type FieldDescriptor } from '@shared/fields'
import { isGroup, type FilterNode, type LeafNode, type RelativeDate } from '@shared/filter'

/** One track as held by the in-memory index. */
export interface IndexedTrack {
  id: number
  scalars: Record<string, string | number | null>
  /** field_id → interned values, mirroring track_values. */
  sets: Record<number, readonly string[]>
  /** field_id → value, mirroring track_extras. */
  extras: Record<number, string | null>
  /** Physical sources, mirroring the media table. A track may legitimately have none. */
  media: readonly Record<string, string | number | null>[]
}

export interface EvalContext {
  now: number
  /** Precomputed id sets for `top` / `bottom`, keyed `${field}:${op}:${n}`. */
  ranked?: Map<string, ReadonlySet<number>>
}

const MS: Record<RelativeDate['unit'], number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000
}

/** SQLite's LIKE folds ASCII case only; Unicode case is left alone. Match that exactly. */
function asciiLower(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]
  }
  return out
}

function scalarOf(t: IndexedTrack, d: FieldDescriptor): string | number | null {
  if (d.storage === 'extra') return t.extras[d.fieldId!] ?? null
  return t.scalars[d.id] ?? null
}

/** Mirrors the SQL side's preferred-source ordering for sorting and grouping. */
export function preferredMedia(t: IndexedTrack): Record<string, string | number | null> | null {
  if (!t.media.length) return null
  return [...t.media].sort(
    (a, b) => Number(b.quality_rank ?? 0) - Number(a.quality_rank ?? 0)
  )[0]!
}

function cmp(a: string | number | null, b: unknown): number | null {
  if (a === null || b === null || b === undefined) return null
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  const as = String(a)
  const bs = String(b)
  return as < bs ? -1 : as > bs ? 1 : 0
}

function evalSet(t: IndexedTrack, d: FieldDescriptor, node: LeafNode): boolean {
  const have = t.sets[d.fieldId!] ?? []
  const want = (Array.isArray(node.value) ? node.value : [node.value]) as string[]

  switch (node.op) {
    case 'any':     return want.some((v) => have.includes(v))
    case 'all':     return want.every((v) => have.includes(v))
    case 'none':    return want.length === 0 || !want.some((v) => have.includes(v))
    case 'count':   return have.length === Number(node.value)
    case 'empty':   return have.length === 0
    case 'defined': return have.length > 0
    default: throw new Error(`operator ${node.op} is not valid on set field ${d.id}`)
  }
}

function evalLeaf(t: IndexedTrack, node: LeafNode, ctx: EvalContext): boolean {
  const d = field(node.field)
  if (d.storage === 'multi') return evalSet(t, d, node)

  if (node.op === 'top' || node.op === 'bottom') {
    const key = `${node.field}:${node.op}:${Number(node.value)}`
    return ctx.ranked?.get(key)?.has(t.id) ?? false
  }

  // Physical properties belong to a source: the track matches when any of its media does.
  if (d.storage === 'media') {
    const col = d.column ?? d.id
    return t.media.some((m) => applyOp(m[col] ?? null, node, ctx))
  }

  return applyOp(scalarOf(t, d), node, ctx)
}

function applyOp(raw: string | number | null, node: LeafNode, ctx: EvalContext): boolean {
  const v = node.value
  const cs = node.cs ?? false

  const text = (): string | null => (raw === null ? null : String(raw))
  const fold = (s: string): string => (cs ? s : asciiLower(s))

  switch (node.op) {
    case 'is':      return raw !== null && v !== null && cmp(raw, v) === 0
    // SQL uses IS NOT, which is NULL-aware and therefore true when exactly one side is NULL.
    case 'not_is':  return !(raw === null && (v === null || v === undefined)) && cmp(raw, v) !== 0
    case 'contains': {
      const s = text()
      return s !== null && fold(s).includes(fold(String(v)))
    }
    case 'starts': {
      const s = text()
      return s !== null && fold(s).startsWith(fold(String(v)))
    }
    case 'ends': {
      const s = text()
      return s !== null && fold(s).endsWith(fold(String(v)))
    }
    case 'regex': {
      const s = text()
      if (s === null) return false
      try { return new RegExp(String(v), 'u').test(s) } catch { return false }
    }
    case '>':  { const c = cmp(raw, v); return c !== null && c > 0 }
    case '<':  { const c = cmp(raw, v); return c !== null && c < 0 }
    case '>=': { const c = cmp(raw, v); return c !== null && c >= 0 }
    case '<=': { const c = cmp(raw, v); return c !== null && c <= 0 }
    case 'between': {
      const [lo, hi] = v as readonly number[]
      const a = cmp(raw, lo)
      const b = cmp(raw, hi)
      return a !== null && b !== null && a >= 0 && b <= 0
    }
    case 'not_between': {
      const [lo, hi] = v as readonly number[]
      const a = cmp(raw, lo)
      const b = cmp(raw, hi)
      return a !== null && b !== null && !(a >= 0 && b <= 0)
    }
    case 'empty':   return raw === null || raw === ''
    case 'defined': return raw !== null && raw !== ''
    case 'before':  { const c = cmp(raw, v); return c !== null && c < 0 }
    case 'after':   { const c = cmp(raw, v); return c !== null && c > 0 }
    case 'in_last': {
      const { n, unit } = v as RelativeDate
      return raw !== null && Number(raw) >= ctx.now - n * MS[unit]
    }
    case 'not_in_last': {
      const { n, unit } = v as RelativeDate
      return raw === null || Number(raw) < ctx.now - n * MS[unit]
    }
    default:
      throw new Error(`unhandled operator: ${node.op}`)
  }
}

export function evaluate(node: FilterNode, t: IndexedTrack, ctx: EvalContext): boolean {
  if (!isGroup(node)) return evalLeaf(t, node, ctx)

  switch (node.op) {
    case 'and': return node.children.every((c) => evaluate(c, t, ctx))
    case 'or':  return node.children.some((c) => evaluate(c, t, ctx))
    case 'not':
      if (node.children.length !== 1) throw new Error('not takes exactly one child')
      return !evaluate(node.children[0]!, t, ctx)
  }
}

export function selectIds(node: FilterNode, tracks: readonly IndexedTrack[], ctx: EvalContext): number[] {
  return tracks.filter((t) => evaluate(node, t, ctx)).map((t) => t.id)
}

/** Precomputes the id sets that `top` / `bottom` need, matching the SQL subquery's ordering. */
export function rankFor(
  tracks: readonly IndexedTrack[],
  fieldId: string,
  n: number
): { top: Set<number>; bottom: Set<number> } {
  const d = field(fieldId)
  const withValue = tracks
    .map((t) => ({ id: t.id, v: scalarOf(t, d) }))
    .filter((r): r is { id: number; v: string | number } => r.v !== null)

  const asc = [...withValue].sort((a, b) => (cmp(a.v, b.v) ?? 0) || a.id - b.id)
  const desc = [...withValue].sort((a, b) => -(cmp(a.v, b.v) ?? 0) || a.id - b.id)

  return {
    top: new Set(desc.slice(0, n).map((r) => r.id)),
    bottom: new Set(asc.slice(0, n).map((r) => r.id))
  }
}
