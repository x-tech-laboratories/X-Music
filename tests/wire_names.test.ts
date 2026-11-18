// What the calls hand other programs is named in snake_case throughout, as the arguments are.

import { describe, expect, it } from 'vitest'
import { new_id } from '@shared/library/database'
import { track_details } from '@shared/library/details'
import { find_duplicates } from '@shared/library/duplicates'
import { list_recent_merges, merge_preview, merge_tracks, unmerge } from '@shared/library/merge'
import { add_root, library_stats, list_roots } from '@shared/library/store'
import { add_track, fresh_db, type TestDb } from './sqlite.ts'

// Every key in a value, nested ones included.
function keys_of(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys_of)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keys_of(inner)])
}

function expect_snake_case(value: unknown): void {
  expect(keys_of(value).filter((key) => !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(key))).toEqual([])
}

function add_media(db: TestDb, track_id: string, uri: string): void {
  db.prepare("INSERT INTO media (id, track_id, kind, uri, codec, added) VALUES (?, ?, 'file', ?, 'flac', 0)").run(new_id(), track_id, uri)
}

describe('names on the wire', () => {
  it('names every field of the library\'s answers in snake_case', () => {
    const db = fresh_db()
    const first = add_track(db, { title: 'Song', length_ms: 200_000, play_count: 2 })
    const second = add_track(db, { title: 'Song', length_ms: 200_000 })
    add_media(db, first, '/music/a.flac')
    add_media(db, second, '/music/b.flac')
    db.prepare('INSERT INTO play_history (id, track_id, at, kind) VALUES (?, ?, 5, 0)').run(new_id(), first)
    add_root(db, '/music')

    expect_snake_case(library_stats(db, '/tmp/library.db'))
    expect_snake_case(list_roots(db))
    expect_snake_case(find_duplicates(db, { reasons: ['tags'] }))
    expect_snake_case(merge_preview(db, [first, second]))
    const merged = merge_tracks(db, { ids: [first, second], survivor: first })
    expect_snake_case(merged)
    expect_snake_case(track_details(db, first))
    expect_snake_case(list_recent_merges(db, 5))
    expect_snake_case(unmerge(db, merged.batch_id))
  })
})
