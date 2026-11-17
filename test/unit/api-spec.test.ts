// The api_spec other programs read: one description per call, reads marked as reads, and arguments taken by name.

import { describe, expect, it } from 'vitest'
import { input_schema, positional_args } from '@x-tech-laboratories/x-libs/api_spec'
import { is_read_only, x_music_api } from '@shared/api'
import { api_method_names, history_channels, page_method_names } from '@shared/ipc'

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

  it('takes a call\'s arguments by name, in the order the call takes them', () => {
    const merge = x_music_api.merge_tracks

    expect(input_schema(merge)).toMatchObject({ required: ['track_ids', 'survivor_id'] })
    expect(positional_args(merge, { survivor_id: 'track-2', track_ids: ['track-1', 'track-2'] })).toEqual([['track-1', 'track-2'], 'track-2'])
    expect(positional_args(x_music_api.import_gmbrc, { path: '/tmp/gmbrc', playlists: false })).toEqual(['/tmp/gmbrc', undefined, undefined, false])
  })
})
