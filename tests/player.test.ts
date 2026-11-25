// Playback decisions — what plays next, when a play counts, which file gets used — are tested
// against a fake engine, so none of this depends on an audio backend being present.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { NullEngine } from '@x-tech-laboratories/x-libs/mpv'
import { Player, counts_as_play, shuffle_order } from '@main/play/player'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { new_id } from '@shared/library/database'
import { add_track, fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb
let engine: NullEngine
let player: Player

// Files must really exist now that the player checks, so the default one is created.
let scratch: string

function make_track(o: {
  title?: string; length_ms?: number | null; files?: { uri: string; present?: boolean; rank?: number }[]
  track_gain?: number | null
} = {}): string {
  const id = add_track(db, { title: o.title ?? 'Song', length_ms: o.length_ms === undefined ? 200_000 : o.length_ms, rg_track_gain: o.track_gain ?? null })

  const files = o.files ?? [{ uri: join(scratch, `${id}.flac`) }]
  for (const f of files) {
    if (f.uri.startsWith(scratch)) writeFileSync(f.uri, Buffer.alloc(16))
    db.prepare(`INSERT INTO media (id, track_id, kind, uri, present, quality_rank, added)
                VALUES (?, ?, 'file', ?, ?, ?, 0)`)
      .run(new_id(), id, f.uri, f.present === false ? 0 : 1, f.rank ?? 0)
  }
  return id
}

const stat = (id: string): { play_count: number; skip_count: number; last_played: number | null } =>
  db.prepare('SELECT play_count, skip_count, last_played FROM tracks WHERE id = ?')
    .get(id) as never

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'x-music-tracks-'))
  db = fresh_db()
  engine = new NullEngine()
  player = new Player(db, engine)
})

afterEach(async () => {
  await player.dispose()
  db.close()
  rmSync(scratch, { recursive: true, force: true })
})

describe('play thresholds', () => {
  it('counts a play at half the track', () => {
    expect(counts_as_play(99_000, 200_000)).toBe(false)
    expect(counts_as_play(100_000, 200_000)).toBe(true)
  })

  it('counts a play after four minutes regardless of length', () => {
    expect(counts_as_play(240_000, 3_600_000)).toBe(true)
  })

  it('cannot count a play when the duration is unknown and little was heard', () => {
    expect(counts_as_play(1000, null)).toBe(false)
  })
})

describe('playing a track', () => {
  it('loads the track\'s file and starts', async () => {
    const id = make_track({ title: 'So What' })
    await player.play_track(id)

    expect(engine.loaded).toEqual([join(scratch, `${id}.flac`)])
    expect(player.status().state).toBe('playing')
    expect(player.status().track?.title).toBe('So What')
  })

  it('prefers higher quality among sources that exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'x-music-player-'))
    const lossless = join(dir, 'a.flac')
    const lossy = join(dir, 'b.mp3')
    writeFileSync(lossless, Buffer.alloc(16))
    writeFileSync(lossy, Buffer.alloc(16))
    try {
      const id = make_track({ files: [
        { uri: lossy, rank: 100 },
        { uri: lossless, rank: 10_000 }
      ]})
      await player.play_track(id)
      expect(engine.loaded).toEqual([lossless])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says a track has no file at all, rather than failing at load', async () => {
    await player.play_track(add_track(db, { title: 'orphan' }))

    const s = player.status()
    expect(s.state).toBe('error')
    expect(s.error).toMatch(/no file/i)
  })

  it('says the file is missing when the row exists but the file does not', async () => {
    // The common case in an imported library: rows describing files that have since gone.
    const id = make_track({ files: [{ uri: '/definitely/not/here.flac' }] })
    await player.play_track(id)

    const s = player.status()
    expect(s.state).toBe('error')
    expect(s.error).toMatch(/missing/i)
    // Never hand an absent path to the engine; "loading failed" explains nothing.
    expect(engine.loaded).toEqual([])
  })

  it('marks a vanished file absent, so the library corrects itself as it is used', async () => {
    const id = make_track({ files: [{ uri: '/definitely/not/here.flac', present: true }] })
    await player.play_track(id)

    const row = db.prepare('SELECT present FROM media WHERE track_id = ?').get(id) as
      { present: number }
    expect(row.present).toBe(0)
  })

  it('falls through to a source that is really there', async () => {
    const real = join(tmpdir(), `x-music-player-${Date.now()}.flac`)
    writeFileSync(real, Buffer.alloc(16))
    try {
      const id = make_track({ files: [
        { uri: '/gone/first.flac', rank: 10_000 },
        { uri: real, rank: 1 }
      ]})
      await player.play_track(id)
      expect(engine.loaded).toEqual([real])
    } finally {
      rmSync(real, { force: true })
    }
  })

  it('applies ReplayGain only when asked', async () => {
    const id = make_track({ track_gain: -6 })

    const off = new NullEngine()
    const p1 = new Player(db, off)
    await p1.play_track(id)
    expect(p1.status().media?.gain_db).toBeNull()

    const on = new NullEngine()
    const p2 = new Player(db, on, { replay_gain: 'track', preamp_db: 2 })
    await p2.play_track(id)
    expect(p2.status().media?.gain_db).toBe(-4)

    await p1.dispose(); await p2.dispose()
  })
})

describe('statistics', () => {
  it('counts a play once the threshold is passed, and only once', async () => {
    const id = make_track({ length_ms: 200_000 })
    await player.play_track(id)

    engine.tick(50_000)
    expect(stat(id).play_count).toBe(0)

    engine.tick(120_000)
    expect(stat(id).play_count).toBe(1)

    engine.tick(180_000)
    expect(stat(id).play_count).toBe(1)
  })

  it('counts a play when the track simply ends', async () => {
    const id = make_track({ length_ms: 200_000 })
    await player.play_track(id)
    engine.tick(10_000)
    engine.finish()

    await new Promise((r) => setTimeout(r, 0))
    expect(stat(id).play_count).toBe(1)
  })

  it('records a skip when a track is abandoned part way', async () => {
    const a = make_track()
    const b = make_track()
    await player.play_track(a)
    engine.tick(20_000)
    await player.next()

    expect(stat(a).skip_count).toBe(1)
    expect(stat(a).play_count).toBe(0)
    expect(stat(b).skip_count).toBe(0)
  })

  it('does not record a skip for a track that barely started', async () => {
    const a = make_track()
    await player.play_track(a)
    engine.tick(500)
    await player.next()
    expect(stat(a).skip_count).toBe(0)
  })

  it('does not let seeking backwards fake a second play', async () => {
    const id = make_track({ length_ms: 200_000 })
    await player.play_track(id)
    engine.tick(150_000)
    expect(stat(id).play_count).toBe(1)

    await player.seek(0)
    engine.tick(150_000)
    expect(stat(id).play_count).toBe(1)
  })
})

describe('queue and context', () => {
  it('drains the queue before the standing list', async () => {
    const [a, b, q] = [make_track(), make_track(), make_track()]
    player.set_context([a, b], 0)
    await player.play_track(a, 0)
    player.enqueue([q])

    expect(player.peek_next()).toBe(q)
    await player.next()
    expect(player.status().track?.id).toBe(q)

    // With the queue drained, playback returns to where the context left off.
    await player.next()
    expect(player.status().track?.id).toBe(b)
  })

  it('queues next ahead of what is already queued', async () => {
    const [a, b, c] = [make_track(), make_track(), make_track()]
    player.enqueue([a, b])
    player.enqueue([c], 'next')
    expect(player.status().queue).toEqual([c, a, b])
  })

  it('stops at the end of the context when repeat is off', async () => {
    const [a, b] = [make_track(), make_track()]
    player.set_context([a, b], 0)
    await player.play_track(a, 0)
    await player.next()
    await player.next()
    expect(player.status().state).toBe('idle')
  })

  it('wraps to the start when repeat is all', async () => {
    const [a, b] = [make_track(), make_track()]
    player.set_context([a, b], 0)
    player.set_repeat('all')
    await player.play_track(a, 0)
    await player.next()
    await player.next()
    expect(player.status().track?.id).toBe(a)
  })

  it('repeats one track when the track ends, but a manual skip still moves on', async () => {
    const [a, b] = [make_track(), make_track()]
    player.set_context([a, b], 0)
    player.set_repeat('one')
    await player.play_track(a, 0)

    engine.finish()
    await new Promise((r) => setTimeout(r, 0))
    expect(player.status().track?.id).toBe(a)

    await player.next(true)
    expect(player.status().track?.id).toBe(b)
  })

  it('previous restarts the track before stepping back', async () => {
    const [a, b] = [make_track(), make_track()]
    player.set_context([a, b], 0)
    await player.play_track(b, 1)
    engine.tick(30_000)

    await player.previous()
    expect(player.status().track?.id).toBe(b)
    expect(player.status().position_ms).toBe(0)

    await player.previous()
    expect(player.status().track?.id).toBe(a)
  })

  it('starts the track again after mpv quits by itself, and has nothing to pause meanwhile', async () => {
    const [a, b] = [make_track(), make_track()]
    player.set_context([a, b], 0)
    await player.play_track(a, 0)

    // The engine going idle on its own is how a clean quit of mpv shows.
    await engine.stop()
    expect(player.status().state).toBe('idle')
    expect(player.status().track?.id).toBe(a)

    await player.pause()
    expect(engine.state).toBe('idle')

    await player.toggle()
    expect(player.status().state).toBe('playing')
    expect(engine.loaded).toEqual([engine.uri, engine.uri])
  })

  it('hands the engine the file\'s part and loudness change', async () => {
    const options: unknown[] = []
    const recording = new (class extends NullEngine {
      override async load(uri: string, load_options?: unknown): Promise<void> {
        options.push(load_options)
        await super.load(uri)
      }
    })()
    const id = make_track({ track_gain: -6 })
    db.prepare('UPDATE media SET start_ms = 1000, end_ms = 5000 WHERE track_id = ?').run(id)
    const gained = new Player(db, recording, { replay_gain: 'track', preamp_db: 2 })

    await gained.play_track(id)
    expect(options).toEqual([{ start_in_milliseconds: 1000, end_in_milliseconds: 5000, gain_in_decibels: -4 }])
    await gained.dispose()
  })

  it('removes a queued track by position', async () => {
    const [a, b, c] = [make_track(), make_track(), make_track()]
    player.enqueue([a, b, c])
    player.dequeue(1)
    expect(player.status().queue).toEqual([a, c])
  })

  it('moves a queued track to another place in the queue', async () => {
    const [a, b, c, d] = [make_track(), make_track(), make_track(), make_track()]
    player.enqueue([a, b, c, d])

    player.move_in_queue(0, 2)
    expect(player.status().queue).toEqual([b, c, a, d])

    player.move_in_queue(3, 0)
    expect(player.status().queue).toEqual([d, b, c, a])

    player.move_in_queue(1, 99)
    expect(player.status().queue).toEqual([d, c, a, b])
  })

  it('refuses to move a place the queue does not have', async () => {
    player.enqueue([make_track()])

    expect(() => player.move_in_queue(1, 0)).toThrow('no queued track at 1')
    expect(() => player.move_in_queue(-1, 0)).toThrow('no queued track at -1')
  })

  it('plays a moved track in its new place', async () => {
    const [a, b, c] = [make_track(), make_track(), make_track()]
    player.enqueue([a, b, c])
    player.move_in_queue(2, 0)

    await player.next(true)

    expect(player.status().track?.id).toBe(c)
    expect(player.status().queue).toEqual([a, b])
  })
})

describe('shuffle', () => {
  it('produces a reproducible permutation containing every index', () => {
    const order = shuffle_order(20, 42)
    expect([...order].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(shuffle_order(20, 42)).toEqual(order)
    expect(shuffle_order(20, 43)).not.toEqual(order)
  })

  it('visits every track in the context exactly once', async () => {
    const ids = [make_track(), make_track(), make_track(), make_track(), make_track()]
    player.set_context(ids, 0)
    player.set_shuffle(true)
    await player.play_track(ids[0]!, 0)

    const seen = [player.status().track!.id]
    for (let i = 0; i < ids.length - 1; i++) {
      await player.next(false)
      const id = player.status().track?.id
      if (id) seen.push(id)
    }

    expect(new Set(seen).size).toBe(ids.length)
  })
})

describe('engine hand-off', () => {
  it('tells the engine what is coming, for a gapless transition', async () => {
    const [a, b] = [make_track(), make_track()]
    player.set_context([a, b], 0)
    await player.play_track(a, 0)
    await new Promise((r) => setTimeout(r, 0))

    expect(engine.preloaded).toContain(join(scratch, `${b}.flac`))
  })

  it('surfaces an engine error in the status', async () => {
    const id = make_track()
    await player.play_track(id)
    engine.fail('decoder exploded')

    expect(player.status().state).toBe('error')
    expect(player.status().error).toBe('decoder exploded')
  })

  it('turns an engine that cannot start into the error state instead of a rejection', async () => {
    const id = make_track()
    engine.load = async () => { throw new Error('mpv did not answer') }

    await player.play_track(id)

    expect(player.status().state).toBe('error')
    expect(player.status().error).toBe('mpv did not answer')
    expect(player.status().track?.id).toBe(id)
  })

  it('starts the failed track again on play, so play is the retry', async () => {
    const id = make_track()
    const load = engine.load.bind(engine)
    engine.load = async () => { throw new Error('mpv did not answer') }
    await player.play_track(id)

    engine.load = load
    await player.toggle()

    expect(player.status().state).toBe('playing')
    expect(player.status().error).toBeUndefined()
    expect(engine.loaded).toHaveLength(1)
  })

  it('notifies subscribers when the status changes', async () => {
    const seen: string[] = []
    player.subscribe((e, p) => { if (e === 'status') seen.push((p as { state: string }).state) })

    await player.play_track(make_track())
    expect(seen).toContain('playing')
  })
})

describe('reloading the playing track', () => {
  it('shows a new rating on the playing track, and ignores edits to other tracks', async () => {
    const id = make_track({ title: 'So What' })
    const other = make_track({ title: 'Blue in Green' })
    await player.play_track(id)
    const seen: (number | null | undefined)[] = []
    player.subscribe((event) => { if (event === 'status') seen.push(player.status().track?.rating) })

    db.prepare('UPDATE tracks SET rating = 80 WHERE id IN (?, ?)').run(id, other)
    player.reload_track([other])
    expect(player.status().track?.rating).toBeNull()

    player.reload_track([other, id])
    expect(player.status().track?.rating).toBe(80)
    expect(seen).toEqual([80])
  })
})
