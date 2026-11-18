// Everything known about one track: its fields, its files best first with their tags, its plays and the merges it took in.

import { describe, expect, it } from 'vitest'
import { field } from '@shared/fields'
import { new_id } from '@shared/library/database'
import { track_details } from '@shared/library/details'
import { merge_tracks } from '@shared/library/merge'
import { add_track, fresh_db, type TestDb } from './sqlite.ts'

function add_media(db: TestDb, track_id: string, uri: string, present: number, quality_rank: number): string {
  const id = new_id()
  db.prepare("INSERT INTO media (id, track_id, kind, uri, codec, present, quality_rank, audio_hash, added) VALUES (?, ?, 'file', ?, 'flac', ?, ?, ?, 0)")
    .run(id, track_id, uri, present, quality_rank, new Uint8Array([0xab, 0x01]))
  return id
}

describe('track details', () => {
  it('gives the track\'s fields, files, plays and merges', () => {
    const db = fresh_db()
    const id = add_track(db, { title: 'So What', length_ms: 545_000, play_count: 3, rating: 80 })
    const other = add_track(db, { title: 'So What' })
    const genre = field('genre').field_id!
    const value_id = new_id()
    db.prepare('INSERT INTO values_ (id, field_id, value) VALUES (?, ?, ?)').run(value_id, genre, 'Jazz')
    db.prepare('INSERT INTO track_values (track_id, field_id, value_id, ordinal) VALUES (?, ?, ?, 0)').run(id, genre, value_id)
    db.prepare('INSERT INTO track_extras (track_id, field_id, value) VALUES (?, ?, ?)').run(id, field('comment').field_id!, 'Take one')
    const missing = add_media(db, id, '/music/missing.flac', 0, 9)
    const best = add_media(db, id, '/music/best.flac', 1, 5)
    const worse = add_media(db, id, '/music/worse.flac', 1, 1)
    db.prepare('INSERT INTO media_tags (media_id, field_id, ordinal, value) VALUES (?, ?, 0, ?)').run(best, genre, 'Modal')
    for (const at of [10, 30, 20]) db.prepare('INSERT INTO play_history (id, track_id, at, kind) VALUES (?, ?, ?, ?)').run(new_id(), id, at, at === 20 ? 1 : 0)
    const merged = merge_tracks(db, { ids: [id, other], survivor: id })

    const details = track_details(db, id)!

    expect(details.title).toBe('So What')
    expect(details.fields.find((each) => each.field === 'length')?.value).toBe('545000')
    expect(details.fields.find((each) => each.field === 'genre')).toMatchObject({ value: 'Jazz', multi: true })
    expect(details.fields.find((each) => each.field === 'comment')).toMatchObject({ value: 'Take one', multi: false })
    expect(details.media.map((each) => each.id)).toEqual([best, worse, missing])
    expect(details.media[0]).toMatchObject({ preferred: true, present: true, audio_hash_hex: 'ab01', tags: [{ field: 'Genre', value: 'Modal' }] })
    expect(details.history).toEqual([{ at: 30, kind: 'play' }, { at: 20, kind: 'skip' }, { at: 10, kind: 'play' }])
    expect(details.history_total).toBe(3)
    expect(details.statistics.rating).toBe(80)
    expect(details.merges).toEqual([{ batch_id: merged.batch_id, at: expect.any(Number), absorbed: 1 }])
    expect(track_details(db, 'no-such-track')).toBeNull()
  })
})
