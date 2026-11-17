// History: the latest changes to every track and every merge on a page of their own, and one track's versions in a
// dialog opened from the track, each version restorable and each merge undoable.

import { useState, type ReactNode } from 'react'
import { StateBadge, type Tone } from '@x-tech-laboratories/x-libs/web/react/badges'
import { Segmented, Select } from '@x-tech-laboratories/x-libs/web/react/controls'
import { confirm_dialog, Dialog, open_dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { PageHeading, Toolbar } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Empty, Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { clean_error_message } from '@x-tech-laboratories/x-libs/electron/bridge'
import { describe_error } from '@x-tech-laboratories/x-libs/web/errors'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { MergeEntry, TrackSnapshot, TrackState, Version, VersionKind } from '@shared/ipc'
import { BUILTIN_FIELDS, ratingToStars } from '@shared/fields'
import { library } from '../stores/library.ts'
import { undo_merge } from '../widgets/MergeView.tsx'

type TrackVersion = Version<TrackSnapshot>

// ============================================================================
// Wording
// ============================================================================

const version_labels: Record<VersionKind, [text: string, tone: Tone]> = {
  first_seen: ['Already here', 'none'],
  created: ['Added', 'good'],
  edited: ['Edited', 'info'],
  deleted: ['Removed', 'bad'],
  restored: ['Restored', 'warn']
}

const merge_labels: Record<'merged' | 'undone', [text: string, tone: Tone]> = {
  merged: ['Merged', 'info'],
  undone: ['Merge undone', 'none']
}

const when = (milliseconds: number): string => new Date(milliseconds).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const failure = (error: unknown): string => clean_error_message(describe_error(error))

const ARTIST_FIELD = BUILTIN_FIELDS.find((field) => field.id === 'artist')!.fieldId!

const field_names = new Map(BUILTIN_FIELDS.filter((field) => field.fieldId !== undefined).map((field) => [field.fieldId!, field.name]))

export function track_name(snapshot: TrackSnapshot): string {
  return snapshot.track.title ?? 'Untitled track'
}

function artists(snapshot: TrackSnapshot): string {
  return snapshot.values.filter((value) => value.field_id === ARTIST_FIELD).map((value) => value.value).join(', ')
}

// ============================================================================
// What changed
// ============================================================================

export interface FieldChange {
  field: string
  before: string
  after: string
}

const yes_no = (value: unknown): string => (value ? 'Yes' : 'No')

// The track's own columns a person would recognise, each with how its value reads; the rest change only alongside these.
const shown_columns: [column: keyof TrackState, name: string, text: (value: never) => string][] = [
  ['title', 'Title', (value: string | null) => value ?? ''],
  ['album', 'Album', (value: string | null) => value ?? ''],
  ['year', 'Year', (value: number | null) => (value === null ? '' : String(value))],
  ['track_number', 'Track number', (value: number | null) => (value === null ? '' : String(value))],
  ['disc_number', 'Disc number', (value: number | null) => (value === null ? '' : String(value))],
  ['length_ms', 'Length', (value: number | null) => format_clock(value, '')],
  ['rating', 'Rating', (value: number | null) => (value === null ? '' : plural(ratingToStars(value)!, 'star'))],
  ['loved', 'Loved', yes_no],
  ['compilation', 'Compilation', yes_no],
  ['bpm', 'BPM', (value: number | null) => (value === null ? '' : String(value))],
  ['pinned', 'Pinned', yes_no],
  ['mb_recording_id', 'MusicBrainz recording', (value: string | null) => value ?? ''],
  ['acoustid', 'AcoustID', (value: string | null) => value ?? ''],
  ['rg_track_gain', 'Track gain', (value: number | null) => (value === null ? '' : `${value} dB`)],
  ['rg_album_gain', 'Album gain', (value: number | null) => (value === null ? '' : `${value} dB`)],
  ['added', 'Added', (value: number) => when(value)]
]

function set_values(snapshot: TrackSnapshot, field_id: number): string {
  return snapshot.values.filter((value) => value.field_id === field_id).map((value) => value.value).join(', ')
}

function extra_value(snapshot: TrackSnapshot, field_id: number): string {
  return snapshot.extras.find((extra) => extra.field_id === field_id)?.value ?? ''
}

// Each field a version changed, with how it read before and after, in the order the track's properties show them.
export function changes_between(previous: TrackSnapshot, current: TrackSnapshot): FieldChange[] {
  const changes: FieldChange[] = []
  const add = (field: string, before: string, after: string): void => {
    if (before !== after) changes.push({ field, before, after })
  }

  for (const [column, name, text] of shown_columns) {
    const read = text as (value: unknown) => string
    add(name, read(previous.track[column]), read(current.track[column]))
  }
  const set_fields = new Set([...previous.values, ...current.values].map((value) => value.field_id))
  for (const field_id of [...set_fields].sort((first, second) => first - second)) {
    add(field_names.get(field_id) ?? `Field ${field_id}`, set_values(previous, field_id), set_values(current, field_id))
  }
  const extra_fields = new Set([...previous.extras, ...current.extras].map((extra) => extra.field_id))
  for (const field_id of [...extra_fields].sort((first, second) => first - second)) {
    add(field_names.get(field_id) ?? `Field ${field_id}`, extra_value(previous, field_id), extra_value(current, field_id))
  }
  add('Files', plural(previous.media.length, 'file'), plural(current.media.length, 'file'))
  return changes
}

const whole_changes: Partial<Record<VersionKind, string>> = {
  first_seen: 'In the library when history began.',
  created: 'Added to the library.',
  deleted: 'Taken out of the library, such as by a merge.'
}

// What a version did, a line per field changed, with at most `limit` lines and a count of the rest.
function VersionChanges({ version, limit }: { version: TrackVersion; limit?: number }) {
  const whole = whole_changes[version.kind]
  if (whole !== undefined || version.previous === null) return <span className="muted">{whole ?? 'Added to the library.'}</span>

  const changes = changes_between(version.previous, version.snapshot)
  if (changes.length === 0) return <span className="muted">{version.kind === 'restored' ? 'Back as it was.' : 'Nothing you would see changed.'}</span>
  const shown = limit === undefined ? changes : changes.slice(0, limit)
  return (
    <div>
      {shown.map((change) => (
        <div key={change.field}>
          <strong>{change.field}</strong> <span className="muted">{change.before || 'none'}</span> → {change.after || 'none'}
        </div>
      ))}
      {shown.length < changes.length && <div className="muted small">and {plural(changes.length - shown.length, 'more change')}</div>}
    </div>
  )
}

function TrackCell({ snapshot }: { snapshot: TrackSnapshot }) {
  const by = artists(snapshot)
  return <span>{track_name(snapshot)}{by && <> <span className="muted small">{by}</span></>}</span>
}

// ============================================================================
// Restoring
// ============================================================================

const history = () => window.xMusicHistory

// Brings a version back after a confirm, since the track's current state becomes a version of its own.
function restore(version: TrackVersion, on_done: () => void): void {
  const name = track_name(version.snapshot)
  const deleted = version.kind === 'deleted'
  confirm_dialog({
    title: deleted ? `Bring back ${name}?` : `Restore ${name}?`,
    message: deleted
      ? 'It comes back as it was when taken out, with the files it still has. Its plays stay where they are; Undo on the merge brings those back too.'
      : `It goes back to how it was on ${when(Date.parse(version.changed_at))}; the way it is now stays in its history. Play counts are left as they are.`,
    confirm_label: deleted ? 'Bring back' : 'Restore',
    busy_label: 'Restoring…',
    run: async () => {
      try {
        await history().restore_version(version.id)
        await library.refresh()
        toast(`${name} is back as it was`, { tone: 'good' })
        on_done()
      } catch (error) {
        toast(`Could not restore ${name}: ${failure(error)}`, { tone: 'bad' })
      }
    }
  })
}

function undo(merge: MergeEntry, on_done: () => void): void {
  const name = merge.survivor_title ?? 'the track'
  confirm_dialog({
    title: `Undo the merge into ${name}?`,
    message: `${plural(merge.absorbed.length, 'track')} come back as they were before the merge, with their files, plays and playlist places. ${name} goes back to how it was too.`,
    confirm_label: 'Undo merge',
    busy_label: 'Undoing…',
    run: () => undo_merge(merge.batch_id, on_done)
  })
}

// ============================================================================
// One track
// ============================================================================

function TrackHistoryDialog({ track_id, name, on_close, on_changed }: { track_id: string; name: string; on_close: () => void; on_changed?: () => void }) {
  const versions = use_resource(() => history().list_versions(track_id), [track_id])
  // The newest version is how the track is now, so only the ones before it are offered, or bringing it back once removed.
  const newest = versions.data?.[0]
  const restored = (): void => {
    on_close()
    on_changed?.()
  }
  const action = (version: TrackVersion): ReactNode => {
    if (version === newest) return version.kind === 'deleted' ? <button onClick={() => restore(version, restored)}>Bring back</button> : null
    return version.kind === 'deleted' ? null : <button onClick={() => restore(version, restored)}>Restore</button>
  }
  const columns: TableColumn<TrackVersion>[] = [
    { label: 'When', cell: (version) => when(Date.parse(version.changed_at)), sort: (version) => version.changed_at },
    { label: 'Change', cell: (version) => <StateBadge labels={version_labels} state={version.kind} />, text: (version) => version_labels[version.kind][0] },
    { label: 'What changed', cell: (version) => <VersionChanges version={version} />, sortable: false },
    { label: 'Actions', id: 'actions', header: <span className="visually-hidden">Actions</span>, class: 'actions-cell', cell: (version) => <div className="row-actions">{action(version)}</div>, sortable: false, hideable: false }
  ]

  return (
    <Dialog title={`History of ${name}`} subtitle="Every change to this track, newest first. Plays and skips are counted, not kept as changes." on_close={on_close} wide>
      <Loaded resource={versions}>
        {(list) => (list.length === 0
          ? <Empty title="No history yet." />
          : <DataTable caption={`History of ${name}`} columns={columns} rows={list} row_key={(version) => version.id} manual_sorting column_hiding={false} />)}
      </Loaded>
    </Dialog>
  )
}

// Opens a track's versions, such as from its properties or a row of the History page.
export function open_track_history(track_id: string, name: string, on_changed?: () => void): void {
  open_dialog((close) => <TrackHistoryDialog track_id={track_id} name={name} on_close={close} on_changed={on_changed} />)
}

// ============================================================================
// Page
// ============================================================================

type Show = 'everything' | 'tracks' | 'merges'

export type HistoryRow =
  | { type: 'version'; at: number; version: TrackVersion }
  | { type: 'merge'; at: number; merge: MergeEntry }

const limits: [number, string][] = [[50, 'Last 50'], [200, 'Last 200'], [1000, 'Last 1000']]

// Track versions and merges in one list, newest first, cut to the limit.
export function history_rows(versions: TrackVersion[], merges: MergeEntry[], limit: number): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...versions.map((version): HistoryRow => ({ type: 'version', at: Date.parse(version.changed_at), version })),
    ...merges.map((merge): HistoryRow => ({ type: 'merge', at: merge.at, merge }))
  ]
  return rows.sort((first, second) => second.at - first.at).slice(0, limit)
}

const row_key = (row: HistoryRow): string => (row.type === 'version' ? `version:${row.version.id}` : `merge:${row.merge.batch_id}`)

export function HistoryView() {
  const [limit, set_limit] = useState(50)
  const [show, set_show] = useState<Show>('everything')
  const changes = use_resource(async () => {
    const [versions, merges] = await Promise.all([history().list_recent_versions(limit), history().list_recent_merges(limit)])
    return history_rows(versions, merges, limit)
  }, [limit])
  const reload = (): void => void changes.reload(true)

  // A removed track can come back from the page while no later change to it is listed.
  const newest_of = new Map<string, string>()
  for (const row of changes.data ?? []) {
    if (row.type === 'version' && !newest_of.has(row.version.item_id)) newest_of.set(row.version.item_id, row.version.id)
  }

  const columns: TableColumn<HistoryRow>[] = [
    { label: 'When', cell: (row) => when(row.at), sort: (row) => row.at, width: 180 },
    {
      label: 'Change',
      cell: (row) => (row.type === 'version'
        ? <StateBadge labels={version_labels} state={row.version.kind} />
        : <StateBadge labels={merge_labels} state={row.merge.undone ? 'undone' : 'merged'} />),
      text: (row) => (row.type === 'version' ? version_labels[row.version.kind][0] : merge_labels[row.merge.undone ? 'undone' : 'merged'][0])
    },
    {
      label: 'Track',
      cell: (row) => (row.type === 'version' ? <TrackCell snapshot={row.version.snapshot} /> : row.merge.survivor_title ?? 'Untitled track'),
      text: (row) => (row.type === 'version' ? track_name(row.version.snapshot) : row.merge.survivor_title ?? '')
    },
    {
      label: 'What changed',
      cell: (row) => (row.type === 'version'
        ? <VersionChanges version={row.version} limit={3} />
        : <span>Took in {row.merge.absorbed.map((track) => track.title ?? 'an untitled track').join(', ')}</span>),
      sortable: false
    },
    {
      label: 'Actions',
      id: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      class: 'actions-cell',
      width: 200,
      sortable: false,
      hideable: false,
      cell: (row) => {
        if (row.type === 'merge') return <div className="row-actions">{!row.merge.undone && <button onClick={() => undo(row.merge, reload)}>Undo merge</button>}</div>
        const { version } = row
        const name = track_name(version.snapshot)
        return (
          <div className="row-actions">
            <button aria-label={`History of ${name}`} onClick={() => open_track_history(version.item_id, name, reload)}>History</button>
            {version.kind === 'deleted' && newest_of.get(version.item_id) === version.id && <button onClick={() => restore(version, reload)}>Bring back</button>}
          </div>
        )
      }
    }
  ]

  return (
    <div className="page">
      <PageHeading title="History" subtitle="The latest changes to your tracks and every merge. Restore a track as it was, or undo a merge." />
      <Toolbar>
        <Segmented
          label="Show"
          choices={[{ value: 'everything', label: 'Everything' }, { value: 'tracks', label: 'Track changes' }, { value: 'merges', label: 'Merges' }]}
          value={show}
          on_change={set_show}
        />
        <Select label="Changes shown" bare options={limits} value={limit} on_change={set_limit} />
      </Toolbar>
      <Loaded resource={changes} lines={8}>
        {(rows) => {
          const shown = show === 'everything' ? rows : rows.filter((row) => (show === 'merges' ? row.type === 'merge' : row.type === 'version'))
          return shown.length === 0
            ? <Empty title={show === 'merges' ? 'No merges yet.' : 'No changes yet.'} hint="Edits, imports, merges and restores show here as they happen." />
            : <DataTable caption="Latest changes" columns={columns} rows={shown} row_key={row_key} manual_sorting />
        }}
      </Loaded>
    </div>
  )
}
