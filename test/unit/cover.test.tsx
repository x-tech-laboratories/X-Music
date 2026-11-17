// @vitest-environment jsdom
// A track's cover: held blank while it loads, the picture once found, and the placeholder when there is none.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { TrackCover } from '../../src/renderer/widgets/Cover'
import { record_calls } from '../helpers/calls'

afterEach(cleanup)

describe('track cover', () => {
  it('holds its place while the art loads, then shows the picture', async () => {
    let answer: (art: { url: string | null; source: string }) => void = () => undefined
    const calls = record_calls({ 'art:forTrack': () => new Promise((resolve) => { answer = resolve }) })

    const { container } = render(<TrackCover track_id="track-7" size={88} />)

    const cover = container.querySelector('.cover')!
    expect(cover.getAttribute('aria-busy')).toBe('true')
    expect(cover.querySelector('svg')).toBeNull()
    answer({ url: 'x-music-art://7', source: 'embedded' })
    await waitFor(() => expect(cover.querySelector('img')?.getAttribute('src')).toBe('x-music-art://7'))
    expect(calls.find((call) => call.channel === 'art:forTrack')?.args).toEqual([{ trackId: 'track-7', size: 88 }])
  })

  it('shows the music placeholder for a track with no art', async () => {
    record_calls({ 'art:forTrack': { url: null, source: 'none' } })

    const { container } = render(<TrackCover track_id="track-7" size={88} />)

    await waitFor(() => expect(container.querySelector('.cover svg.line-icon')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the placeholder without asking when nothing is playing', () => {
    const calls = record_calls()

    const { container } = render(<TrackCover track_id={null} size={88} />)

    expect(container.querySelector('.cover svg.line-icon')).not.toBeNull()
    expect(calls.some((call) => call.channel === 'art:forTrack')).toBe(false)
  })
})
