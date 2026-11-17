// A deterministic synthetic library. Every test that needs data builds it from here so that a
// failure is reproducible from its seed alone.

import type { IndexedTrack } from '@shared/query/evaluate'

export type CorpusTrack = IndexedTrack & { album_name: string | null }

export interface Corpus {
  tracks: CorpusTrack[]
  now: number
}

const GENRES = ['Rock', 'Jazz', 'Blues', 'Electronic', 'Classical', 'Folk']
const MOODS = ['calm', 'energetic', 'melancholy']
const ARTISTS = ['Miles Davis', 'The Beatles', 'Aphex Twin', 'Nina Simone', 'Bill Evans', 'Radiohead']
const ALBUMS = ['Kind of Blue', 'Revolver', 'Selected Ambient Works', 'Pastel Blues', 'Waltz for Debby']
const CODECS = ['flac', 'mp3', 'opus', 'aac']

/** xorshift32: small, fast, and identical across runs and platforms. */
export function rng(seed: number): () => number {
  let s = seed | 0 || 1
  return () => {
    s ^= s << 13; s |= 0
    s ^= s >>> 17
    s ^= s << 5; s |= 0
    return (s >>> 0) / 4294967296
  }
}

export const FIXED_NOW = 1_750_000_000_000

export function make_corpus(n: number, seed = 42): Corpus {
  const r = rng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
  const maybe = <T>(v: T, p = 0.15): T | null => (r() < p ? null : v)

  const tracks: CorpusTrack[] = []
  for (let i = 1; i <= n; i++) {
    const album_name = maybe(pick(ALBUMS))
    const genre_count = Math.floor(r() * 3)
    const mood_count = Math.floor(r() * 2)

    tracks.push({
      // Zero-padded, so ids sort as the tracks were made and ties in top and bottom stay readable.
      id: `track-${String(i).padStart(5, '0')}`,
      scalars: {
        title: maybe(`Track ${i}`, 0.05),
        album: album_name,
        year: maybe(1950 + Math.floor(r() * 75)),
        track_number: maybe(1 + Math.floor(r() * 20), 0.05),
        disc_number: maybe(1 + Math.floor(r() * 2), 0.4),
        length: maybe(60_000 + Math.floor(r() * 540_000), 0.02),
        // NULL is unrated, which is deliberately not the same as 0.
        rating: r() < 0.3 ? null : Math.floor(r() * 6) * 20,
        play_count: Math.floor(r() * 50),
        skip_count: Math.floor(r() * 10),
        last_played: r() < 0.25 ? null : FIXED_NOW - Math.floor(r() * 400 * 86_400_000),
        added: FIXED_NOW - Math.floor(r() * 900 * 86_400_000),
        bpm: maybe(60 + Math.floor(r() * 140), 0.3),
        compilation: r() < 0.1 ? 1 : 0
      },
      // Most tracks have one file; some have a second copy in another format, and a few have none
      // at all — which the entity model treats as ordinary, not as an error.
      media: (() => {
        const n = r() < 0.05 ? 0 : r() < 0.2 ? 2 : 1
        return Array.from({ length: n }, (_, k) => ({
          uri: `/music/artist/album/${i}-${k}.${pick(CODECS)}`,
          codec: pick(CODECS),
          bitrate: 96 + Math.floor(r() * 1000),
          samplerate: pick([44100, 48000, 96000]),
          channels: pick([1, 2]),
          filesize: 1_000_000 + Math.floor(r() * 60_000_000),
          mtime: FIXED_NOW - Math.floor(r() * 900 * 86_400_000),
          quality_rank: Math.floor(r() * 100)
        }))
      })(),
      sets: {
        1: [pick(ARTISTS)],                                        // artist
        2: r() < 0.7 ? [pick(ARTISTS)] : [],                       // album_artist
        4: Array.from({ length: genre_count }, () => pick(GENRES)) // genre
             .filter((v, j, a) => a.indexOf(v) === j),
        6: Array.from({ length: mood_count }, () => pick(MOODS))    // mood
             .filter((v, j, a) => a.indexOf(v) === j),
        7: r() < 0.2 ? ['essential'] : []                          // tags
      },
      extras: {
        20: r() < 0.3 ? `comment ${i}` : null                      // comment
      },
      album_name
    })
  }

  return { tracks, now: FIXED_NOW }
}
