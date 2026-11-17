// @vitest-environment jsdom
// A track's properties: its facts, its sources, its raw tags and its history, each a section of the page.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { DetailMedia, TrackDetails } from '@shared/ipc'
import { SongProperties } from '../../src/renderer/widgets/SongProperties'
import { record_calls } from '../helpers/calls'

const media: DetailMedia = {
  id: 'file-1', kind: 'file', uri: '/music/Example Band/First Light/01 Morning Tone.flac', provider: null, present: true, preferred: true,
  codec: 'flac', container: 'flac', bitrate: 900, bitrateMode: null, samplerate: 44_100, channels: 2, bitsPerSample: 16,
  filesize: 3_200_000, mtime: 1_700_000_000_000, lastSeen: 1_700_000_000_000, qualityRank: 90, audioHashHex: 'ab'.repeat(16),
  audioHashAlgo: 'flac-streaminfo-md5', subtrackIndex: 0, startMs: null, endMs: null,
  tags: [{ field: 'ARTIST', value: 'Example Band' }, { field: 'ARTIST', value: 'Guest' }, { field: 'TITLE', value: 'Morning Tone' }]
}

const details: TrackDetails = {
  id: 'track-7', title: 'Morning Tone', album: 'First Light', albumId: 'album-3',
  identity: { source: 'audio_hash', key: 'hash:abab', pinned: false, mbRecordingId: null, acoustid: null },
  fields: [
    { field: 'title', name: 'Title', value: 'Morning Tone', multi: false },
    { field: 'artist', name: 'Artist', value: 'Example Band', multi: true },
    { field: 'length', name: 'Length', value: '30000', multi: false },
    { field: 'comment', name: 'Comment', value: null, multi: false }
  ],
  media: [media],
  statistics: { rating: 80, playCount: 3, skipCount: 0, firstPlayed: null, lastPlayed: null, lastSkipped: null, added: 1_700_000_000_000, modified: 0, bookmarkMs: null },
  loudness: { rgTrackGain: null, rgAlbumGain: null },
  history: [],
  historyTotal: 0,
  merges: [{ batchId: 'batch-1', at: 1_700_000_000_000, absorbed: 2 }]
}

afterEach(cleanup)

describe('song properties', () => {
  it('lays the overview out as facts under section headings', async () => {
    record_calls({ 'get_track': details, 'get_cover_url': { url: null, source: 'none' } })

    render(<SongProperties trackId="track-7" onclose={() => undefined} />)

    await screen.findByRole('heading', { level: 2, name: 'All metadata' })
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Morning Tone', 'All metadata', 'Identity', 'Statistics', 'Merge history'])
    expect(screen.getAllByText('0:30').length).toBeGreaterThan(0)
    expect(screen.queryByText('Comment')).toBeNull()
    expect(screen.getByText('1 source · 3 plays')).toBeTruthy()
    expect(screen.getByText('2 tracks')).toBeTruthy()
  })

  it('shows each source with its facts and reveals it in its folder', async () => {
    const calls = record_calls({ 'get_track': details })

    render(<SongProperties trackId="track-7" onclose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sources (1)' }))

    expect(screen.getByText('44100 Hz')).toBeTruthy()
    expect(screen.getByText('Plays')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    expect(calls.some((call) => call.channel === 'show_in_folder' && call.args[0] === media.uri)).toBe(true)
  })

  it('joins repeated raw tags and says when a track was never played', async () => {
    record_calls({ 'get_track': details })

    render(<SongProperties trackId="track-7" onclose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Raw tags' }))
    expect(screen.getByText('Example Band, Guest')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.getByText('Never played')).toBeTruthy()
  })

  it('says when the track no longer exists, and closes', async () => {
    record_calls({ 'get_track': null })
    const onclose = vi.fn()

    render(<SongProperties trackId="track-7" onclose={onclose} />)

    expect(await screen.findByText('This track no longer exists')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(onclose).toHaveBeenCalled()
  })
})
