// Finding mpv goes through X-Libs' on_path, so a file that is there but cannot run is passed over.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findMpv } from '@main/play/mpv'

let dir: string

function program(folder: string, runnable: boolean): string {
  mkdirSync(join(dir, folder), { recursive: true })
  const path = join(dir, folder, 'mpv')
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, runnable ? 0o755 : 0o644)
  return path
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'x-music-mpv-')) })
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('finding mpv', () => {
  it('takes the first mpv on the PATH that can run', async () => {
    program('broken', false)
    const good = program('good', true)
    vi.stubEnv('PATH', `${join(dir, 'broken')}:${join(dir, 'good')}`)
    vi.stubEnv('X_MUSIC_MPV', '')

    expect(await findMpv()).toBe(good)
  })

  it('prefers an explicit path, then X_MUSIC_MPV, over the PATH', async () => {
    const on_path = program('path', true)
    const configured = program('configured', true)
    const explicit = program('explicit', true)
    vi.stubEnv('PATH', join(dir, 'path'))
    vi.stubEnv('X_MUSIC_MPV', configured)

    expect(await findMpv(explicit)).toBe(explicit)
    expect(await findMpv()).toBe(configured)
    vi.stubEnv('X_MUSIC_MPV', join(dir, 'missing', 'mpv'))
    expect(await findMpv()).toBe(on_path)
  })

  it('finds nothing when no mpv can run', async () => {
    program('broken', false)
    vi.stubEnv('PATH', join(dir, 'broken'))
    vi.stubEnv('X_MUSIC_MPV', '')

    expect(await findMpv()).toBeNull()
  })
})
