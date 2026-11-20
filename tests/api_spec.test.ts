// The api_spec other programs read: one description per call, reads marked as reads, and arguments taken by name.

import { describe, expect, it } from 'vitest'
import { input_schema, positional_args } from '@x-tech-laboratories/x-libs/api_spec'
import { is_read_only, mcp_instructions, x_music_api } from '@shared/api'
import type { FilterNode } from '@x-tech-laboratories/x-libs/filter'
import { api_method_names, history_channels, page_method_names, x_music_bridge, type TrackRow } from '@shared/ipc'
import { query_tracks } from '@shared/library/store'
import { add_track, fresh_db } from './sqlite.ts'

describe('api spec', () => {
  it('describes every call other programs may make, and none only the window makes', () => {
    expect(Object.keys(x_music_api).sort()).toEqual([...api_method_names, ...history_channels].sort())
    for (const name of page_method_names) expect(x_music_api).not.toHaveProperty(name)
    for (const spec of Object.values(x_music_api)) expect(spec.description).toMatch(/^[A-Z].*\.$/)
  })

  it('marks only the calls that read as read-only, never a merge, a clear or a restore', () => {
    expect(is_read_only('list_tracks')).toBe(true)
    expect(is_read_only('get_merge_preview')).toBe(true)
    for (const name of ['clear_library', 'merge_tracks', 'undo_merge', 'restore_version', 'remove_folder', 'import_gmbrc']) {
      expect(is_read_only(name)).toBe(false)
    }
  })

  it('marks the calls that delete or overwrite data as destructive, and only those', () => {
    const destructive = Object.entries(x_music_api).filter(([, spec]) => spec.destructive).map(([name]) => name).sort()
    expect(destructive).toEqual(['clear_library', 'import_gmbrc', 'merge_tracks', 'restore_version', 'set_history_keep_days', 'undo_merge'])
  })

  it('takes a seed on a sort key, so a client can ask for the same shuffle again', () => {
    expect(input_schema(x_music_api.list_tracks)).toMatchObject({ properties: { sort: { items: { properties: { seed: { type: 'integer' } } } } } })
  })

  it('moves a queued track by its place and the place to go to', () => {
    expect(input_schema(x_music_api.move_in_queue)).toMatchObject({ required: ['index', 'to_index'] })
    expect(positional_args(x_music_api.move_in_queue, { to_index: 0, index: 2 })).toEqual([2, 0])
    expect(is_read_only('move_in_queue')).toBe(false)
  })

  it('takes a call\'s arguments by name, in the order the call takes them', () => {
    const merge = x_music_api.merge_tracks

    expect(input_schema(merge)).toMatchObject({ required: ['track_ids', 'survivor_id'] })
    expect(positional_args(merge, { survivor_id: 'track-2', track_ids: ['track-1', 'track-2'] })).toEqual([['track-1', 'track-2'], 'track-2'])
    expect(positional_args(x_music_api.import_gmbrc, { path: '/tmp/gmbrc', playlists: false })).toEqual(['/tmp/gmbrc', undefined, undefined, false])
  })
})

describe('dates on the api', () => {
  it('says dates are Unix milliseconds, as the library stores them', () => {
    expect(mcp_instructions).toMatch(/dates Unix milliseconds/)
    expect(JSON.stringify(input_schema(x_music_api.list_tracks))).toMatch(/dates Unix milliseconds/)
    expect(`${mcp_instructions} ${JSON.stringify(x_music_api)}`).not.toMatch(/Unix seconds/)
  })

  it('lets a client filter by when a track was added, in the unit the spec states', async () => {
    const db = fresh_db()
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    const old_track = add_track(db, { title: 'Old', added: now - 30 * day })
    const new_track = add_track(db, { title: 'New', added: now - day })
    const api = { list_tracks: (filter: FilterNode) => query_tracks(db, { filter }) }

    const added_after = (cutoff: number) => x_music_bridge.dispatch(api as never, 'list_tracks',
      positional_args(x_music_api.list_tracks, { filter: { field: 'added', op: 'after', value: cutoff } })) as Promise<TrackRow[]>

    expect((await added_after(now - 7 * day)).map((track) => track.id)).toEqual([new_track])
    expect((await added_after(now - 60 * day)).map((track) => track.id).sort()).toEqual([old_track, new_track].sort())
  })
})
