// Playlist files: M3U and M3U8, PLS and XSPF read into the paths they list, and written from a playlist's tracks.

// ── Imports ──────────────────────────────────────────────────────────────────

import { XMLBuilder, XMLParser } from 'fast-xml-parser'

// ── Formats ──────────────────────────────────────────────────────────────────

export type PlaylistFormat = 'm3u' | 'pls' | 'xspf'

export const playlist_extensions: Readonly<Record<string, PlaylistFormat>> = { m3u: 'm3u', m3u8: 'm3u', pls: 'pls', xspf: 'xspf' }

export function playlist_format(path: string): PlaylistFormat | null {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  return extension ? playlist_extensions[extension] ?? null : null
}

// ── Paths ────────────────────────────────────────────────────────────────────

const is_absolute = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

const folder_of = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

// An entry as a path on this computer: a file URL decoded, a relative path joined to the playlist's folder; other URLs as they are.
export function resolve_entry(entry: string, playlist_path: string): string {
  const trimmed = entry.trim()
  if (/^file:\/\//i.test(trimmed)) {
    const path = decodeURIComponent(trimmed.replace(/^file:\/\/(localhost)?/i, ''))
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || is_absolute(trimmed)) return trimmed
  const separator = playlist_path.includes('\\') && !playlist_path.includes('/') ? '\\' : '/'
  const parts = `${folder_of(playlist_path)}${separator}${trimmed}`.split(/[\\/]/)
  const kept: string[] = []
  for (const part of parts) {
    if (part === '..' && kept.length > 1) kept.pop()
    else if (part !== '.') kept.push(part)
  }
  return kept.join(separator)
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface PlaylistFile {
  // The name the file gives itself, if any.
  name: string | null
  // Paths on this computer, or URLs, in the file's order.
  entries: string[]
}

const lines_of = (text: string): string[] => text.replace(/^﻿/, '').split(/\r?\n/).map((line) => line.trim())

function read_m3u(text: string, path: string): PlaylistFile {
  let name: string | null = null
  const entries: string[] = []
  for (const line of lines_of(text)) {
    if (line.startsWith('#PLAYLIST:')) name = line.slice('#PLAYLIST:'.length).trim() || null
    else if (line !== '' && !line.startsWith('#')) entries.push(resolve_entry(line, path))
  }
  return { name, entries }
}

function read_pls(text: string, path: string): PlaylistFile {
  const files: [number, string][] = []
  for (const line of lines_of(text)) {
    const file = /^File(\d+)=(.*)$/i.exec(line)
    if (file && file[2]!.trim() !== '') files.push([Number(file[1]), resolve_entry(file[2]!, path)])
  }
  return { name: null, entries: files.sort((first, second) => first[0] - second[0]).map(([, entry]) => entry) }
}

function read_xspf(text: string, path: string): PlaylistFile {
  const parser = new XMLParser({ ignoreAttributes: true, isArray: (name) => name === 'track' || name === 'location', parseTagValue: false })
  const document = parser.parse(text) as { playlist?: { title?: unknown; trackList?: { track?: { location?: unknown[] }[] } } }
  if (!document.playlist) throw new Error('this is not an XSPF playlist')
  const tracks = document.playlist.trackList?.track ?? []
  const entries = tracks.flatMap((track) => {
    const location = track.location?.[0]
    return typeof location === 'string' && location.trim() !== '' ? [resolve_entry(location, path)] : []
  })
  const title = document.playlist.title
  return { name: typeof title === 'string' && title.trim() !== '' ? title.trim() : null, entries }
}

export function read_playlist_file(text: string, path: string): PlaylistFile {
  const format = playlist_format(path)
  if (format === 'pls') return read_pls(text, path)
  if (format === 'xspf') return read_xspf(text, path)
  if (format === 'm3u') return read_m3u(text, path)
  throw new Error('a playlist file ends in .m3u, .m3u8, .pls or .xspf')
}

// The file's name without its folder or extension, for a playlist that names none.
export function name_from_path(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).replace(/\.[^.]+$/, '')
}

// ── Writing ──────────────────────────────────────────────────────────────────

export interface PlaylistEntry {
  path: string
  title: string | null
  artist: string | null
  length_ms: number | null
}

const shown_name = (entry: PlaylistEntry): string => [entry.artist, entry.title].filter((part) => part).join(' - ')
const seconds = (entry: PlaylistEntry): number => (entry.length_ms === null ? -1 : Math.round(entry.length_ms / 1000))
const one_line = (text: string): string => text.replace(/[\r\n]+/g, ' ')

function write_m3u(name: string, entries: readonly PlaylistEntry[]): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${one_line(name)}`]
  for (const entry of entries) lines.push(`#EXTINF:${seconds(entry)},${one_line(shown_name(entry))}`, entry.path)
  return `${lines.join('\n')}\n`
}

function write_pls(entries: readonly PlaylistEntry[]): string {
  const lines = ['[playlist]']
  entries.forEach((entry, index) => {
    const number = index + 1
    lines.push(`File${number}=${entry.path}`, `Title${number}=${one_line(shown_name(entry))}`, `Length${number}=${seconds(entry)}`)
  })
  lines.push(`NumberOfEntries=${entries.length}`, 'Version=2')
  return `${lines.join('\n')}\n`
}

// A path as a file URL, each part escaped.
function file_url(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path
  const slashed = path.replace(/\\/g, '/')
  return `file://${slashed.startsWith('/') ? '' : '/'}${slashed.split('/').map(encodeURIComponent).join('/').replace(/^\/([A-Za-z])%3A/, '/$1:')}`
}

function write_xspf(name: string, entries: readonly PlaylistEntry[]): string {
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true, attributeNamePrefix: '@' })
  const track = (entry: PlaylistEntry) => ({
    location: file_url(entry.path),
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.artist ? { creator: entry.artist } : {}),
    ...(entry.length_ms !== null ? { duration: entry.length_ms } : {})
  })
  const body = builder.build({ playlist: { '@version': '1', '@xmlns': 'http://xspf.org/ns/0/', title: name, trackList: { track: entries.map(track) } } }) as string
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`
}

export function write_playlist_file(format: PlaylistFormat, name: string, entries: readonly PlaylistEntry[]): string {
  if (format === 'pls') return write_pls(entries)
  if (format === 'xspf') return write_xspf(name, entries)
  return write_m3u(name, entries)
}
