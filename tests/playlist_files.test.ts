// Playlist files: what M3U, PLS and XSPF list, read as paths on this computer, and written back so they read the same.

import { describe, expect, it } from 'vitest'

import {
  name_from_path, playlist_format, read_playlist_file, resolve_entry, write_playlist_file, type PlaylistEntry, type PlaylistFormat
} from '@shared/import/playlist_files'

// ============================================================================
// Paths
// ============================================================================

describe('playlist entries as paths', () => {
  it('joins relative entries to the playlist\'s folder, stepping up for ..', () => {
    expect(resolve_entry('Album/01 So What.flac', '/music/lists/jazz.m3u')).toBe('/music/lists/Album/01 So What.flac')
    expect(resolve_entry('../Album/01.flac', '/music/lists/jazz.m3u')).toBe('/music/Album/01.flac')
    expect(resolve_entry('./01.flac', '/music/jazz.m3u')).toBe('/music/01.flac')
  })

  it('decodes file URLs and keeps absolute paths and other URLs', () => {
    expect(resolve_entry('file:///music/So%20What.flac', '/x.m3u')).toBe('/music/So What.flac')
    expect(resolve_entry('file://localhost/music/a.flac', '/x.m3u')).toBe('/music/a.flac')
    expect(resolve_entry('file:///C:/Music/a.flac', '/x.m3u')).toBe('C:/Music/a.flac')
    expect(resolve_entry('/music/a.flac', '/x.m3u')).toBe('/music/a.flac')
    expect(resolve_entry('C:\\Music\\a.flac', '/x.m3u')).toBe('C:\\Music\\a.flac')
    expect(resolve_entry('https://radio.example/stream', '/x.m3u')).toBe('https://radio.example/stream')
  })

  it('joins with backslashes beside a Windows playlist', () => {
    expect(resolve_entry('Album\\01.flac', 'C:\\Music\\jazz.m3u')).toBe('C:\\Music\\Album\\01.flac')
  })

  it('knows the format by extension, and names a playlist after its file', () => {
    expect(['a.m3u', 'a.M3U8', 'a.pls', 'a.xspf', 'a.txt', 'noext'].map(playlist_format)).toEqual(['m3u', 'm3u', 'pls', 'xspf', null, null])
    expect(name_from_path('/music/lists/Late night.m3u8')).toBe('Late night')
  })
})

// ============================================================================
// Reading
// ============================================================================

describe('reading playlist files', () => {
  it('reads an extended M3U with a byte-order mark, comments and blank lines', () => {
    const text = '\uFEFF#EXTM3U\r\n#PLAYLIST:Late night\r\n#EXTINF:545,Miles Davis - So What\r\nAlbum/01.flac\r\n\r\n# a note\r\n/music/02.flac\r\n'

    expect(read_playlist_file(text, '/music/late.m3u8')).toEqual({ name: 'Late night', entries: ['/music/Album/01.flac', '/music/02.flac'] })
  })

  it('reads a PLS in the order of its numbers, whatever order the lines come in', () => {
    const text = '[playlist]\nFile2=/music/b.flac\nTitle2=B\nFile1=a.flac\nfile10=/music/j.flac\nNumberOfEntries=3\nVersion=2\n'

    expect(read_playlist_file(text, '/music/x.pls')).toEqual({ name: null, entries: ['/music/a.flac', '/music/b.flac', '/music/j.flac'] })
  })

  it('reads an XSPF\'s title and each track\'s first location, skipping tracks with none', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>Road &amp; rail</title>
  <trackList>
    <track><location>file:///music/So%20What.flac</location><location>file:///backup/a.flac</location></track>
    <track><title>No file</title></track>
    <track><location>02.flac</location></track>
  </trackList>
</playlist>`

    expect(read_playlist_file(text, '/music/x.xspf')).toEqual({ name: 'Road & rail', entries: ['/music/So What.flac', '/music/02.flac'] })
  })

  it('reads an XSPF with a single track and with none', () => {
    const one = '<playlist><trackList><track><location>/music/a.flac</location></track></trackList></playlist>'
    const none = '<playlist><trackList/></playlist>'

    expect(read_playlist_file(one, '/x.xspf').entries).toEqual(['/music/a.flac'])
    expect(read_playlist_file(none, '/x.xspf').entries).toEqual([])
  })

  it('refuses a file that is not a playlist', () => {
    expect(() => read_playlist_file('<html/>', '/x.xspf')).toThrow(/not an XSPF playlist/)
    expect(() => read_playlist_file('a', '/x.txt')).toThrow(/ends in \.m3u/)
  })
})

// ============================================================================
// Writing
// ============================================================================

const entries: PlaylistEntry[] = [
  { path: '/music/Kind of Blue/01 So What.flac', title: 'So What', artist: 'Miles Davis', length_ms: 545_400 },
  { path: '/music/Café & Bar/02 <B>.mp3', title: 'Blue\nin Green', artist: null, length_ms: null }
]

describe('writing playlist files', () => {
  it.each<PlaylistFormat>(['m3u', 'pls', 'xspf'])('writes %s that reads back to the same paths, in order', (format) => {
    const written = write_playlist_file(format, 'Late & night', entries)

    expect(read_playlist_file(written, `/elsewhere/list.${format}`).entries).toEqual(entries.map((entry) => entry.path))
  })

  it('writes an extended M3U with names and lengths on one line each', () => {
    expect(write_playlist_file('m3u', 'Late night', entries)).toBe(
      '#EXTM3U\n#PLAYLIST:Late night\n#EXTINF:545,Miles Davis - So What\n/music/Kind of Blue/01 So What.flac\n' +
      '#EXTINF:-1,Blue in Green\n/music/Café & Bar/02 <B>.mp3\n'
    )
  })

  it('writes a PLS with its count and version', () => {
    const written = write_playlist_file('pls', 'x', entries)

    expect(written).toContain('File1=/music/Kind of Blue/01 So What.flac\nTitle1=Miles Davis - So What\nLength1=545\n')
    expect(written).toContain('NumberOfEntries=2\nVersion=2\n')
  })

  it('writes an XSPF with escaped text, file URLs and the title read back', () => {
    const written = write_playlist_file('xspf', 'Late & night', entries)

    expect(written).toContain('<location>file:///music/Kind%20of%20Blue/01%20So%20What.flac</location>')
    expect(written).toContain('<creator>Miles Davis</creator>')
    expect(read_playlist_file(written, '/x.xspf').name).toBe('Late & night')
  })
})
