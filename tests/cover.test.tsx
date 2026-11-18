// @vitest-environment jsdom
// A track's cover: held blank while it loads, the picture once found, and the placeholder when there is none.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { TrackCover } from '../src/web/widgets/Cover.tsx'
import { record_calls } from './calls.ts'

afterEach(cleanup)

const name = 'Cover of Morning Tone'

describe('track cover', () => {
  it('holds its place while the art loads, then shows the picture', async () => {
    let answer: (art: { url: string | null; source: string }) => void = () => undefined
    const calls = record_calls({ 'cache_cover': () => new Promise((resolve) => { answer = resolve }) })

    render(<TrackCover track_id="track-7" size="medium" alt={name} />)

    expect(screen.getByRole('img', { name }).getAttribute('aria-busy')).toBe('true')
    answer({ url: 'x-music-art://7', source: 'embedded' })
    await waitFor(() => expect(screen.getByRole('img', { name }).getAttribute('src')).toBe('x-music-art://7'))
    expect(calls.find((call) => call.channel === 'cache_cover')?.args).toEqual(['track-7', 96])
  })

  it('shows the placeholder for a track with no art', async () => {
    record_calls({ 'cache_cover': { url: null, source: 'none' } })

    render(<TrackCover track_id="track-7" size="medium" alt={name} />)

    await waitFor(() => expect(screen.getByRole('img', { name }).getAttribute('aria-busy')).toBeNull())
    expect(screen.getByRole('img', { name }).getAttribute('src')).toBeNull()
  })

  it('shows the placeholder without asking when nothing is playing', () => {
    const calls = record_calls()

    render(<TrackCover track_id={null} size="medium" alt={name} />)

    expect(screen.getByRole('img', { name }).getAttribute('aria-busy')).toBeNull()
    expect(calls.some((call) => call.channel === 'cache_cover')).toBe(false)
  })

  it('stays out of the way of screen readers beside a title that names the track', async () => {
    record_calls({ 'cache_cover': { url: 'x-music-art://7', source: 'embedded' } })

    render(<TrackCover track_id="track-7" size="medium" />)

    await waitFor(() => expect(screen.getByRole('presentation').getAttribute('src')).toBe('x-music-art://7'))
    expect(screen.queryByRole('img')).toBeNull()
  })
})
