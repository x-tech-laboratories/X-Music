// Every call X-Music offers other programs, described once: what it does and a JSON Schema for each argument, for the
// local MCP server.

import type { ApiSpec, JsonSchema } from '@x-tech-laboratories/x-libs/api_spec'
import { BUILTIN_FIELDS } from './fields.ts'
import type { XMusicApi, XMusicHistoryApi } from './ipc.ts'

// ============================================================================
// Shapes
// ============================================================================

const field_ids = BUILTIN_FIELDS.map((field) => field.id)

function id_of(thing: string): JsonSchema {
  return { type: 'string', description: `The ${thing}'s id, as a list or get call gives it.` }
}

const track_ids: JsonSchema = { type: 'array', items: id_of('track'), minItems: 1, description: 'Track ids, as list_tracks gives them.' }

const field_id: JsonSchema = { type: 'string', enum: field_ids, description: 'A field of a track.' }

const leaf: JsonSchema = {
  type: 'object',
  properties: {
    field: field_id,
    op: {
      type: 'string',
      enum: [
        'is', 'not_is', 'contains', 'starts', 'ends', 'regex', '>', '<', '>=', '<=', 'between', 'not_between',
        'top', 'bottom', 'empty', 'defined', 'any', 'all', 'none', 'count', 'before', 'after', 'in_last', 'not_in_last',
        'in_playlist', 'in_filter', 'matches'
      ]
    },
    value: { description: 'A text, number, true or false, a list of texts or numbers, or a span such as {"count": 30, "unit": "day"} for in_last; left out for empty and defined.' },
    case_sensitive: { type: 'boolean', description: 'Whether text compares case by case; false unless set.' }
  },
  required: ['field', 'op'],
  additionalProperties: false
}

const filter: JsonSchema = {
  description: 'Which tracks: a test on one field such as {"field": "rating", "op": ">=", "value": 80}, or {"op": "and" | "or" | "not", "children": [...]} of others. {"op": "and", "children": []} is every track. Lengths are in milliseconds, ratings 0 to 100, dates Unix milliseconds.',
  anyOf: [
    leaf,
    {
      type: 'object',
      properties: { op: { type: 'string', enum: ['and', 'or', 'not'] }, children: { type: 'array', items: { type: 'object' } } },
      required: ['op', 'children'],
      additionalProperties: false
    }
  ]
}

const sort: JsonSchema = {
  type: 'array',
  description: 'The order, first key first.',
  items: {
    type: 'object',
    properties: { field: { type: 'string', enum: [...field_ids, 'random'] }, descending: { type: 'boolean', description: 'Whether the key runs from high to low; low to high unless set.' } },
    required: ['field'],
    additionalProperties: false
  }
}

const limit: JsonSchema = { type: 'integer', minimum: 1, description: 'At most this many tracks.' }

const resolutions: JsonSchema = {
  type: 'object',
  description: 'For a field whose value differs between the tracks, by field id: {"kind": "value", "from": <track id>} keeps that track\'s value, {"kind": "union"} keeps every value of a multi-value field. A field left out keeps the survivor\'s value.',
  additionalProperties: {
    anyOf: [
      { type: 'object', properties: { kind: { const: 'value' }, from: { type: 'string' } }, required: ['kind', 'from'], additionalProperties: false },
      { type: 'object', properties: { kind: { const: 'union' } }, required: ['kind'], additionalProperties: false }
    ]
  }
}

// ============================================================================
// Calls
// ============================================================================

export const x_music_api: ApiSpec<XMusicApi & XMusicHistoryApi> = {
  get_app_info: { description: 'Gives X-Music\'s version and the versions of Electron, Chromium and Node it runs on.', params: [] },
  get_library_stats: { description: 'Counts the tracks, files, albums and missing files in the library, with their total length in milliseconds and where the library database is.', params: [] },
  list_tracks: {
    description: 'Lists the tracks a filter lets through, in the order asked for: each with its id, title, artist, album, year, track number, length in milliseconds, rating 0 to 100 and play count.',
    params: [
      { name: 'filter', schema: filter },
      { name: 'sort', schema: sort, optional: true },
      { name: 'limit', schema: limit, optional: true },
      { name: 'offset', schema: { type: 'integer', minimum: 0, description: 'How many of the first tracks to skip.' }, optional: true }
    ]
  },
  list_track_groups: {
    description: 'Lists the values one field takes among the tracks a filter lets through, such as every genre, each with how many tracks have it and their total length in milliseconds.',
    params: [{ name: 'filter', schema: filter }, { name: 'field', schema: field_id }]
  },
  get_track: {
    description: 'Gives everything known about one track: every field, its files, how it is recognised, and its raw tags; null if there is no such track.',
    params: [{ name: 'track_id', schema: id_of('track') }]
  },
  list_duplicates: {
    description: 'Lists groups of tracks that look like the same piece of music, each with why and how sure X-Music is. Nothing is changed; merge_tracks merges a group.',
    params: [
      { name: 'reasons', schema: { type: 'array', items: { type: 'string', enum: ['audio_hash', 'mb_recording_id', 'tags', 'fuzzy'] }, description: 'Which evidence to look for; all but fuzzy unless set.' }, optional: true },
      { name: 'length_tolerance_ms', schema: { type: 'integer', minimum: 0, description: 'How far apart in milliseconds two lengths may be and still match; 3000 unless set.' }, optional: true },
      { name: 'limit', schema: { type: 'integer', minimum: 1, description: 'At most this many groups.' }, optional: true }
    ]
  },
  get_merge_preview: {
    description: 'Shows what merging tracks would do, without doing it: the track that would survive, each field\'s value and where tracks disagree, and the files that would move to the survivor.',
    params: [{ name: 'track_ids', schema: track_ids }]
  },
  merge_tracks: {
    description: 'Merges tracks into one: the survivor takes the others\' files, plays and playlist places, and the others are deleted. Gives a batch id; undo_merge with it puts the tracks back as they were.',
    params: [
      { name: 'track_ids', schema: track_ids },
      { name: 'survivor_id', schema: { type: 'string', description: 'The track that stays, one of track_ids.' } },
      { name: 'resolutions', schema: resolutions, optional: true }
    ],
    destructive: true
  },
  undo_merge: {
    description: 'Puts the tracks of a merge back as they were before it, by the batch id merge_tracks gave.',
    params: [{ name: 'batch_id', schema: { type: 'string', description: 'The batch id merge_tracks gave.' } }],
    destructive: true
  },
  list_folders: { description: 'Lists the music folders X-Music scans, each with its id, path, whether it is scanned, and when it was last scanned in Unix milliseconds.', params: [] },
  add_folder: {
    description: 'Adds a folder on this computer to the music folders; the next scan reads it.',
    params: [{ name: 'path', schema: { type: 'string', minLength: 1, description: 'The folder\'s full path.' } }]
  },
  remove_folder: {
    description: 'Stops scanning a music folder. Its tracks stay in the library and its files are not touched.',
    params: [{ name: 'folder_id', schema: id_of('folder') }]
  },
  scan_folders: {
    description: 'Scans every music folder and answers when done: new files become tracks, moved files are recognised, and missing ones are flagged, never deleted. Files are only read.',
    params: []
  },
  cancel_scan: { description: 'Stops a running scan.', params: [] },
  get_default_gmbrc_path: { description: 'Gives where gmusicbrowser keeps its gmbrc file on this computer.', params: [] },
  get_gmbrc_preview: {
    description: 'Reads a gmusicbrowser gmbrc file and counts what an import would bring in, without writing anything.',
    params: [{ name: 'path', schema: { type: 'string', minLength: 1, description: 'The gmbrc file\'s full path.' } }]
  },
  import_gmbrc: {
    description: 'Imports a gmusicbrowser gmbrc file: its tracks, and unless turned off, its ratings and plays, labels and playlists. Running it again changes nothing that is already in.',
    params: [
      { name: 'path', schema: { type: 'string', minLength: 1, description: 'The gmbrc file\'s full path.' } },
      { name: 'statistics', schema: { type: 'boolean', description: 'Whether to import ratings, play counts and play history; true unless set.' }, optional: true },
      { name: 'labels', schema: { type: 'boolean', description: 'Whether to import labels as tags; true unless set.' }, optional: true },
      { name: 'playlists', schema: { type: 'boolean', description: 'Whether to import saved lists as playlists; true unless set.' }, optional: true }
    ],
    destructive: true
  },
  clear_library: {
    description: 'Removes every track, album, playlist, rating and play from the library. The library is backed up first, and the call is refused if that fails; the music folders stay listed and the music files are not touched.',
    params: [],
    destructive: true
  },
  get_player_status: { description: 'Gives what is playing, where in it in milliseconds, the volume 0 to 100, repeat, shuffle and the queued track ids.', params: [] },
  play_track: {
    description: 'Plays a track now, optionally within a list of tracks to go on through.',
    params: [
      { name: 'track_id', schema: id_of('track') },
      { name: 'context', schema: { type: 'array', items: { type: 'string' }, description: 'The track ids to play on through after it.' }, optional: true },
      { name: 'index', schema: { type: 'integer', minimum: 0, description: 'Where the track is in context.' }, optional: true }
    ]
  },
  toggle_playback: { description: 'Pauses what is playing, or plays again.', params: [] },
  play_next: { description: 'Skips to the next track.', params: [] },
  play_previous: { description: 'Goes back to the previous track.', params: [] },
  stop_playback: { description: 'Stops playing.', params: [] },
  seek: { description: 'Moves within the playing track.', params: [{ name: 'position_ms', schema: { type: 'integer', minimum: 0, description: 'Where to go, in milliseconds from the start.' } }] },
  set_volume: { description: 'Sets the volume.', params: [{ name: 'volume', schema: { type: 'number', minimum: 0, maximum: 100, description: 'From 0 to 100.' } }] },
  queue_tracks: {
    description: 'Adds tracks to the queue, which plays before the rest of the list.',
    params: [
      { name: 'track_ids', schema: track_ids },
      { name: 'position', schema: { type: 'string', enum: ['end', 'next'], description: 'At the end of the queue or next; the end unless set.' }, optional: true }
    ]
  },
  remove_from_queue: { description: 'Takes one track out of the queue.', params: [{ name: 'index', schema: { type: 'integer', minimum: 0, description: 'Its place in the queue, from 0.' } }] },
  move_in_queue: {
    description: 'Moves one track to another place in the queue.',
    params: [
      { name: 'index', schema: { type: 'integer', minimum: 0, description: 'Its place in the queue now, from 0.' } },
      { name: 'to_index', schema: { type: 'integer', minimum: 0, description: 'The place it moves to, from 0; past the end puts it last.' } }
    ]
  },
  clear_queue: { description: 'Empties the queue.', params: [] },
  set_repeat: { description: 'Sets whether the list or the track repeats.', params: [{ name: 'mode', schema: { type: 'string', enum: ['off', 'all', 'one'] } }] },
  set_shuffle: { description: 'Turns shuffle on or off.', params: [{ name: 'on', schema: { type: 'boolean' } }] },

  list_versions: {
    description: 'Lists a track\'s versions, newest first: each change made to it, by a scan, an import, a merge or an undo, with the track as it was then.',
    params: [{ name: 'item_id', schema: id_of('track') }]
  },
  list_recent_versions: {
    description: 'Lists the latest changes to every track, newest first.',
    params: [{ name: 'limit', schema: { type: 'integer', minimum: 1, description: 'At most this many.' } }]
  },
  restore_version: {
    description: 'Puts a track back as it was in one of its versions, bringing it back if it was deleted. The restore is itself a version, so it can be undone the same way.',
    params: [{ name: 'version_id', schema: id_of('version') }],
    destructive: true
  },
  list_recent_merges: {
    description: 'Lists the latest merges, newest first, undone ones included: each with its batch id, when in Unix milliseconds, the surviving track and the tracks it took in. undo_merge with a batch id puts that merge back.',
    params: [{ name: 'limit', schema: { type: 'integer', minimum: 1, description: 'At most this many.' } }]
  },
  get_history_keep_days: { description: 'Gives how many days versions are kept; each track keeps its newest whatever its age.', params: [] },
  set_history_keep_days: {
    description: 'Sets how many days versions are kept; older versions are deleted for good, each track keeping its newest.',
    params: [{ name: 'days', schema: { type: 'integer', minimum: 1 } }],
    destructive: true
  }
}

// A call that only reads; any other call changes the library or the player.
export function is_read_only(method: string): boolean {
  return /^(list|get|search|lookup|export)_/.test(method)
}

// What an AI client reads first about X-Music.
export const mcp_instructions = [
  'X-Music is a music player holding one person\'s music library: tracks, the files they play from, ratings, plays and playlists.',
  'A track is a piece of music, not a file; its ids, like every id here, are opaque strings from the list_ and get_ calls.',
  'Lengths and positions are in milliseconds, ratings and volume 0 to 100, dates Unix milliseconds.',
  'get_library_stats and list_tracks are the places to start.'
].join(' ')
