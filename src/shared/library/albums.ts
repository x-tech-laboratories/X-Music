// Album identity (DESIGN-SPEC §17.1).
// An album row's id is what persists; its match_key is derived here from tags and may be
// recomputed. The importer and the scanner both key albums through this file, so the same file
// read by either lands on the same album.

import { eq } from '@x-tech-laboratories/x-libs/drizzle'
import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import { field } from '../fields.ts'
import { all_rows, drizzle_of, new_id, run } from './database.ts'
import { albums, tracks } from './schema.ts'

const KEY_SEP = '\x1f'

// How many different artists an album without an album artist needs before it counts as a compilation.
export const COMPILATION_ARTISTS = 3

// Splits a tag that holds several values, which containers do inconsistently.
export function split_values(value: string | string[] | null | undefined): string[] {
  if (value === undefined || value === null) return []
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap((v) => String(v).split(/\s*[;/\0]\s*/))
    .map((v) => v.trim())
    .filter((v) => v !== '')
}

// Casefolds, strips diacritics and collapses whitespace.
export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// A trailing bracketed edition note such as "(Remastered)" or "[2011 Deluxe Edition]".
const EDITION_SUFFIX =
  /\s*[([][^)\]]*\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|edition|bonus tracks?|special|collector'?s)\b[^)\]]*[)\]]\s*$/i

// Names that say nothing about which album a file belongs to.
const GENERIC_ALBUM = /^(?:unknown(?: album)?|untitled|various(?: artists)?|(?:cd|disc|disk)\s*\d+)$/

// The album name as keyed: normalized, with edition notes removed so editions share an album.
export function album_key_name(album: string): string {
  let name = album
  for (let prev = ''; prev !== name;) {
    prev = name
    name = name.replace(EDITION_SUFFIX, '')
  }
  return normalize(name) || normalize(album)
}

// The first artist in a tag, normalized and without featured guests, so "A; B" from one reader and "A feat. C" from another both count as A.
const primary_artist = (raw: string | null | undefined): string =>
  normalize((split_values(raw)[0] ?? '').split(/\s+(?:feat\.?|ft\.|featuring)\s+/i)[0])

export interface AlbumInput {
  album?: string | null
  artist?: string | null
  album_artist?: string | null
  year?: number | null
  compilation?: boolean
  mb_release_id?: string | null
}

// The folder, only when the album name is too generic to tell albums apart on its own.
function folder_tie_break(album: string, uri: string | null | undefined): string {
  return uri && GENERIC_ALBUM.test(normalize(album)) ? folder_of(uri) : ''
}

// The folder a file is in, exactly as Node's POSIX dirname gives it, so album keys stay what they were.
export function folder_of(path: string): string {
  if (path === '') return '.'
  const rooted = path.startsWith('/')
  let end = -1
  let in_slashes = true
  for (let index = path.length - 1; index >= 1; index--) {
    if (path[index] !== '/') in_slashes = false
    else if (!in_slashes) {
      end = index
      break
    }
  }
  if (end === -1) return rooted ? '/' : '.'
  if (rooted && end === 1) return '//'
  return path.slice(0, end)
}

// The key an album of many artists is filed under: no artist component.
export function compilation_key(t: AlbumInput, uri?: string | null): string | null {
  if (!t.album?.trim()) return null
  return ['c', album_key_name(t.album), t.year ?? '', folder_tie_break(t.album, uri)].join(KEY_SEP)
}

// The album a track belongs to: its MusicBrainz release when tagged, otherwise album artist (or track artist), name and year, with tagged compilations dropping the artist.
export function album_match_key(t: AlbumInput, uri?: string | null): string | null {
  if (!t.album?.trim()) return null
  if (t.mb_release_id) return ['mb', t.mb_release_id].join(KEY_SEP)

  const album_artist = primary_artist(t.album_artist)
  if (!album_artist && t.compilation) return compilation_key(t, uri)

  return ['a', album_artist || primary_artist(t.artist), album_key_name(t.album), t.year ?? '',
    folder_tie_break(t.album, uri)].join(KEY_SEP)
}

export interface RegroupReport {
  compilations_found: number
  tracks_moved: number
  albums_removed: number
}

// Moves albums with no album artist and at least three track artists onto one compilation album, then deletes album rows nothing points at. Pinned albums and pinned tracks are left alone.
export function regroup_albums(database: SqlDatabase): RegroupReport {
  const report: RegroupReport = { compilations_found: 0, tracks_moved: 0, albums_removed: 0 }
  const artist_field = field('artist').field_id!
  const album_artist_field = field('album_artist').field_id!

  // Tracks filed under a per-artist key, i.e. every candidate for being part of a compilation; raw, since its correlated subqueries read plainer as SQL.
  const rows = all_rows<{ id: string; year: number | null; name: string | null; artist: string | null; uri: string | null }>(
    database,
    `SELECT t.id, t.year, a.name,
           (SELECT v.value FROM track_values tv JOIN values_ v ON v.id = tv.value_id
             WHERE tv.track_id = t.id AND tv.field_id = ? ORDER BY tv.ordinal LIMIT 1) AS artist,
           (SELECT m.uri FROM media m WHERE m.track_id = t.id ORDER BY m.added, m.id LIMIT 1) AS uri
      FROM tracks t JOIN albums a ON a.id = t.album_id
     WHERE t.pinned = 0 AND a.pinned = 0 AND a.match_key LIKE 'a' || char(31) || '%'
       AND NOT EXISTS (SELECT 1 FROM track_values tv
                        WHERE tv.track_id = t.id AND tv.field_id = ?)`,
    artist_field,
    album_artist_field
  )

  const groups = new Map<string, { input: AlbumInput; uri: string | null; artists: Set<string>; tracks: string[] }>()
  for (const r of rows) {
    const input = { album: r.name, year: r.year }
    const key = compilation_key(input, r.uri)
    if (key === null) continue
    let g = groups.get(key)
    if (!g) groups.set(key, g = { input, uri: r.uri, artists: new Set(), tracks: [] })
    g.artists.add(primary_artist(r.artist))
    g.tracks.push(r.id)
  }

  const now = Date.now()
  const db = drizzle_of(database)

  for (const [key, g] of groups) {
    if (g.artists.size < COMPILATION_ARTISTS) continue
    db.insert(albums).values({ id: new_id(), match_key: key, name: g.input.album ?? null, year: g.input.year ?? null, is_compilation: 1, added: now })
      .onConflictDoUpdate({ target: albums.match_key, set: { is_compilation: 1 } }).run()
    const album_id = db.select({ id: albums.id }).from(albums).where(eq(albums.match_key, key)).get()!.id
    for (const track_id of g.tracks) db.update(tracks).set({ album_id }).where(eq(tracks.id, track_id)).run()
    report.compilations_found++
    report.tracks_moved += g.tracks.length
  }

  // An album a merge could still be undone onto has to survive, or the undo has nothing to restore; raw, since json_each is SQLite's own.
  report.albums_removed = run(database, `
    DELETE FROM albums
     WHERE pinned = 0
       AND id NOT IN (SELECT album_id FROM tracks WHERE album_id IS NOT NULL)
       AND id NOT IN (SELECT json_extract(j.value, '$.album_id')
                        FROM merge_journal m, json_each(m.snapshot, '$.tracks') j
                       WHERE m.undone = 0 AND json_extract(j.value, '$.album_id') IS NOT NULL)`)

  return report
}
