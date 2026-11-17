// Parser for gmusicbrowser's gmbrc file.
//
// The format is a sectioned text file. [Options] is YAML-ish key/value; [Songs] is a tab-separated
// table whose first line names the columns; [album] and [artist] hold picture associations. Values
// in filesystem-derived columns are percent-encoded, and multi-value fields use a literal "\x00"
// separator — the four characters, not a NUL byte.
//
// Reading only. Nothing here opens a file for writing, and the importer never touches the music.

export interface GmbSong {
  gmbId: number
  added?: number
  album?: string
  albumArtist?: string
  artist?: string
  bitrate?: number
  channels?: number
  comment?: string
  compilation?: boolean
  disc?: number
  /** Filename within `path`, already percent-decoded. */
  file?: string
  filetype?: string
  genre: string[]
  grouping: string[]
  label: string[]
  lastPlay?: number
  lastSkip?: number
  length?: number
  missing?: boolean
  modif?: number
  /** Directory, already percent-decoded. */
  path?: string
  playCount?: number
  playHistory: number[]
  rating?: number
  rgAlbumGain?: number
  rgTrackGain?: number
  sampleRate?: number
  size?: number
  skipCount?: number
  title?: string
  track?: number
  version?: string
  year?: number
}

export interface GmbSavedFilter {
  name: string
  /** The raw gmusicbrowser filter string, e.g. "rating:h:50". */
  expression: string
}

export interface GmbSavedList {
  name: string
  gmbIds: number[]
}

export interface GmbrcData {
  version?: string
  baseFolder?: string
  songs: GmbSong[]
  savedFilters: GmbSavedFilter[]
  savedLists: GmbSavedList[]
  /** Column names present in [Songs] that this parser does not map. */
  unmappedColumns: string[]
}

const MULTI_SEP = '\\x00'

/** gmusicbrowser percent-encodes filesystem names; a malformed escape must not lose the value. */
function decode(v: string): string {
  if (!v.includes('%')) return v
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

const splitMulti = (v: string): string[] =>
  v === '' ? [] : v.split(MULTI_SEP).map((s) => s.trim()).filter((s) => s !== '')

const num = (v: string): number | undefined => {
  if (v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const KNOWN_COLUMNS = new Set([
  'added', 'album', 'album_artist_raw', 'album_artist', 'artist', 'bitrate', 'channel', 'comment',
  'compilation', 'disc', 'file', 'filetype', 'genre', 'grouping', 'label', 'lastplay', 'lastskip',
  'length', 'length_estimated', 'missing', 'modif', 'path', 'playcount', 'playhistory', 'rating',
  'replaygain_album_gain', 'replaygain_album_peak', 'replaygain_track_gain',
  'replaygain_track_peak', 'samprate', 'size', 'skipcount', 'title', 'track', 'version', 'year'
])

function parseSongRow(columns: readonly string[], line: string): GmbSong | null {
  const cells = line.split('\t')
  if (cells.length < 2) return null

  const gmbId = Number(cells[0])
  if (!Number.isFinite(gmbId)) return null

  const get = (name: string): string => {
    const i = columns.indexOf(name)
    // Cell 0 is the id, so column i of the header is cell i + 1.
    return i === -1 ? '' : (cells[i + 1] ?? '')
  }

  const song: GmbSong = {
    gmbId,
    added: num(get('added')),
    album: get('album') || undefined,
    albumArtist: get('album_artist_raw') || get('album_artist') || undefined,
    artist: get('artist') || undefined,
    bitrate: num(get('bitrate')),
    channels: num(get('channel')),
    comment: get('comment') || undefined,
    compilation: get('compilation') === '1',
    disc: num(get('disc')),
    file: get('file') ? decode(get('file')) : undefined,
    filetype: get('filetype') || undefined,
    genre: splitMulti(get('genre')),
    grouping: splitMulti(get('grouping')),
    label: splitMulti(get('label')),
    lastPlay: num(get('lastplay')),
    lastSkip: num(get('lastskip')),
    length: num(get('length')),
    missing: get('missing') === '1',
    modif: num(get('modif')),
    path: get('path') ? decode(get('path')) : undefined,
    playCount: num(get('playcount')),
    playHistory: get('playhistory').split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0),
    rating: num(get('rating')),
    rgAlbumGain: num(get('replaygain_album_gain')),
    rgTrackGain: num(get('replaygain_track_gain')),
    sampleRate: num(get('samprate')),
    size: num(get('size')),
    skipCount: num(get('skipcount')),
    title: get('title') || undefined,
    track: num(get('track')),
    version: get('version') || undefined,
    year: num(get('year'))
  }

  // gmusicbrowser stores 255 in `rating` to mean "no rating", distinct from a rating of 0.
  if (song.rating === 255) song.rating = undefined

  return song
}

/** Strips one layer of gmbrc quoting from an [Options] scalar. */
function unquote(v: string): string {
  const t = v.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

export function parseGmbrc(text: string): GmbrcData {
  const lines = text.split('\n')

  const data: GmbrcData = {
    songs: [], savedFilters: [], savedLists: [], unmappedColumns: []
  }

  const first = lines[0] ?? ''
  const versionMatch = /version=(\S+)/.exec(first)
  if (versionMatch) data.version = versionMatch[1]

  let section = ''
  let songColumns: string[] | null = null
  let optionKey: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    if (raw === '' || raw.startsWith('#')) continue

    const sectionMatch = /^\[(.+)\]$/.exec(raw)
    if (sectionMatch) {
      section = sectionMatch[1]!
      songColumns = null
      optionKey = null
      continue
    }

    if (section === 'Songs') {
      if (songColumns === null) {
        songColumns = raw.split('\t')
        data.unmappedColumns = songColumns.filter((c) => !KNOWN_COLUMNS.has(c))
        continue
      }
      const song = parseSongRow(songColumns, raw)
      if (song) data.songs.push(song)
      continue
    }

    if (section !== 'Options') continue

    // Nested entries are indented under the key that owns them.
    if (/^\s/.test(raw)) {
      const body = raw.trim()

      if (optionKey === 'SavedFilters') {
        const m = /^(.+?):\s*!Filter\s+"(.*)"$/.exec(body)
        if (m) data.savedFilters.push({ name: unquote(m[1]!), expression: m[2]! })
      } else if (optionKey === 'SavedLists') {
        const m = /^(.+?):\s*!SongArray(?:::Named)?\s+(.*)$/.exec(body)
        if (m) {
          data.savedLists.push({
            name: unquote(m[1]!),
            gmbIds: m[2]!.split(/\s+/).map(Number).filter(Number.isFinite)
          })
        }
      }
      continue
    }

    const kv = /^([A-Za-z_0-9]+):\s*(.*)$/.exec(raw)
    if (!kv) continue

    optionKey = kv[1]!
    const value = kv[2]!

    if (optionKey === 'BaseFolder' && value !== '') data.baseFolder = unquote(value)
  }

  return data
}

/** Where gmusicbrowser keeps its configuration by default. */
export function defaultGmbrcPath(home: string, platform: string): string {
  if (platform === 'win32') return `${home}/gmusicbrowser/gmbrc`
  if (platform === 'darwin') return `${home}/Library/Preferences/gmusicbrowser/gmbrc`
  return `${home}/.config/gmusicbrowser/gmbrc`
}
