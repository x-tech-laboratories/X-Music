// Finding tracks that look like the same recording, with the reasoning for each group, to merge at once or review first.

import { useState } from 'react'
import { NumberField, Switch } from '@x-tech-laboratories/x-libs/web/react/controls'
import { Badge, StateBadge, type Tone } from '@x-tech-laboratories/x-libs/web/react/badges'
import { Section, SettingRow } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Rating } from '@x-tech-laboratories/x-libs/web/react/rating'
import { Empty, Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { use_route } from '@x-tech-laboratories/x-libs/web/react/shell'
import { is_number_in } from '@x-tech-laboratories/x-libs/web/prefs'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import { describe_call_error } from '@x-tech-laboratories/x-libs/web/errors'
import { format_count, plural } from '@x-tech-laboratories/x-libs/web/format'
import { rating_to_stars } from '@shared/fields'
import type { DuplicateGroup, DuplicateMember, DuplicateReason, MergeResult } from '@shared/ipc'
import { ipc } from '../lib/ipc.ts'
import { library } from '../stores/library.ts'
import { MergeView } from './MergeView.tsx'
import { close_overlay, open_overlay, overlay_of } from '../views/routes.ts'

const MAX_SHOWN = 200

// A merge's Undo stays offered this long.
const UNDO_TOAST_IN_MILLISECONDS = 10_000

// ============================================================================
// Ways of matching
// ============================================================================

const REASONS: { id: DuplicateReason; label: string; hint: string }[] = [
  { id: 'audio_hash', label: 'Identical audio', hint: 'Files whose audio is the same to the byte.' },
  { id: 'mb_recording_id', label: 'MusicBrainz recording', hint: 'Tracks tagged with the same MusicBrainz recording.' },
  { id: 'tags', label: 'Same tags', hint: 'The same artist, title and album.' },
  { id: 'fuzzy', label: 'Similar tags and length', hint: 'The same artist and title at about the same length, on any album. Finds many more, and many of them are not duplicates.' }
]

const CONFIDENCES: Record<DuplicateGroup['confidence'], [text: string, tone: Tone]> = {
  certain: ['Certain', 'good'],
  likely: ['Likely', 'info'],
  possible: ['Possible', 'warn']
}

interface Search {
  reasons: DuplicateReason[]
  tolerance_in_seconds: number
}

// ============================================================================
// Groups
// ============================================================================

// The tracks of one group side by side, so the richest copy stands out.
const MEMBER_COLUMNS: TableColumn<DuplicateMember>[] = [
  { label: 'Title', sort: (member) => member.title, cell: (member) => member.title ?? '—' },
  { label: 'Artist', sort: (member) => member.artist, cell: (member) => member.artist ?? '—' },
  { label: 'Album', sort: (member) => member.album, cell: (member) => member.album ?? '—' },
  { label: 'Length', class: 'number', sort: (member) => member.length_ms, cell: (member) => format_clock(member.length_ms, { empty: '—' }) },
  { label: 'Rating', sort: (member) => member.rating, cell: (member) => <Rating value={rating_to_stars(member.rating)} /> },
  { label: 'Plays', class: 'number', sort: (member) => member.play_count, cell: (member) => format_count(member.play_count) },
  { label: 'Files', class: 'number', sort: (member) => member.media_count, cell: (member) => format_count(member.media_count) },
  { label: 'Formats', sort: (member) => member.codecs, cell: (member) => member.codecs || '—' }
]

interface GroupPanelProps {
  group: DuplicateGroup
  merged: boolean
  working: boolean
  on_quick_merge: () => void
  on_review: () => void
}

function GroupPanel({ group, merged, working, on_quick_merge, on_review }: GroupPanelProps) {
  const lead = group.members[0]
  const tools = merged ? <Badge tone="good">Merged</Badge> : (
    <>
      <button type="button" disabled={working} title="Merge now: the richest copy is kept, genres and labels are combined, and so are plays and ratings." onClick={on_quick_merge}>
        {working ? 'Merging…' : 'Quick merge'}
      </button>
      <button type="button" disabled={working} onClick={on_review}>Review</button>
    </>
  )
  return (
    <Section title={lead?.title ?? 'Untitled'} tools={tools}>
      <p className="muted"><StateBadge labels={CONFIDENCES} state={group.confidence} /> {group.explanation}</p>
      <DataTable caption="Tracks in this group" columns={MEMBER_COLUMNS} rows={group.members} row_key={(member) => String(member.track_id)} column_hiding={false} />
    </Section>
  )
}

// ============================================================================
// Panel
// ============================================================================

export function DuplicatesPanel() {
  const [tolerance, set_tolerance] = use_pref('x-music.pref.duplicates.toleranceSeconds', 3, is_number_in(0, 60))
  // Similar is off at first: on a real library it proposes far more than anyone can review.
  const [enabled, set_enabled] = use_pref<Record<DuplicateReason, boolean>>('x-music.pref.duplicates.reasons', {
    audio_hash: true, mb_recording_id: true, tags: true, fuzzy: false
  })
  const [search, set_search] = useState<Search | null>(null)
  const groups = use_resource(
    () => ipc('list_duplicates', search!.reasons, search!.tolerance_in_seconds * 1000, MAX_SHOWN),
    [search],
    { enabled: search !== null }
  )
  const [merges, set_merges] = useState<Record<string, MergeResult>>({})
  const [working, set_working] = useState<Record<string, boolean>>({})
  // A reviewed merge opens at its own address, so Back closes it and a reload returns to it.
  const overlay = overlay_of(use_route().parts)

  const reasons = REASONS.map((reason) => reason.id).filter((id) => enabled[id])

  function find(): void {
    set_merges({})
    set_search({ reasons, tolerance_in_seconds: tolerance })
  }

  async function quick_merge(group: DuplicateGroup): Promise<void> {
    set_working((now) => ({ ...now, [group.key]: true }))
    try {
      const ids = group.members.map((member) => member.track_id)
      const preview = await ipc('get_merge_preview', ids)
      const result = await ipc('merge_tracks', ids, preview.survivor)
      set_merges((now) => ({ ...now, [group.key]: result }))
      toast(`Merged ${plural(ids.length, 'track')} into one`, { tone: 'good', duration_in_milliseconds: UNDO_TOAST_IN_MILLISECONDS, action: { text: 'Undo', run: () => void undo(group.key, result) } })
      await library.refresh()
    } catch (failure) {
      toast(`Could not merge: ${describe_call_error(failure)}`, { tone: 'bad' })
    } finally {
      set_working((now) => ({ ...now, [group.key]: false }))
    }
  }

  async function undo(key: string, result: MergeResult): Promise<void> {
    set_working((now) => ({ ...now, [key]: true }))
    try {
      await ipc('undo_merge', result.batch_id)
      set_merges(({ [key]: _undone, ...rest }) => rest)
      await library.refresh()
    } catch (failure) {
      toast(`Could not undo the merge: ${describe_call_error(failure)}`, { tone: 'bad' })
    } finally {
      set_working((now) => ({ ...now, [key]: false }))
    }
  }

  const tools = (
    <button type="button" className="accent solid" onClick={find} disabled={groups.status === 'loading' || reasons.length === 0}>
      Find duplicates
    </button>
  )

  return (
    <>
      <Section title="Ways of matching" tools={tools}>
        <div>
          {REASONS.map((reason) => (
            <SettingRow key={reason.id} label={reason.label} hint={reason.hint} as_label>
              <Switch label={reason.label} checked={enabled[reason.id]} on_change={(on) => set_enabled({ ...enabled, [reason.id]: on })} />
            </SettingRow>
          ))}
          {enabled.fuzzy && (
            <SettingRow label="Length tolerance" hint="How far apart in length two similar tracks may be.">
              <NumberField label="Length tolerance" value={tolerance} min={0} max={60} unit="seconds" bare on_change={(value) => value !== null && set_tolerance(value)} />
            </SettingRow>
          )}
        </div>
      </Section>

      <Loaded resource={groups} lines={4}>{(found) => found.length === 0 ? (
        <Empty title="No duplicates found." hint="Switch on more ways of matching to look further." />
      ) : (
        <>
          <p className="muted">
            {plural(found.length, 'group')} · {plural(found.reduce((count, group) => count + group.members.length, 0), 'track')}
            {found.length >= MAX_SHOWN && ` (the first ${format_count(MAX_SHOWN)} shown)`}
          </p>
          {found.map((group) => (
            <GroupPanel
              key={group.key}
              group={group}
              merged={merges[group.key] !== undefined}
              working={working[group.key] ?? false}
              on_quick_merge={() => void quick_merge(group)}
              on_review={() => open_overlay('duplicates', { kind: 'merge', track_ids: group.members.map((member) => member.track_id) })}
            />
          ))}
        </>
      )}</Loaded>

      {overlay?.kind === 'merge' && (
        <MergeView
          key={overlay.track_ids.join('/')}
          ids={overlay.track_ids}
          on_close={(merged) => {
            close_overlay()
            if (merged) {
              void library.refresh()
              void groups.reload()
            }
          }}
          on_undone={() => void groups.reload()}
        />
      )}
    </>
  )
}
