// Identity of a FILE, deliberately distinct from identity of the music (DESIGN-SPEC §3.7).
//
// The hash covers the audio stream only, with every metadata region excluded, so that retagging a
// file does not change its hash and a moved or renamed file is still recognisably the same file.
// AcoustID answers a different question — "is this the same recording?" — and is a hint elsewhere.

import { createHash, type Hash } from 'node:crypto'
import { open, type FileHandle } from 'node:fs/promises'
import { extname } from 'node:path'

export type HashAlgo =
  | 'flac-streaminfo-md5' | 'sha256-mdat' | 'sha256-ogg-packets' | 'sha256-frames' | 'sha256-file'

export interface AudioHash {
  hash: Buffer
  algo: HashAlgo
}

const HASH_CHUNK = 1 << 20

/** Reads FLAC's STREAMINFO MD5 of the decoded audio — already in the file, free and exact. */
async function flac_streaminfo_md5(fh: FileHandle): Promise<AudioHash | null> {
  const head = Buffer.alloc(4)
  await fh.read(head, 0, 4, 0)
  if (head.toString('latin1') !== 'fLaC') return null

  let offset = 4
  for (;;) {
    const header = Buffer.alloc(4)
    const { bytesRead: bytes_read } = await fh.read(header, 0, 4, offset)
    if (bytes_read < 4) return null

    const is_last = (header[0]! & 0x80) !== 0
    const block_type = header[0]! & 0x7f
    const block_len = (header[1]! << 16) | (header[2]! << 8) | header[3]!
    offset += 4

    if (block_type === 0) {
      // STREAMINFO: the decoded-audio MD5 occupies the final 16 bytes of the block.
      if (block_len < 34) return null
      const md5 = Buffer.alloc(16)
      await fh.read(md5, 0, 16, offset + block_len - 16)
      // An all-zero MD5 means the encoder declined to compute one.
      if (md5.every((b) => b === 0)) return null
      return { hash: md5, algo: 'flac-streaminfo-md5' }
    }

    if (is_last) return null
    offset += block_len
  }
}

/**
 * Hashes the payload of every top-level MP4 `mdat` box, which holds the audio samples; tags live
 * in `moov`, so rewriting them never touches what is hashed.
 */
async function mp4_mdat(fh: FileHandle, file_size: number): Promise<AudioHash | null> {
  const ranges: [number, number][] = []
  const header = Buffer.alloc(16)
  let offset = 0

  while (offset + 8 <= file_size) {
    await fh.read(header, 0, 16, offset)
    const size32 = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    if (offset === 0 && type !== 'ftyp') return null

    let header_len = 8
    let box_len: number
    if (size32 === 1) {
      box_len = Number(header.readBigUInt64BE(8))
      header_len = 16
    } else if (size32 === 0) {
      box_len = file_size - offset
    } else {
      box_len = size32
    }
    // A box that overruns the file or undercuts its own header means this is not a sound MP4.
    if (box_len < header_len || offset + box_len > file_size) return null

    if (type === 'mdat') ranges.push([offset + header_len, offset + box_len])
    offset += box_len
  }

  if (ranges.length === 0) return null
  const h = createHash('sha256')
  for (const [start, end] of ranges) await hash_range_into(h, fh, start, end)
  return { hash: h.digest(), algo: 'sha256-mdat' }
}

/** The packet index holding the comment header, for each Ogg codec whose layout is known. */
const OGG_COMMENT_PACKET: readonly [magic: string, index: number][] = [
  ['\x01vorbis', 1],
  ['OpusHead', 1],
  ['Speex   ', 1]
]

/**
 * Hashes the packets of an Ogg stream with the comment packet left out. Packets rather than pages,
 * because retagging repaginates everything after the comment and so changes every page header.
 */
async function ogg_packets(fh: FileHandle, file_size: number, start: number): Promise<AudioHash | null> {
  const h = createHash('sha256')
  // Per logical stream: how many packets have completed, and which one is the comment.
  const streams = new Map<number, { packet: number; skip: number }>()
  const reader = new ChunkReader(fh, file_size)
  let offset = start
  let hashed = false

  while (offset < file_size) {
    const head = await reader.at(offset, 27)
    if (!head || head.toString('latin1', 0, 4) !== 'OggS') return null
    const flags = head[5]!
    const serial = head.readUInt32LE(14)
    const segments = head[26]!

    const lacing = await reader.at(offset + 27, segments)
    if (!lacing) return null
    let body_len = 0
    for (const l of lacing) body_len += l
    const lacing_copy = Buffer.from(lacing)

    const body = await reader.at(offset + 27 + segments, body_len)
    if (!body) return null

    let s = streams.get(serial)
    if (!s) {
      // Only a beginning-of-stream page may introduce a stream, and it opens with the codec header.
      if ((flags & 0x02) === 0) return null
      const match = OGG_COMMENT_PACKET.find(([magic]) => body.toString('latin1', 0, magic.length) === magic)
      if (!match) return null
      s = { packet: 0, skip: match[1] }
      streams.set(serial, s)
    }

    let pos = 0
    for (const len of lacing_copy) {
      if (s.packet !== s.skip) {
        h.update(body.subarray(pos, pos + len))
        hashed = true
      }
      pos += len
      // A lacing value under 255 ends the packet; exactly 255 means it continues.
      if (len < 255) s.packet++
    }

    offset += 27 + segments + body_len
  }

  return hashed ? { hash: h.digest(), algo: 'sha256-ogg-packets' } : null
}

/** Serves small reads from one large buffered read, so walking thousands of Ogg pages stays cheap. */
class ChunkReader {
  private buf = Buffer.alloc(0)
  private buf_start = 0

  private fh: FileHandle
  private file_size: number

  constructor(fh: FileHandle, file_size: number) {
    this.fh = fh
    this.file_size = file_size
  }

  /** The `n` bytes at `pos`, valid until the next call, or null if the file ends first. */
  async at(pos: number, n: number): Promise<Buffer | null> {
    if (pos + n > this.file_size) return null
    if (pos < this.buf_start || pos + n > this.buf_start + this.buf.length) {
      const len = Math.min(Math.max(HASH_CHUNK, n), this.file_size - pos)
      this.buf = Buffer.alloc(len)
      const { bytesRead: bytes_read } = await this.fh.read(this.buf, 0, len, pos)
      if (bytes_read < n) return null
      this.buf_start = pos
    }
    return this.buf.subarray(pos - this.buf_start, pos - this.buf_start + n)
  }
}

/** Size of a leading ID3v2 tag, or 0 if there is none. */
async function id3v2_length(fh: FileHandle): Promise<number> {
  const b = Buffer.alloc(10)
  const { bytesRead: bytes_read } = await fh.read(b, 0, 10, 0)
  if (bytes_read < 10 || b.toString('latin1', 0, 3) !== 'ID3') return 0

  // Syncsafe integer: 7 significant bits per byte.
  const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f)
  const footer = (b[5]! & 0x10) !== 0 ? 10 : 0
  return 10 + size + footer
}

/** Combined size of trailing APEv2 and ID3v1 tags, or 0 if there are none. */
async function trailer_length(fh: FileHandle, file_size: number): Promise<number> {
  let trailer = 0

  if (file_size >= 128) {
    const b = Buffer.alloc(3)
    await fh.read(b, 0, 3, file_size - 128)
    if (b.toString('latin1') === 'TAG') trailer = 128
  }

  const ape_footer_at = file_size - trailer - 32
  if (ape_footer_at >= 0) {
    const b = Buffer.alloc(32)
    await fh.read(b, 0, 32, ape_footer_at)
    if (b.toString('latin1', 0, 8) === 'APETAGEX') {
      const tag_size = b.readUInt32LE(12)
      const flags = b.readUInt32LE(20)
      const has_header = (flags & 0x80000000) !== 0
      trailer += tag_size + (has_header ? 32 : 0)
    }
  }

  return trailer
}

async function hash_range_into(h: Hash, fh: FileHandle, start: number, end: number): Promise<void> {
  const buf = Buffer.alloc(HASH_CHUNK)
  let pos = start
  while (pos < end) {
    const want = Math.min(HASH_CHUNK, end - pos)
    const { bytesRead: bytes_read } = await fh.read(buf, 0, want, pos)
    if (bytes_read <= 0) break
    h.update(buf.subarray(0, bytes_read))
    pos += bytes_read
  }
}

async function hash_range(fh: FileHandle, start: number, end: number): Promise<Buffer> {
  const h = createHash('sha256')
  await hash_range_into(h, fh, start, end)
  return h.digest()
}

/**
 * Hashes a media file's audio content. FLAC gets its embedded decoded-audio MD5; MP4 and Ogg get
 * their audio payload hashed with the tag structures left out; ID3/APE-tagged formats get their
 * frame region hashed; anything else falls back to a whole-file hash, which is still stable under
 * moves but not under retagging.
 */
export async function hash_audio(path: string): Promise<AudioHash> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()

    const flac = await flac_streaminfo_md5(fh)
    if (flac) return flac

    const mp4 = await mp4_mdat(fh, size)
    if (mp4) return mp4

    const start = await id3v2_length(fh)

    const ogg = await ogg_packets(fh, size, start)
    if (ogg) return ogg

    const trailer = await trailer_length(fh, size)
    const end = size - trailer

    if (end <= start) return { hash: await hash_range(fh, 0, size), algo: 'sha256-file' }

    const tagged = start > 0 || trailer > 0
    return {
      hash: await hash_range(fh, start, end),
      algo: tagged ? 'sha256-frames' : 'sha256-file'
    }
  } finally {
    await fh.close()
  }
}

const CONTAINER_EXTENSIONS = new Set(['.m4a', '.m4b', '.mp4', '.aac', '.ogg', '.oga', '.opus', '.spx'])

/** Whether a stored hash should be recomputed: never hashed, or hashed whole before its container was understood. */
export function needs_rehash(path: string, algo: string | null): boolean {
  if (algo === null) return true
  return algo === 'sha256-file' && CONTAINER_EXTENSIONS.has(extname(path).toLowerCase())
}

export const hash_to_hex = (h: Buffer): string => h.toString('hex')
