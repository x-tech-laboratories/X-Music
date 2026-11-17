// @vitest-environment jsdom
// The player: its transport as labelled icon buttons, shuffle and repeat as pressed toggles, the seek bar, and a failure the listener can read and retry.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Toasts } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { PlayerStatus } from '@shared/ipc'
import { player, player_position, player_status } from '../../src/renderer/stores/player'
import { PlayerBlock } from '../../src/renderer/widgets/PlayerBlock'
import { record_calls } from '../helpers/calls'

const idle: PlayerStatus = {
  state: 'paused', track: null, media: null, positionMs: 0, durationMs: 200_000, volume: 80,
  repeat: 'off', shuffle: false, queue: [], contextLength: 0, contextIndex: -1
}

const track = { id: 'track-7', title: 'Morning Tone', artist: 'Example Band', album: 'First Light', lengthMs: 30_000, rating: null }

afterEach(() => {
  cleanup()
  player_status.set(null)
  player_position.set(0)
})

describe('player block', () => {
  it('fills the seek bar up to the playing position', () => {
    record_calls()
    player_status.set({ ...idle, track })
    player_position.set(50_000)

    render(<PlayerBlock />)

    const seek = screen.getByRole('slider', { name: 'Seek' })
    expect(seek.classList.contains('seek')).toBe(true)
    expect(seek.style.getPropertyValue('--range-progress')).toBe('25%')
  })

  it('draws the transport as labelled icon buttons with no emoji', () => {
    record_calls()
    player_status.set({ ...idle, state: 'playing', track })

    render(<PlayerBlock />)

    for (const name of ['Previous', 'Stop', 'Pause', 'Next', 'Shuffle', 'Repeat']) {
      const button = screen.getByRole('button', { name })
      expect(button.querySelector('svg.line-icon')).not.toBeNull()
      expect(button.textContent).toBe('')
    }
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
  })

  it('shows shuffle and repeat as pressed toggles and cycles repeat', async () => {
    const calls = record_calls({ 'set_repeat': (mode: unknown) => ({ ...idle, repeat: mode }) })
    player_status.set({ ...idle, shuffle: true, repeat: 'all' })

    render(<PlayerBlock />)

    expect(screen.getByRole('button', { name: 'Shuffle' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Repeat all' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Repeat this track' }).getAttribute('aria-pressed')).toBe('true'))
    expect(calls.find((call) => call.channel === 'set_repeat')?.args).toEqual(['one'])
  })

  it('shows a failed start as an alert with Try again, which plays again', async () => {
    const calls = record_calls({ 'toggle_playback': { ...idle, state: 'playing', track } })
    player_status.set({ ...idle, state: 'error', track, error: 'mpv did not answer within 10 seconds' })

    render(<PlayerBlock />)

    expect(screen.getByRole('alert').textContent).toContain('mpv did not answer within 10 seconds')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(calls.some((call) => call.channel === 'toggle_playback')).toBe(true)
  })

  it('says so in a toast when a call fails, with no unhandled rejection', async () => {
    record_calls({ 'play_next': () => { throw new Error("Error invoking remote method 'play_next': Error: the player is gone") } })
    player_status.set(idle)

    render(<><PlayerBlock /><Toasts /></>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Playback failed: the player is gone'))
  })

  it('shows no length or rating when nothing is playing', () => {
    record_calls()
    player_status.set(idle)

    render(<PlayerBlock />)

    expect(screen.getByRole('slider', { name: 'Seek' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByText('0:00')).toHaveLength(2)
    expect(screen.getByText('Nothing playing')).toBeTruthy()
  })

  it('keeps the store readable through the player module', () => {
    player_status.set({ ...idle, state: 'playing', track })

    expect(player.playing).toBe(true)
    expect(player.currentId).toBe('track-7')
  })
})
