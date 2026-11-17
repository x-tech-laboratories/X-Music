// Every change to a track is kept as a version that can be restored, through X-Libs history; plays alone are not
// changes, and a merge shows as the survivor edited and the absorbed tracks deleted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { field } from '@shared/fields'
import { new_id } from '@shared/library/database'
import {
  default_history_keep_days, get_history_keep_days, record_history, set_history_keep_days, track_history, track_history_methods
} from '@shared/library/history'
import { createUpserter } from '@shared/library/identity'
import { mergeTracks, unmerge } from '@shared/library/merge'
import { count_play } from '@shared/library/plays'
import { set_extra, write_set } from '@shared/library/values'
import { freshDb, type TestDb } from './sqlite.ts'

let db: TestDb

beforeEach(() => { db = freshDb() })
afterEach(() => db.close())

const genre = field('genre').fieldId!
const comment = field('comment').fieldId!

function scanned(title: string, uri: string, genres: string[] = []): string {
  const result = createUpserter(db)({ title, artist: 'Miles Davis', sets: { artist: ['Miles Davis'], genre: genres } }, { uri }, { metadata: true })
  record_history(db)
  return result.trackId
}

const versions = (track_id: string) => track_history_methods(() => db).list_versions(track_id)

describe('track history', () => {
  it('records a new track, then each edit to it, newest first', () => {
    const id = scanned('So What', '/music/so-what.flac', ['Jazz'])

    db.prepare("UPDATE tracks SET rating = 100 WHERE id = ?").run(id)
    record_history(db)
    write_set(db, id, genre, ['Jazz', 'Modal'])
    record_history(db)

    const list = versions(id)
    expect(list.map((version) => version.kind)).toEqual(['edited', 'edited', 'created'])
    expect(list[0]!.snapshot.values.filter((value) => value.field_id === genre).map((value) => value.value)).toEqual(['Jazz', 'Modal'])
    expect(list[1]!.snapshot.track.rating).toBe(100)
    expect(list[1]!.previous?.track.rating).toBeNull()
  })

  it('makes no version for a play, which is a log rather than an edit', () => {
    const id = scanned('So What', '/music/so-what.flac')

    count_play(db, id, 1_000)
    record_history(db)

    expect(versions(id)).toHaveLength(1)
    expect(db.prepare('SELECT play_count FROM tracks WHERE id = ?').get(id)).toEqual({ play_count: 1 })
  })

  it('restores an earlier version, keeping the plays counted since', () => {
    const id = scanned('So What', '/music/so-what.flac', ['Jazz'])
    set_extra(db, id, comment, 'first take')
    record_history(db)
    const before_edit = versions(id)[0]!.id

    db.prepare("UPDATE tracks SET title = 'So What (live)', rating = 20 WHERE id = ?").run(id)
    write_set(db, id, genre, ['Live'])
    set_extra(db, id, comment, 'changed')
    count_play(db, id, 5_000)
    record_history(db)

    track_history_methods(() => db).restore_version(before_edit)

    expect(db.prepare('SELECT title, rating, play_count FROM tracks WHERE id = ?').get(id))
      .toEqual({ title: 'So What', rating: null, play_count: 1 })
    expect(db.prepare(`SELECT v.value FROM track_values tv JOIN values_ v ON v.id = tv.value_id
                       WHERE tv.track_id = ? AND tv.field_id = ?`).all(id, genre)).toEqual([{ value: 'Jazz' }])
    expect(db.prepare('SELECT value FROM track_extras WHERE track_id = ?').get(id)).toEqual({ value: 'first take' })
    expect(versions(id)[0]!.kind).toBe('restored')
  })

  it('shows a merge as the survivor edited and the absorbed track deleted, and its undo as restored', () => {
    const survivor = scanned('So What', '/music/a.flac')
    const absorbed = scanned('So What', '/music/b.flac')

    const merge = mergeTracks(db, { ids: [survivor, absorbed], survivor })
    record_history(db)

    expect(versions(survivor)[0]!.kind).toBe('edited')
    expect(versions(absorbed)[0]!.kind).toBe('deleted')
    const recent = track_history_methods(() => db).list_recent_versions(10)
    expect(recent.slice(0, 2).map((version) => version.kind).sort()).toEqual(['deleted', 'edited'])

    unmerge(db, merge.batchId)
    record_history(db)

    expect(versions(absorbed)[0]!.kind).toBe('restored')
  })

  it('brings back a track a merge took away, with its file', () => {
    const survivor = scanned('So What', '/music/a.flac')
    const absorbed = scanned('So What', '/music/b.flac')
    mergeTracks(db, { ids: [survivor, absorbed], survivor })
    record_history(db)

    track_history_methods(() => db).restore_version(versions(absorbed)[0]!.id)

    expect(db.prepare('SELECT title FROM tracks WHERE id = ?').get(absorbed)).toEqual({ title: 'So What' })
    expect(db.prepare('SELECT uri FROM media WHERE track_id = ?').all(absorbed)).toEqual([{ uri: '/music/b.flac' }])
  })

  it('records a write made inside an upsert of a watched table', () => {
    const id = scanned('So What', '/music/so-what.flac')

    set_extra(db, id, comment, 'one')
    set_extra(db, id, comment, 'two')
    write_set(db, id, genre, ['Jazz'])
    write_set(db, id, genre, ['Jazz'])
    record_history(db)

    expect(versions(id)[0]!.snapshot.extras).toEqual([{ field_id: comment, value: 'two' }])
  })

  it('keeps versions for a set number of days, a setting that defaults to a year', () => {
    expect(get_history_keep_days(db)).toBe(default_history_keep_days)

    set_history_keep_days(db, 30)

    expect(get_history_keep_days(db)).toBe(30)
    expect(() => set_history_keep_days(db, 0)).toThrow(/at least one day/)
  })

  it('prunes versions older than the setting, keeping each track\'s newest', () => {
    const id = scanned('So What', '/music/so-what.flac')
    db.prepare("UPDATE tracks SET rating = 40 WHERE id = ?").run(id)
    record_history(db)
    db.prepare("UPDATE track_versions SET changed_at = '2000-01-01T00:00:00.000Z'").run()

    set_history_keep_days(db, 30)

    expect(versions(id)).toHaveLength(1)
    expect(versions(id)[0]!.snapshot.track.rating).toBe(40)
  })

  it('leaves out an album that has gone when restoring', () => {
    const id = scanned('So What', '/music/so-what.flac')
    const album = new_id()
    db.prepare("INSERT INTO albums (id, match_key, name, added) VALUES (?, 'gone', 'Gone', 0)").run(album)
    db.prepare('UPDATE tracks SET album_id = ? WHERE id = ?').run(album, id)
    record_history(db)
    const with_album = versions(id)[0]!.id
    db.prepare('UPDATE tracks SET album_id = NULL WHERE id = ?').run(id)
    db.prepare('DELETE FROM albums WHERE id = ?').run(album)
    record_history(db)

    track_history.restore(db, with_album)

    expect(db.prepare('SELECT album_id FROM tracks WHERE id = ?').get(id)).toEqual({ album_id: null })
  })
})
