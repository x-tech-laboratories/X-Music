import { describe, expect, it } from 'vitest'
import { formatRecord, templateFields } from '@shared/format'

const row = {
  title: 'So What',
  artist: 'Miles Davis',
  album_artist: '',
  album: 'Kind of Blue',
  year: 1959,
  track: 1,
  disc: null,
  length: 562_000,
  rating: 80,
  genre: ['Jazz', 'Modal'],
  path: '/music/miles/kind of blue/01 so what.flac'
}

describe('format strings', () => {
  it('substitutes plain fields', () => {
    expect(formatRecord('{artist} — {title}', row)).toBe('Miles Davis — So What')
  })

  it('falls back to the first non-empty alternative', () => {
    expect(formatRecord('{album_artist|artist}', row)).toBe('Miles Davis')
  })

  it('drops a bracketed group when a field inside it is empty', () => {
    expect(formatRecord('[{disc}.]{track}. {title}', row)).toBe('1. So What')
  })

  it('keeps a bracketed group when every field inside it is present', () => {
    expect(formatRecord('[{year} ]{album}', row)).toBe('1959 Kind of Blue')
  })

  it('applies zero-padding', () => {
    expect(formatRecord('{track:%02d}', row)).toBe('01')
    expect(formatRecord('{year:%04d}', row)).toBe('1959')
  })

  it('formats durations', () => {
    expect(formatRecord('{length:m:ss}', row)).toBe('9:22')
    expect(formatRecord('{length:h:mm:ss}', row)).toBe('0:09:22')
  })

  it('renders ratings as stars', () => {
    expect(formatRecord('{rating:stars}', row)).toBe('★★★★☆')
  })

  it('joins set-valued fields with a chosen separator', () => {
    expect(formatRecord('{genre:join(", ")}', row)).toBe('Jazz, Modal')
    expect(formatRecord('{genre:count}', row)).toBe('2')
  })

  it('applies path transforms', () => {
    expect(formatRecord('{path:basename}', row)).toBe('01 so what.flac')
    expect(formatRecord('{path:ext}', row)).toBe('flac')
  })

  it('supports the renamer pattern end to end', () => {
    const pattern = '{album_artist|artist}/{year} - {album}/[{disc}.]{track:%02d} - {title}'
    expect(formatRecord(pattern, row))
      .toBe('Miles Davis/1959 - Kind of Blue/01 - So What')
  })

  it('escapes braces with a backslash', () => {
    expect(formatRecord('\\{literal\\}', row)).toBe('{literal}')
  })

  it('reports which fields a template needs', () => {
    expect(templateFields('[{disc}.]{track}. {album_artist|artist}').sort())
      .toEqual(['album_artist', 'artist', 'disc', 'track'])
  })
})
