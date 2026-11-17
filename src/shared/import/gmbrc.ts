// Parser for gmusicbrowser's gmbrc file.
//
// The format is a sectioned text file. [Options] is YAML-ish key/value; [Songs] is a tab-separated
// table whose first line names the columns; [album] and [artist] hold picture associations. Values
// in filesystem-derived columns are percent-encoded, and multi-value fields use a literal "\x00"
// separator — the four characters, not a NUL byte.
//
// Reading only. Nothing here opens a file for writing, and the importer never touches the music.

export interface GmbSong {
  gmb_id: number
  added?: number
  album?: string
  album_artist?: string
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
  last_play?: number
  last_skip?: number
  length?: number
  missing?: boolean
  modif?: number
  /** Directory, already percent-decoded. */
  path?: string
  play_count?: number
  play_history: number[]
  rating?: number
  rg_album_gain?: number
  rg_track_gain?: number
  sample_rate?: number
  size?: number
  skip_count?: number
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
  gmb_ids: number[]
}

export interface GmbrcData {
  version?: string
  base_folder?: string
  songs: GmbSong[]
  saved_filters: GmbSavedFilter[]
  saved_lists: GmbSavedList[]
  /** Column names present in [Songs] that this parser does not map. */
  unmapped_columns: string[]
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

const split_multi = (v: string): string[] =>
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

function parse_song_row(columns: readonly string[], line: string): GmbSong | null {
  const cells = line.split('\t')
  if (cells.length < 2) return null

  const gmb_id = Number(cells[0])
  if (!Number.isFinite(gmb_id)) return null

  const get = (name: string): string => {
    const i = columns.indexOf(name)
    // Cell 0 is the id, so column i of the header is cell i + 1.
    return i === -1 ? '' : (cells[i + 1] ?? '')
  }

  const song: GmbSong = {
    gmb_id,
    added: num(get('added')),
    album: get('album') || undefined,
    album_artist: get('album_artist_raw') || get('album_artist') || undefined,
    artist: get('artist') || undefined,
    bitrate: num(get('bitrate')),
    channels: num(get('channel')),
    comment: get('comment') || undefined,
    compilation: get('compilation') === '1',
    disc: num(get('disc')),
    file: get('file') ? decode(get('file')) : undefined,
    filetype: get('filetype') || undefined,
    genre: split_multi(get('genre')),
    grouping: split_multi(get('grouping')),
    label: split_multi(get('label')),
    last_play: num(get('lastplay')),
    last_skip: num(get('lastskip')),
    length: num(get('length')),
    missing: get('missing') === '1',
    modif: num(get('modif')),
    path: get('path') ? decode(get('path')) : undefined,
    play_count: num(get('playcount')),
    play_history: get('playhistory').split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0),
    rating: num(get('rating')),
    rg_album_gain: num(get('replaygain_album_gain')),
    rg_track_gain: num(get('replaygain_track_gain')),
    sample_rate: num(get('samprate')),
    size: num(get('size')),
    skip_count: num(get('skipcount')),
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

export function parse_gmbrc(text: string): GmbrcData {
  const lines = text.split('\n')

  const data: GmbrcData = {
    songs: [], saved_filters: [], saved_lists: [], unmapped_columns: []
  }

  const first = lines[0] ?? ''
  const version_match = /version=(\S+)/.exec(first)
  if (version_match) data.version = version_match[1]

  let section = ''
  let song_columns: string[] | null = null
  let option_key: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    if (raw === '' || raw.startsWith('#')) continue

    const section_match = /^\[(.+)\]$/.exec(raw)
    if (section_match) {
      section = section_match[1]!
      song_columns = null
      option_key = null
      continue
    }

    if (section === 'Songs') {
      if (song_columns === null) {
        song_columns = raw.split('\t')
        data.unmapped_columns = song_columns.filter((c) => !KNOWN_COLUMNS.has(c))
        continue
      }
      const song = parse_song_row(song_columns, raw)
      if (song) data.songs.push(song)
      continue
    }

    if (section !== 'Options') continue

    // Nested entries are indented under the key that owns them.
    if (/^\s/.test(raw)) {
      const body = raw.trim()

      if (option_key === 'SavedFilters') {
        const m = /^(.+?):\s*!Filter\s+"(.*)"$/.exec(body)
        if (m) data.saved_filters.push({ name: unquote(m[1]!), expression: m[2]! })
      } else if (option_key === 'SavedLists') {
        const m = /^(.+?):\s*!SongArray(?:::Named)?\s+(.*)$/.exec(body)
        if (m) {
          data.saved_lists.push({
            name: unquote(m[1]!),
            gmb_ids: m[2]!.split(/\s+/).map(Number).filter(Number.isFinite)
          })
        }
      }
      continue
    }

    const kv = /^([A-Za-z_0-9]+):\s*(.*)$/.exec(raw)
    if (!kv) continue

    option_key = kv[1]!
    const value = kv[2]!

    if (option_key === 'BaseFolder' && value !== '') data.base_folder = unquote(value)
  }

  return data
}

/** Where gmusicbrowser keeps its configuration by default. */
export function default_gmbrc_path(home: string, platform: string): string {
  if (platform === 'win32') return `${home}/gmusicbrowser/gmbrc`
  if (platform === 'darwin') return `${home}/Library/Preferences/gmusicbrowser/gmbrc`
  return `${home}/.config/gmusicbrowser/gmbrc`
}
