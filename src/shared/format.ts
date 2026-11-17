// The format-string language (DESIGN-SPEC §5.5). One engine serves labels, now-playing text,
// tooltips, tray text, notifications, column formats and the file renamer.
//
// It lives in shared/ and touches no DOM, so it is unchanged by any UI-framework decision.

export type FormatValue = string | number | null | undefined | readonly string[]
export type FormatSource = (field_id: string) => FormatValue

interface Token {
  kind: 'literal' | 'field' | 'group'
  text?: string
  fields?: string[]
  spec?: string
  children?: Token[]
}

/**
 * Grammar:
 *   {field}                  field value
 *   {a|b}                    first non-empty of a, b
 *   {year:%04d}              printf-style numeric format
 *   {length:m:ss}            duration format
 *   {rating:stars}           typed renderer
 *   {genre:join(", ")}       set join
 *   {path:basename}          transform
 *   [ ... ]                  group that vanishes if any field inside is empty
 */
export function parse_format(input: string): Token[] {
  let i = 0

  function parse_tokens(stop_at?: string): Token[] {
    const out: Token[] = []
    let literal = ''

    const flush = (): void => {
      if (literal) { out.push({ kind: 'literal', text: literal }); literal = '' }
    }

    while (i < input.length) {
      const c = input[i]!

      if (stop_at && c === stop_at) { i++; flush(); return out }

      if (c === '\\' && i + 1 < input.length) { literal += input[i + 1]; i += 2; continue }

      if (c === '[') { i++; flush(); out.push({ kind: 'group', children: parse_tokens(']') }); continue }

      if (c === '{') {
        i++
        let body = ''
        while (i < input.length && input[i] !== '}') body += input[i++]
        i++ // consume '}'
        flush()

        const colon = body.indexOf(':')
        const name_part = colon === -1 ? body : body.slice(0, colon)
        const spec = colon === -1 ? undefined : body.slice(colon + 1)
        out.push({ kind: 'field', fields: name_part.split('|').map((s) => s.trim()), spec })
        continue
      }

      literal += c
      i++
    }

    flush()
    return out
  }

  return parse_tokens()
}

const is_empty = (v: FormatValue): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

function format_duration(ms: number, spec: string): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')

  if (spec === 'h:mm:ss') return `${h}:${pad(m)}:${pad(s)}`
  if (spec === 'm:ss') return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  return `${m}:${pad(s)}`
}

function apply_spec(value: FormatValue, spec: string | undefined): string {
  if (is_empty(value)) return ''

  if (spec === undefined) return Array.isArray(value) ? value.join(', ') : String(value)

  if (Array.isArray(value)) {
    const join = /^join\((.*)\)$/.exec(spec)
    if (join) {
      const raw = join[1]!.trim()
      const sep = raw.replace(/^["'](.*)["']$/, '$1')
      return value.join(sep)
    }
    if (spec === 'count') return String(value.length)
    if (spec === 'first') return value[0] ?? ''
    return value.join(', ')
  }

  const n = typeof value === 'number' ? value : Number(value)

  if (spec === 'stars') {
    const stars = Math.round((n / 20 + Number.EPSILON) * 10) / 10
    return '★'.repeat(Math.floor(stars)) + '☆'.repeat(5 - Math.floor(stars))
  }

  if (spec === 'm:ss' || spec === 'h:mm:ss') return format_duration(n, spec)

  const printf = /^%0?(\d+)d$/.exec(spec)
  if (printf && Number.isFinite(n)) return String(Math.trunc(n)).padStart(Number(printf[1]), '0')

  const s = String(value)
  switch (spec) {
    case 'basename': return s.split('/').pop() ?? s
    case 'dirname':  return s.slice(0, Math.max(0, s.lastIndexOf('/'))) || '/'
    case 'ext':      { const b = s.split('/').pop() ?? s; const d = b.lastIndexOf('.'); return d > 0 ? b.slice(d + 1) : '' }
    case 'upper':    return s.toLocaleUpperCase()
    case 'lower':    return s.toLocaleLowerCase()
    case 'title':    return s.replace(/\p{L}[\p{L}\p{M}']*/gu, (w) => w[0]!.toLocaleUpperCase() + w.slice(1).toLocaleLowerCase())
    default:         return s
  }
}

interface RenderResult { text: string; saw_empty_field: boolean }

function render_tokens(tokens: readonly Token[], get: FormatSource): RenderResult {
  let text = ''
  let saw_empty_field = false

  for (const t of tokens) {
    if (t.kind === 'literal') { text += t.text; continue }

    if (t.kind === 'group') {
      const inner = render_tokens(t.children!, get)
      // A bracketed group vanishes entirely if any field inside it is empty.
      if (!inner.saw_empty_field) text += inner.text
      continue
    }

    const found = t.fields!.map(get).find((v) => !is_empty(v))
    if (found === undefined) { saw_empty_field = true; continue }
    text += apply_spec(found, t.spec)
  }

  return { text, saw_empty_field }
}

export function format_string(template: string, get: FormatSource): string {
  return render_tokens(parse_format(template), get).text
}

/** Convenience for the common case of formatting a plain record. */
export const format_record = (template: string, row: Record<string, FormatValue>): string =>
  format_string(template, (f) => row[f])

/** Every field a template references, so a caller knows what to fetch. */
export function template_fields(template: string): string[] {
  const out = new Set<string>()
  const walk = (tokens: readonly Token[]): void => {
    for (const t of tokens) {
      if (t.kind === 'field') t.fields!.forEach((f) => out.add(f))
      else if (t.kind === 'group') walk(t.children!)
    }
  }
  walk(parse_format(template))
  return [...out]
}
