// @vitest-environment jsdom
// The player's seek bar on Halon's slider: it carries the seek class and the filled share Chromium draws.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { PlayerStatus } from '@shared/ipc'
import { player } from '../../src/renderer/stores/player'
import { PlayerBlock } from '../../src/renderer/widgets/PlayerBlock'

afterEach(() => {
  cleanup()
  player.status = null
})

describe('player block', () => {
  it('fills the seek bar up to the playing position', () => {
    player.status = { state: 'paused', track: null, media: null, positionMs: 0, durationMs: 200_000, volume: 80, repeat: 'off', shuffle: false, queue: [], contextLength: 0, contextIndex: -1 } satisfies PlayerStatus
    player.positionMs = 50_000

    render(<PlayerBlock />)

    const seek = screen.getByRole('slider', { name: 'Seek' })
    expect(seek.classList.contains('seek')).toBe(true)
    expect(seek.style.getPropertyValue('--range-progress')).toBe('25%')
  })
})
