// Cover art: finding it, caching it, and remembering that there is none.
// Art belongs to an album where there is one and to the track otherwise, so a loose single still
// gets a cover. Resolution is lazy — nothing is extracted until something wants to display it —
// and the answer is recorded either way, including "nothing found", so a coverless track is not
// searched again on every play.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { parseFile } from 'music-metadata'

import type { SqlDatabase } from '@x-tech-laboratories/x-libs/sql'

import {
  album_of, lookup_artwork, no_artwork, present_file_paths, record_artwork, type Artwork
} from '@shared/library/covers'

export { forget_misses, lookup_artwork, type ArtSource, type Artwork } from '@shared/library/covers'

// Filenames worth trying, most specific first. Matching is case-insensitive and extension-agnostic, because these conventions are followed loosely in the wild.
const FOLDER_NAMES = [
  'cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall', 'thumb', 'artwork'
]

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

// Reads image dimensions from the header, so a decoder is not needed just to know the size.
export function image_size(buf: Buffer): { width: number; height: number } | null {
  // PNG: IHDR width/height at a fixed offset.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }

  // JPEG: walk the segments to the first start-of-frame.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]!
      const length = buf.readUInt16BE(i + 2)
      // SOF0..SOF15, excluding the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + length
    }
  }

  // WebP: VP8X carries the canvas size; the simple formats are not worth decoding here.
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' &&
      buf.toString('latin1', 8, 12) === 'WEBP' && buf.toString('latin1', 12, 16) === 'VP8X') {
    const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16))
    const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16))
    return { width: w, height: h }
  }

  return null
}

const extension_for = (mime: string | undefined, fallback = '.jpg'): string => {
  if (!mime) return fallback
  if (mime.includes('png')) return '.png'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  if (mime.includes('bmp')) return '.bmp'
  return '.jpg'
}

// Looks beside the file for a conventional cover image.
export function find_folder_image(media_path: string): string | null {
  const dir = dirname(media_path)

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }

  const images = entries
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))

  for (const wanted of FOLDER_NAMES) {
    const hit = images.find((name) => {
      const base = name.slice(0, name.length - extname(name).length).toLowerCase()
      return base === wanted || base.startsWith(`${wanted}.`) || base.startsWith(`${wanted}_`)
    })
    if (hit) return join(dir, hit)
  }

  // A single image in an album folder is almost certainly the cover.
  return images.length === 1 ? join(dir, images[0]!) : null
}

// Pulls the front cover out of a file's tags, preferring an explicitly-typed front image.
export async function read_embedded(media_path: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const meta = await parseFile(media_path, { skipCovers: false })
    const pictures = meta.common.picture
    if (!pictures || pictures.length === 0) return null

    const front = pictures.find((p) => /front|cover/i.test(p.type ?? '')) ?? pictures[0]!
    return { data: Buffer.from(front.data), mime: front.format }
  } catch {
    return null
  }
}

// Sizes generated on demand. A request is served by the smallest one that is large enough.
export const THUMBNAIL_SIZES = [64, 128, 256, 512] as const
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number]

// Resizes an encoded image, returning encoded bytes. Injected so this module stays testable.
export type Resizer = (data: Buffer, size: number) => Buffer | null

export interface ArtworkOptions {
  cache_dir: string
  resize?: Resizer
}

export const size_for = (requested: number): ThumbnailSize =>
  THUMBNAIL_SIZES.find((s) => s >= requested) ?? THUMBNAIL_SIZES[THUMBNAIL_SIZES.length - 1]!

const cache_file = (cache_dir: string, hash: string, ext: string): string =>
  join(cache_dir, hash.slice(0, 2), `${hash}${ext}`)

function store(cache_dir: string, data: Buffer, mime: string | undefined): {
  path: string; hash: string; size: { width: number; height: number } | null
} {
  const hash = createHash('sha256').update(data).digest('hex')
  const path = cache_file(cache_dir, hash, extension_for(mime, extname(mime ?? '') || '.jpg'))

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data)
  }

  return { path, hash, size: image_size(data) }
}

const thumb_path = (cache_dir: string, hash: string, size: number): string =>
  join(cache_dir, 'thumbs', hash.slice(0, 2), `${hash}-${size}.png`)

// A cached thumbnail at the given size, generated on first request. Returns the original when the source is already no larger than what was asked for, because upscaling a small cover wastes space and looks worse than letting the layout scale it.
export function thumbnail(
  opts: ArtworkOptions,
  art: Artwork,
  requested: number
): string | null {
  if (!art.path || !art.hash) return null

  const size = size_for(requested)
  const longest = Math.max(art.width ?? 0, art.height ?? 0)
  if (longest > 0 && longest <= size) return art.path

  const target = thumb_path(opts.cache_dir, art.hash, size)
  if (existsSync(target)) return target
  if (!opts.resize) return art.path

  try {
    const resized = opts.resize(readFileSync(art.path), size)
    if (!resized) return art.path

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, resized)
    return target
  } catch {
    // A thumbnail that cannot be made is not worth failing over; serve the original.
    return art.path
  }
}

// Finds art for a track and records the outcome. Embedded images win over a folder image, because a file that carries its own cover is more specific than a picture shared by a directory.
export async function resolve_artwork(
  database: SqlDatabase,
  track_id: string,
  opts: ArtworkOptions
): Promise<Artwork> {
  const existing = lookup_artwork(database, track_id)
  // A recorded miss stands until something changes; re-searching every play would be wasteful.
  if (existing) return existing

  const track = album_of(database, track_id)
  if (!track) return no_artwork

  const paths = present_file_paths(database, track_id)
  let found: Artwork = no_artwork

  for (const path of paths) {
    const embedded = await read_embedded(path)
    if (embedded) {
      const stored = store(opts.cache_dir, embedded.data, embedded.mime)
      found = {
        source: 'embedded', path: stored.path, origin: path,
        width: stored.size?.width ?? null, height: stored.size?.height ?? null, hash: stored.hash
      }
      break
    }
  }

  if (found.source === 'none') {
    for (const path of paths) {
      const image = find_folder_image(path)
      if (!image) continue
      try {
        const data = readFileSync(image)
        const stored = store(opts.cache_dir, data, extname(image).slice(1))
        found = {
          source: 'folder', path: stored.path, origin: image,
          width: stored.size?.width ?? null, height: stored.size?.height ?? null, hash: stored.hash
        }
        break
      } catch {
        continue
      }
    }
  }

  record_artwork(database, track_id, track.album_id, found, found.path ? read_file_size(found.path) : null, Date.now())

  return found
}

function read_file_size(path: string): number | null {
  try {
    return readFileSync(path).byteLength
  } catch {
    return null
  }
}
