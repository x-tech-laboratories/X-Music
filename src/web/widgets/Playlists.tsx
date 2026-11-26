// Playlists beside the player: each one opens as a filter on the library, and dialogs make, name, fill, import, export and delete them.

import { useState, type FormEvent, type MouseEvent } from 'react'
import { Select } from '@x-tech-laboratories/x-libs/web/react/controls'
import { confirm_dialog, Dialog, open_dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { open_context_menu } from '@x-tech-laboratories/x-libs/web/react/menus'
import { Empty } from '@x-tech-laboratories/x-libs/web/react/states'
import { use_store } from '@x-tech-laboratories/x-libs/web/react/store'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { describe_call_error } from '@x-tech-laboratories/x-libs/web/errors'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { PlaylistRow } from '@shared/ipc'
import { ipc, page_ipc } from '../lib/ipc.ts'
import { browse, library, playlists, type TrackId } from '../stores/library.ts'
import { view_href } from '../views/routes.ts'

// ============================================================================
// Doing
// ============================================================================

// Runs a change, then fetches the library and its playlists again; a failure says so in a toast.
async function change(describe: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    await library.refresh()
    return true
  } catch (error) {
    toast(`Could not ${describe}: ${describe_call_error(error)}`, { tone: 'bad' })
    return false
  }
}

export function open_playlist(playlist_id: string): void {
  if (location.hash !== view_href('library')) location.hash = view_href('library')
  void library.open_playlist(playlist_id)
}

// ============================================================================
// Dialogs
// ============================================================================

// Asks for a name, then runs with it; the dialog stays open if running fails.
function NameDialog({ title, initial, submit, run, on_close }: {
  title: string; initial: string; submit: string; run: (name: string) => Promise<boolean>; on_close: () => void
}) {
  const [name, set_name] = useState(initial)

  async function on_submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (await run(name.trim())) on_close()
  }

  return (
    <Dialog title={title} on_close={on_close} form={{ on_submit: (event) => void on_submit(event), submit_label: submit, submit_disabled: name.trim() === '' }}>
      <label className="field">
        <span>Name</span>
        <input type="text" aria-label="Name" autoFocus value={name} onChange={(event) => set_name(event.currentTarget.value)} />
      </label>
    </Dialog>
  )
}

function ask_name(title: string, initial: string, submit: string, run: (name: string) => Promise<boolean>): void {
  open_dialog((close) => <NameDialog title={title} initial={initial} submit={submit} run={run} on_close={close} />)
}

// A new static playlist, of the tracks given if any.
export function new_playlist(track_ids: readonly TrackId[] = []): void {
  ask_name(track_ids.length > 0 ? `New playlist of ${plural(track_ids.length, 'track')}` : 'New playlist', '', 'Create',
    (name) => change('make the playlist', () => ipc('create_playlist', name, [...track_ids])))
}

// The library as it is narrowed now, kept as a smart playlist.
export function save_view_as_playlist(): void {
  const filter = library.current_filter()
  if (!filter) return
  ask_name('Save this view as a smart playlist', '', 'Save', (name) => change('save the smart playlist', async () => {
    const made = await ipc('create_playlist', name, undefined, filter)
    browse.update((state) => ({ ...state, panes: {}, search: '', playlist: made.id }))
  }))
}

export function rename_playlist(playlist: PlaylistRow): void {
  ask_name(`Rename ${playlist.name}`, playlist.name, 'Rename', (name) => change('rename the playlist', () => ipc('rename_playlist', playlist.id, name)))
}

export function delete_playlist(playlist: PlaylistRow): void {
  confirm_dialog({
    title: `Delete ${playlist.name}?`,
    message: playlist.kind === 'smart' ? 'The saved search is deleted; no track changes.' : 'The playlist is deleted; its tracks stay in the library.',
    confirm_label: 'Delete playlist',
    danger: true,
    run: async () => {
      await ipc('delete_playlist', playlist.id)
      if (browse.get().playlist === playlist.id) browse.update((state) => ({ ...state, playlist: null }))
      await library.refresh()
    }
  })
}

// A playlist file made into a static playlist and opened, saying what the file lists that the library does not hold.
export async function import_playlist_file(): Promise<void> {
  const path = await page_ipc('pick_playlist_file')
  if (!path) return
  try {
    const imported = await page_ipc('import_playlist_file', path)
    await library.refresh()
    open_playlist(imported.playlist.id)
    const missing = imported.missing.length > 0 ? `; ${plural(imported.missing.length, 'listed file')} not in the library` : ''
    toast(`${imported.playlist.name}: ${plural(imported.matched, 'track')} imported${missing}.`, { tone: imported.missing.length > 0 ? 'warn' : 'good' })
  } catch (error) {
    toast(`Could not import the playlist: ${describe_call_error(error)}`, { tone: 'bad' })
  }
}

// Writes the playlist to a file, its format chosen by the extension.
export async function export_playlist(playlist: PlaylistRow): Promise<void> {
  const path = await page_ipc('pick_playlist_save_path', playlist.name)
  if (!path) return
  try {
    const { written, skipped } = await page_ipc('save_playlist_file', playlist.id, path)
    const left_out = skipped > 0 ? `; ${plural(skipped, 'track')} with no file on disk left out` : ''
    toast(`${plural(written, 'track')} written to ${path}${left_out}.`, { tone: skipped > 0 ? 'warn' : 'good' })
  } catch (error) {
    toast(`Could not export the playlist: ${describe_call_error(error)}`, { tone: 'bad' })
  }
}

const NEW = ''

// Puts the tracks at the end of a static playlist, or of a new one.
function AddDialog({ track_ids, on_close }: { track_ids: readonly TrackId[]; on_close: () => void }) {
  const static_lists = use_store(playlists).filter((row) => row.kind === 'static')
  const [chosen, set_chosen] = useState(static_lists[0]?.id ?? NEW)
  const [name, set_name] = useState('')
  const making = chosen === NEW

  async function on_submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const done = await change('add to the playlist', () =>
      making ? ipc('create_playlist', name.trim(), [...track_ids]) : ipc('add_to_playlist', chosen, [...track_ids]))
    if (!done) return
    toast(`${plural(track_ids.length, 'track')} added to ${making ? name.trim() : static_lists.find((row) => row.id === chosen)?.name}.`, { tone: 'good' })
    on_close()
  }

  return (
    <Dialog
      title={`Add ${plural(track_ids.length, 'track')} to a playlist`}
      on_close={on_close}
      form={{ on_submit: (event) => void on_submit(event), submit_label: 'Add', submit_disabled: making && name.trim() === '' }}
    >
      <Select label="Playlist" value={chosen} on_change={set_chosen} options={[...static_lists.map((row): [string, string] => [row.id, row.name]), [NEW, 'New playlist…']]} />
      {making && (
        <label className="field">
          <span>Name</span>
          <input type="text" aria-label="Name" autoFocus value={name} onChange={(event) => set_name(event.currentTarget.value)} />
        </label>
      )}
    </Dialog>
  )
}

export function add_to_playlist(track_ids: readonly TrackId[]): void {
  open_dialog((close) => <AddDialog track_ids={track_ids} on_close={close} />)
}

// Takes the tracks out of the static playlist the library is narrowed to.
export function remove_from_open_playlist(track_ids: readonly TrackId[]): void {
  const playlist_id = browse.get().playlist
  if (playlist_id) void change('take the tracks out of the playlist', () => ipc('remove_from_playlist', playlist_id, [...track_ids]))
}

// The static playlist the library is narrowed to, if any.
export function open_static_playlist(): PlaylistRow | null {
  const playlist = playlists.get().find((row) => row.id === browse.get().playlist)
  return playlist?.kind === 'static' ? playlist : null
}

// ============================================================================
// The tab
// ============================================================================

const fixed = { sortable: false, filterable: false, groupable: false }

const columns: TableColumn<PlaylistRow>[] = [
  { ...fixed, id: 'name', label: 'Name', cell: (row) => row.name },
  { ...fixed, id: 'tracks', label: 'Tracks', cell: (row) => (row.tracks === null ? 'Smart' : row.tracks), class: 'number', width: 64 }
]

function open_menu(row: PlaylistRow, event: MouseEvent): void {
  open_context_menu(event, [
    { label: 'Open', run: () => open_playlist(row.id) },
    { label: 'Rename…', run: () => rename_playlist(row) },
    { label: 'Export…', run: () => void export_playlist(row) },
    { label: 'Delete…', danger: true, separator_before: true, run: () => delete_playlist(row) }
  ])
}

export function PlaylistsTab() {
  const rows = use_store(playlists)
  const state = use_store(browse)
  const narrowed = library.current_filter() !== null && state.playlist === null

  return (
    <div className="scroll-pane">
      <div className="panel-head">
        <span className="muted small">{plural(rows.length, 'playlist')}</span>
        <button type="button" onClick={() => new_playlist()}>New playlist…</button>
        <button type="button" onClick={() => void import_playlist_file()}>Import…</button>
        <button type="button" disabled={!narrowed} title="Keep the library's filters and search as a playlist that follows them" onClick={save_view_as_playlist}>Save view…</button>
      </div>
      {rows.length === 0 ? (
        <Empty title="No playlists yet." hint="Pick tracks and choose Add to playlist, narrow the library and choose Save view, or import an M3U, PLS or XSPF file." />
      ) : (
        <DataTable
          caption="Playlists"
          wrap_class="scroll fit"
          single_line
          columns={columns}
          rows={rows}
          row_key={(row) => row.id}
          column_hiding={false}
          fill_last_column={false}
          row_selected={(row) => row.id === state.playlist}
          on_row_click={(row) => open_playlist(row.id)}
          on_row_context_menu={open_menu}
          on_row_key_down={(row, event) => {
            if (event.key === 'Enter') open_playlist(row.id)
            else if (event.key === 'F2') rename_playlist(row)
            else if (event.key === 'Delete') delete_playlist(row)
          }}
        />
      )}
    </div>
  )
}
