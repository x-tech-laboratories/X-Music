// X-Music's format strings (DESIGN-SPEC §5.5) for labels, now-playing text, tooltips, tray text, notifications, column
// formats and the file renamer: X-Libs' format_strings, with the music formats X-Music adds.

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  compile_format as compile_with, format_record as format_record_with, format_string as format_string_with,
  type FormatFunction, type FormatOptions, type FormatSource, type FormatValue
} from '@x-tech-laboratories/x-libs/format_strings'

export { template_fields, type FormatSource, type FormatValue } from '@x-tech-laboratories/x-libs/format_strings'

// ── Music formats ────────────────────────────────────────────────────────────

// A rating from 0 to 100 as five stars, filled to the nearest whole star below.
const stars: FormatFunction = (value) => {
  const rating = Math.round((Number(value) / 20 + Number.EPSILON) * 10) / 10
  return '★'.repeat(Math.floor(rating)) + '☆'.repeat(5 - Math.floor(rating))
}

export const music_formats: FormatOptions = { formats: { stars } }

// ── Writing ──────────────────────────────────────────────────────────────────

export const compile_format = (template: string): ((source: FormatSource) => string) => compile_with(template, music_formats)

export const format_string = (template: string, source: FormatSource): string => format_string_with(template, source, music_formats)

export const format_record = (template: string, record: Readonly<Record<string, FormatValue>>): string =>
  format_record_with(template, record, music_formats)
