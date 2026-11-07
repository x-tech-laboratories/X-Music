// @vitest-environment jsdom
// The theme choice lives in X-Music's prefs under the key it has always used.

import { beforeEach, describe, expect, it } from 'vitest'
import { theme } from '../../src/renderer/lib/theme'

beforeEach(() => localStorage.clear())

describe('theme choice', () => {
  it('reads a theme saved by earlier versions', () => {
    localStorage.setItem('x-music.pref.theme', JSON.stringify('dark'))

    expect(theme.get()).toBe('dark')
  })

  it('keeps a chosen theme as a pref and sets it on the page', () => {
    theme.set('light')

    expect(localStorage.getItem('x-music.pref.theme')).toBe(JSON.stringify('light'))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('reads a corrupt value as the system theme', () => {
    localStorage.setItem('x-music.pref.theme', 'not json')

    expect(theme.get()).toBe('system')
  })
})
