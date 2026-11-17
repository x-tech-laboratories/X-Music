// Cover art resolution: where it looks, what it prefers, and that a miss is remembered so a
// coverless track is not searched again on every play.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { find_folder_image, image_size, lookup_artwork, resolve_artwork, forget_misses }
  from '@main/library/artwork'
import { new_id } from '@shared/library/database'
import { add_track, fresh_db, type TestDb } from './sqlite.ts'

let dir: string
let cache: string
let db: TestDb

/** A PNG header with the given dimensions; enough for the size reader and for hashing. */
function png(width: number, height: number, fill = 0): Buffer {
  const buf = Buffer.alloc(64, fill)
  buf.writeUInt32BE(0x89504e47, 0)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function make_track(uri: string, album?: string): string {
  let album_id: string | null = null
  if (album) {
    db.prepare('INSERT OR IGNORE INTO albums (id, match_key, name, added) VALUES (?, ?, ?, 0)')
      .run(new_id(), album, album)
    album_id = (db.prepare('SELECT id FROM albums WHERE match_key = ?').get(album) as { id: string }).id
  }
  const id = add_track(db, { title: 'Song', album_id })
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, present, added) VALUES (?, ?, 'file', ?, 1, 0)`)
    .run(new_id(), id, uri)
  return id
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'x-music-art-'))
  cache = join(dir, 'cache')
  db = fresh_db()
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('imageSize', () => {
  it('reads PNG dimensions from the header', () => {
    expect(image_size(png(600, 400))).toEqual({ width: 600, height: 400 })
  })

  it('returns null for something that is not an image', () => {
    expect(image_size(Buffer.from('not an image at all'))).toBeNull()
  })
})

describe('findFolderImage', () => {
  it('prefers a conventionally named cover', async () => {
    await mkdir(join(dir, 'album'), { recursive: true })
    await writeFile(join(dir, 'album', 'random.png'), png(10, 10))
    await writeFile(join(dir, 'album', 'cover.png'), png(20, 20))

    expect(find_folder_image(join(dir, 'album', 'track.flac')))
      .toBe(join(dir, 'album', 'cover.png'))
  })

  it('matches regardless of case and extension', async () => {
    await mkdir(join(dir, 'b'), { recursive: true })
    await writeFile(join(dir, 'b', 'Folder.JPG'), png(30, 30))
    expect(find_folder_image(join(dir, 'b', 'track.flac'))).toBe(join(dir, 'b', 'Folder.JPG'))
  })

  it('takes a lone image as the cover', async () => {
    await mkdir(join(dir, 'c'), { recursive: true })
    await writeFile(join(dir, 'c', 'scan001.png'), png(40, 40))
    expect(find_folder_image(join(dir, 'c', 'track.flac'))).toBe(join(dir, 'c', 'scan001.png'))
  })

  it('does not guess when several unnamed images are present', async () => {
    await mkdir(join(dir, 'd'), { recursive: true })
    await writeFile(join(dir, 'd', 'a.png'), png(1, 1))
    await writeFile(join(dir, 'd', 'b.png'), png(2, 2))
    expect(find_folder_image(join(dir, 'd', 'track.flac'))).toBeNull()
  })

  it('copes with an unreadable directory', () => {
    expect(find_folder_image('/definitely/not/here/track.flac')).toBeNull()
  })
})

describe('resolveArtwork', () => {
  it('caches a folder image and records where it came from', async () => {
    await mkdir(join(dir, 'kob'), { recursive: true })
    await writeFile(join(dir, 'kob', 'cover.png'), png(500, 500, 7))
    const id = make_track(join(dir, 'kob', '01.flac'), 'Kind of Blue')

    const art = await resolve_artwork(db, id, { cache_dir: cache })

    expect(art.source).toBe('folder')
    expect(art.path).toContain(cache)
    expect(art.origin).toBe(join(dir, 'kob', 'cover.png'))
    expect(art.width).toBe(500)
  })

  it('shares one answer across every track on an album', async () => {
    await mkdir(join(dir, 'shared'), { recursive: true })
    await writeFile(join(dir, 'shared', 'cover.png'), png(300, 300, 3))
    const a = make_track(join(dir, 'shared', '01.flac'), 'Shared')
    const b = make_track(join(dir, 'shared', '02.flac'), 'Shared')

    await resolve_artwork(db, a, { cache_dir: cache })

    // The second track finds the album's recorded answer without searching again.
    expect(lookup_artwork(db, b)?.source).toBe('folder')
    expect((db.prepare('SELECT COUNT(*) AS n FROM artwork').get() as { n: number }).n).toBe(1)
  })

  it('records a miss so a coverless track is not searched repeatedly', async () => {
    await mkdir(join(dir, 'bare'), { recursive: true })
    const id = make_track(join(dir, 'bare', '01.flac'), 'Bare')

    const art = await resolve_artwork(db, id, { cache_dir: cache })
    expect(art.source).toBe('none')
    expect(art.path).toBeNull()
    expect(lookup_artwork(db, id)?.source).toBe('none')
  })

  it('attaches art to the track itself when it has no album', async () => {
    await mkdir(join(dir, 'single'), { recursive: true })
    await writeFile(join(dir, 'single', 'front.png'), png(200, 200, 9))
    const id = make_track(join(dir, 'single', 'loose.flac'))

    await resolve_artwork(db, id, { cache_dir: cache })
    const row = db.prepare('SELECT album_id, track_id FROM artwork').get() as
      { album_id: number | null; track_id: number | null }
    expect(row.album_id).toBeNull()
    expect(row.track_id).toBe(id)
  })

  it('stores identical images once, since the cache is content addressed', async () => {
    await mkdir(join(dir, 'x'), { recursive: true })
    await mkdir(join(dir, 'y'), { recursive: true })
    await writeFile(join(dir, 'x', 'cover.png'), png(100, 100, 5))
    await writeFile(join(dir, 'y', 'cover.png'), png(100, 100, 5))

    const a = await resolve_artwork(db, make_track(join(dir, 'x', '1.flac'), 'X'),
      { cache_dir: cache })
    const b = await resolve_artwork(db, make_track(join(dir, 'y', '1.flac'), 'Y'),
      { cache_dir: cache })

    expect(a.hash).toBe(b.hash)
    expect(a.path).toBe(b.path)
  })

  it('forgets misses so newly added covers are picked up', async () => {
    await mkdir(join(dir, 'later'), { recursive: true })
    const id = make_track(join(dir, 'later', '01.flac'), 'Later')
    expect((await resolve_artwork(db, id, { cache_dir: cache })).source).toBe('none')

    await writeFile(join(dir, 'later', 'cover.png'), png(120, 120, 4))
    expect(forget_misses(db)).toBe(1)

    expect((await resolve_artwork(db, id, { cache_dir: cache })).source).toBe('folder')
  })
})
