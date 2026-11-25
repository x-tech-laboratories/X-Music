// @vitest-environment jsdom
// The Playlists tab and the playlist actions of the song list: opening a playlist as a chip, making, renaming, filling and
// deleting playlists, and saving the view as a smart playlist.

import '@x-tech-laboratories/x-libs/web/react/test_stubs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Dialogs } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { ContextMenus } from '@x-tech-laboratories/x-libs/web/react/menus'
import { Toasts } from '@x-tech-laboratories/x-libs/web/react/toasts'
import type { PlaylistRow, TrackRow } from '@shared/ipc'
import { browse, chips_of, library, playlists, results } from '../src/web/stores/library.ts'
import { PlaylistsTab } from '../src/web/widgets/Playlists.tsx'
import { SongList } from '../src/web/widgets/SongList.tsx'
import { empty_stats, install_bridge, type Call } from './bridge.ts'

// ============================================================================
// Setup
// ============================================================================

const mix: PlaylistRow = { id: 'mix', name: 'Late night', kind: 'static', tracks: 2, filter: null }
const loved: PlaylistRow = { id: 'loved', name: 'Loved', kind: 'smart', tracks: null, filter: { field: 'rating', op: '>=', value: 80 } }

const rows: TrackRow[] = [1, 2].map((number) => ({
  id: `track-${number}`, title: `Track ${number}`, artist: 'A', album: 'B', year: 2000,
  track_number: number, length_ms: 61_000, rating: null, play_count: 0
}))

let calls: Call[]

beforeEach(() => {
  calls = install_bridge({
    list_playlists: [mix, loved],
    list_tracks: rows,
    get_library_stats: { ...empty_stats, tracks: 2 },
    create_playlist: (name: string) => ({ id: 'made', name, kind: 'static', tracks: 0, filter: null }),
    add_to_playlist: () => ({ tracks: 3 }),
    remove_from_playlist: () => ({ tracks: 1 }),
    delete_playlist: () => [loved],
    rename_playlist: () => [mix, loved]
  })
  browse.set({ sort: [], panes: {}, search: '', playlist: null })
  playlists.set([mix, loved])
  results.set({ stats: { ...empty_stats, tracks: 2 }, tracks: rows, order: rows.map((row) => row.id), error: null })
  library.clear_selection()
  history.replaceState(null, '', '#/library')
})

afterEach(cleanup)

const made = (channel: string) => calls.filter((call) => call.channel === channel).map((call) => call.args)

// ============================================================================
// The tab
// ============================================================================

describe('the playlists tab', () => {
  it('lists the playlists and opens one as a chip on the library, leaving no other filter', async () => {
    browse.set({ sort: [], panes: { genre: ['Jazz'] }, search: 'blue', playlist: null })
    render(<PlaylistsTab />)

    expect(screen.getByText('Smart')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('Late night')) })

    expect(browse.get()).toMatchObject({ playlist: 'mix', panes: {}, search: '' })
    expect(chips_of(browse.get())).toEqual([{ id: 'playlist', label: 'Playlist: Late night' }])
    expect(made('list_tracks').at(-1)![0]).toEqual({ field: 'title', op: 'in_playlist', value: 'mix' })
  })

  it('browses a smart playlist as the filter it keeps, and its chip takes it away', async () => {
    render(<PlaylistsTab />)
    await act(async () => { fireEvent.click(screen.getByText('Loved')) })

    expect(made('list_tracks').at(-1)![0]).toEqual({ field: 'rating', op: '>=', value: 80 })
    await act(async () => { await library.remove_chip('playlist') })
    expect(browse.get().playlist).toBeNull()
  })

  it('makes a new playlist by name', async () => {
    render(<><PlaylistsTab /><Dialogs /></>)

    fireEvent.click(screen.getByRole('button', { name: 'New playlist…' }))
    const dialog = screen.getByRole('dialog', { name: 'New playlist' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: ' Road trip ' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create' })) })

    expect(made('create_playlist')).toEqual([['Road trip', []]])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('saves the narrowed view as a smart playlist and opens it', async () => {
    browse.set({ sort: [], panes: {}, search: 'rating:>=4', playlist: null })
    calls = install_bridge({ list_playlists: [mix, loved], create_playlist: (name: string, _ids: unknown, filter: unknown) => ({ id: 'saved', name, kind: 'smart', tracks: null, filter }) })
    render(<><PlaylistsTab /><Dialogs /></>)

    fireEvent.click(screen.getByRole('button', { name: 'Save view…' }))
    const dialog = screen.getByRole('dialog', { name: 'Save this view as a smart playlist' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Favourites' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })) })

    expect(made('create_playlist')).toEqual([['Favourites', undefined, { field: 'rating', op: '>=', value: 80 }]])
    expect(browse.get()).toMatchObject({ playlist: 'saved', search: '' })
  })

  it('cannot save a view that nothing narrows', () => {
    render(<PlaylistsTab />)

    expect((screen.getByRole('button', { name: 'Save view…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renames and deletes a playlist from its menu, deleting only once confirmed', async () => {
    browse.set({ sort: [], panes: {}, search: '', playlist: 'mix' })
    render(<><PlaylistsTab /><ContextMenus /><Dialogs /></>)

    fireEvent.contextMenu(screen.getByText('Late night'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    const rename = screen.getByRole('dialog', { name: 'Rename Late night' })
    fireEvent.change(within(rename).getByRole('textbox', { name: 'Name' }), { target: { value: 'Night' } })
    await act(async () => { fireEvent.click(within(rename).getByRole('button', { name: 'Rename' })) })
    expect(made('rename_playlist')).toEqual([['mix', 'Night']])

    fireEvent.contextMenu(screen.getByText('Late night'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
    expect(made('delete_playlist')).toEqual([])
    const confirm = screen.getByRole('dialog', { name: 'Delete Late night?' })
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Delete playlist' })) })

    expect(made('delete_playlist')).toEqual([['mix']])
    expect(browse.get().playlist).toBeNull()
  })

  it('says so when there are no playlists', () => {
    playlists.set([])
    render(<PlaylistsTab />)

    expect(screen.getByText('No playlists yet.')).toBeTruthy()
  })
})

// ============================================================================
// The song list
// ============================================================================

describe('playlists from the song list', () => {
  it('adds the picked tracks to a playlist chosen in a dialog, or to a new one', async () => {
    render(<><SongList /><Dialogs /><Toasts /></>)
    fireEvent.click(screen.getByText('Track 1').closest('tr')!)
    fireEvent.click(screen.getByText('Track 2').closest('tr')!, { ctrlKey: true })

    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selected rows' })).getByRole('button', { name: 'Add to playlist…' }))
    let dialog = screen.getByRole('dialog', { name: 'Add 2 tracks to a playlist' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Add' })) })
    expect(made('add_to_playlist')).toEqual([['mix', ['track-1', 'track-2']]])
    expect(await screen.findByText('2 tracks added to Late night.')).toBeTruthy()

    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selected rows' })).getByRole('button', { name: 'Add to playlist…' }))
    dialog = screen.getByRole('dialog', { name: 'Add 2 tracks to a playlist' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Playlist' }), { target: { value: '' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Fresh' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Add' })) })
    expect(made('create_playlist')).toEqual([['Fresh', ['track-1', 'track-2']]])
  })

  it('takes tracks out of the static playlist the library shows', async () => {
    browse.set({ sort: [], panes: {}, search: '', playlist: 'mix' })
    render(<><SongList /><ContextMenus /></>)

    fireEvent.contextMenu(screen.getByText('Track 2').closest('tr')!)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Late night' })) })

    expect(made('remove_from_playlist')).toEqual([['mix', ['track-2']]])
  })

  it('offers no removal outside a static playlist', () => {
    render(<><SongList /><ContextMenus /></>)

    fireEvent.contextMenu(screen.getByText('Track 2').closest('tr')!)

    expect(screen.queryByRole('menuitem', { name: /^Remove from/ })).toBeNull()
  })
})
