// @vitest-environment jsdom
// A track's properties: its facts, its sources, its raw tags and its plays, each a section of the page, and its history.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Dialogs } from '@x-tech-laboratories/x-libs/web/react/dialog'
import type { DetailMedia, TrackDetails } from '@shared/ipc'
import { SongProperties } from '../src/web/widgets/SongProperties.tsx'
import { record_calls } from './calls.ts'

const media: DetailMedia = {
  id: 'file-1', kind: 'file', uri: '/music/Example Band/First Light/01 Morning Tone.flac', provider: null, present: true, preferred: true,
  codec: 'flac', container: 'flac', bitrate: 900, bitrate_mode: null, samplerate: 44_100, channels: 2, bits_per_sample: 16,
  filesize: 3_200_000, mtime: 1_700_000_000_000, last_seen: 1_700_000_000_000, quality_rank: 90, audio_hash_hex: 'ab'.repeat(16),
  audio_hash_algo: 'flac-streaminfo-md5', subtrack_index: 0, start_ms: null, end_ms: null,
  tags: [{ field: 'ARTIST', value: 'Example Band' }, { field: 'ARTIST', value: 'Guest' }, { field: 'TITLE', value: 'Morning Tone' }]
}

const details: TrackDetails = {
  id: 'track-7', title: 'Morning Tone', album: 'First Light', album_id: 'album-3',
  identity: { source: 'audio_hash', key: 'hash:abab', pinned: false, mb_recording_id: null, acoustid: null },
  fields: [
    { field: 'title', name: 'Title', value: 'Morning Tone', multi: false },
    { field: 'artist', name: 'Artist', value: 'Example Band', multi: true },
    { field: 'length', name: 'Length', value: '30000', multi: false },
    { field: 'comment', name: 'Comment', value: null, multi: false }
  ],
  media: [media],
  statistics: { rating: 80, play_count: 3, skip_count: 0, first_played: null, last_played: null, last_skipped: null, added: 1_700_000_000_000, modified: 0, bookmark_ms: null },
  loudness: { rg_track_gain: null, rg_album_gain: null },
  history: [],
  history_total: 0,
  merges: [{ batch_id: 'batch-1', at: 1_700_000_000_000, absorbed: 2 }]
}

afterEach(cleanup)

describe('song properties', () => {
  it('lays the overview out as facts under section headings', async () => {
    record_calls({ 'get_track': details, 'cache_cover': { url: null, source: 'none' } })

    render(<SongProperties track_id="track-7" on_close={() => undefined} />)

    await screen.findByRole('heading', { level: 2, name: 'All metadata' })
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Morning Tone', 'All metadata', 'Identity', 'Statistics', 'Merge history'])
    expect(screen.getAllByText('0:30').length).toBeGreaterThan(0)
    expect(screen.queryByText('Comment')).toBeNull()
    expect(screen.getByText('1 source · 3 plays')).toBeTruthy()
    expect(screen.getByText('2 tracks')).toBeTruthy()
  })

  it('shows each source with its facts and reveals it in its folder', async () => {
    const calls = record_calls({ 'get_track': details })

    render(<SongProperties track_id="track-7" on_close={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sources (1)' }))

    expect(screen.getByText('44100 Hz')).toBeTruthy()
    expect(screen.getByText('Plays')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    expect(calls.some((call) => call.channel === 'show_in_folder' && call.args[0] === media.uri)).toBe(true)
  })

  it('joins repeated raw tags and says when a track was never played', async () => {
    record_calls({ 'get_track': details })

    render(<SongProperties track_id="track-7" on_close={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Raw tags' }))
    expect(screen.getByText('Example Band, Guest')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Plays and skips' }))
    expect(screen.getByText('Never played')).toBeTruthy()
  })

  it('opens the track\'s history from its History button', async () => {
    record_calls({ 'get_track': details })
    const list_versions = vi.fn(async () => [])
    Object.assign(window, { xMusicHistory: { list_versions } })

    render(<><SongProperties track_id="track-7" on_close={() => undefined} /><Dialogs /></>)
    await screen.findByRole('heading', { level: 2, name: 'All metadata' })
    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    expect(await screen.findByText('No history yet.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'History of Morning Tone' })).toBeTruthy()
    expect(list_versions).toHaveBeenCalledWith('track-7')
  })

  it('says when the track no longer exists, and closes', async () => {
    record_calls({ 'get_track': null })
    const on_close = vi.fn()

    render(<SongProperties track_id="track-7" on_close={on_close} />)

    expect(await screen.findByText('This track no longer exists')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(on_close).toHaveBeenCalled()
  })
})
