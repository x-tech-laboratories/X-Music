// @vitest-environment jsdom
// The window's navigation: a sidebar row and a route per view, Settings in the sidebar's foot, and the library's page states.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../../src/renderer/App'
import { view_of } from '../../src/renderer/views/Navigation'
import { library } from '../../src/renderer/stores/library'
import { emit_event, install_bridge } from '../helpers/bridge'

// ============================================================================
// Setup
// ============================================================================

function go_to(hash: string): void {
  window.location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function views_nav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Views' })
}

beforeEach(() => {
  install_bridge()
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  library.stats = null
  library.error = null
})

// ============================================================================
// Routes
// ============================================================================

describe('view_of', () => {
  it('reads the view from the route, the library for an empty or unknown one', () => {
    expect(view_of([])).toBe('library')
    expect(view_of(['folders'])).toBe('folders')
    expect(view_of(['import'])).toBe('import')
    expect(view_of(['duplicates'])).toBe('duplicates')
    expect(view_of(['settings'])).toBe('settings')
    expect(view_of(['nowhere'])).toBe('library')
  })
})

// ============================================================================
// Sidebar
// ============================================================================

describe('navigation', () => {
  it('lists the views in the sidebar, the library current at first', async () => {
    render(<App />)

    const rows = within(views_nav()).getAllByRole('link')
    expect(rows.map((row) => row.textContent)).toEqual(['Library', 'Folders', 'Import', 'Duplicates'])
    expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/library', '#/folders', '#/import', '#/duplicates'])
    expect(rows.every((row) => row.querySelector('svg[aria-hidden="true"]') !== null)).toBe(true)
    expect(within(views_nav()).getByRole('link', { name: 'Library' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeTruthy()
  })

  it('shows each view at its route and marks its row', async () => {
    render(<App />)

    for (const [hash, name] of [['#/folders', 'Folders'], ['#/import', 'Import'], ['#/duplicates', 'Duplicates']]) {
      go_to(hash)
      expect(await screen.findByRole('heading', { level: 1, name })).toBeTruthy()
      expect(within(views_nav()).getByRole('link', { name }).getAttribute('aria-current')).toBe('page')
      expect(within(views_nav()).getByRole('link', { name: 'Library' }).getAttribute('aria-current')).toBeNull()
    }
  })

  it('opens Settings from the last row of the sidebar foot', async () => {
    render(<App />)

    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(settings.getAttribute('href')).toBe('#/settings')
    go_to('#/settings')

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe('page')
    expect(within(views_nav()).queryByRole('link', { current: 'page' })).toBeNull()
  })

  it('falls back to the library for an unknown route', async () => {
    window.location.hash = '#/nowhere'
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeTruthy()
  })

  it('loads the library again when the MCP server changed it', async () => {
    const calls = install_bridge()
    render(<App />)
    await screen.findByText('Your library is empty.')
    const loads = () => calls.filter((call) => call.channel === 'get_library_stats').length
    const before = loads()

    act(() => emit_event('changed', null))

    await waitFor(() => expect(loads()).toBe(before + 1))
  })

  it('puts the cursor in the library\'s search on /', async () => {
    library.stats = { tracks: 1, media: 1, albums: 1, missing: 0, totalMs: 1000, schemaVersion: 1, path: '/tmp/x.db' }
    install_bridge({ get_library_stats: library.stats })
    render(<App />)
    const search = await screen.findByRole('searchbox', { name: 'Search the library' })

    fireEvent.keyDown(document.body, { key: '/' })

    expect(document.activeElement).toBe(search)
  })

  it('shows no placeholder tabs for features still to come', async () => {
    library.stats = { tracks: 1, media: 1, albums: 1, missing: 0, totalMs: 1000, schemaVersion: 1, path: '/tmp/x.db' }
    install_bridge({ 'get_library_stats': library.stats })
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Library' })
    expect(screen.getByRole('button', { name: 'Queue' })).toBeTruthy()
    for (const name of ['Context', 'Playlist', 'Pictures']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})

// ============================================================================
// Library states
// ============================================================================

describe('library view', () => {
  it('points an empty library at Folders and Import', async () => {
    render(<App />)

    expect(await screen.findByText('Your library is empty.')).toBeTruthy()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Folders' }).getAttribute('href')).toBe('#/folders')
    expect(within(main).getByRole('link', { name: 'Import' }).getAttribute('href')).toBe('#/import')
  })

  it('says why the library could not load and loads it again on Retry', async () => {
    let fails = true
    install_bridge({
      'get_library_stats': () => {
        if (fails) throw new Error('database is locked')
        return { tracks: 0, media: 0, albums: 0, missing: 0, totalMs: 0, schemaVersion: 1, path: '/tmp/x.db' }
      }
    })
    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('database is locked')
    fails = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Your library is empty.')).toBeTruthy()
  })
})
