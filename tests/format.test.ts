import { describe, expect, it } from 'vitest'
import { format_record, template_fields } from '@shared/format'

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
    expect(format_record('{artist} — {title}', row)).toBe('Miles Davis — So What')
  })

  it('falls back to the first non-empty alternative', () => {
    expect(format_record('{album_artist|artist}', row)).toBe('Miles Davis')
  })

  it('drops a bracketed group when a field inside it is empty', () => {
    expect(format_record('[{disc}.]{track}. {title}', row)).toBe('1. So What')
  })

  it('keeps a bracketed group when every field inside it is present', () => {
    expect(format_record('[{year} ]{album}', row)).toBe('1959 Kind of Blue')
  })

  it('applies zero-padding', () => {
    expect(format_record('{track:%02d}', row)).toBe('01')
    expect(format_record('{year:%04d}', row)).toBe('1959')
  })

  it('formats durations', () => {
    expect(format_record('{length:m:ss}', row)).toBe('9:22')
    expect(format_record('{length:h:mm:ss}', row)).toBe('0:09:22')
  })

  it('renders ratings as stars', () => {
    expect(format_record('{rating:stars}', row)).toBe('★★★★☆')
  })

  it('joins set-valued fields with a chosen separator', () => {
    expect(format_record('{genre:join(", ")}', row)).toBe('Jazz, Modal')
    expect(format_record('{genre:count}', row)).toBe('2')
  })

  it('applies path transforms', () => {
    expect(format_record('{path:basename}', row)).toBe('01 so what.flac')
    expect(format_record('{path:ext}', row)).toBe('flac')
  })

  it('supports the renamer pattern end to end', () => {
    const pattern = '{album_artist|artist}/{year} - {album}/[{disc}.]{track:%02d} - {title}'
    expect(format_record(pattern, row))
      .toBe('Miles Davis/1959 - Kind of Blue/01 - So What')
  })

  it('escapes braces with a backslash', () => {
    expect(format_record('\\{literal\\}', row)).toBe('{literal}')
  })

  it('reports which fields a template needs', () => {
    expect(template_fields('[{disc}.]{track}. {album_artist|artist}').sort())
      .toEqual(['album_artist', 'artist', 'disc', 'track'])
  })
})
