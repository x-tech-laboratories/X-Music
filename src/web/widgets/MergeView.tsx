// Sources side by side, one column each, one row per field, so a disagreement reads as a diff
// rather than as a list of options. Resolution stays per field, following Thunderbird CardBook.

import { useState } from 'react'
import type { MergePreview, Resolution } from '@shared/ipc'
import { Badge } from '@x-tech-laboratories/x-libs/web/react/badges'
import { Switch } from '@x-tech-laboratories/x-libs/web/react/controls'
import { Section, Stack, Tile, Tiles } from '@x-tech-laboratories/x-libs/web/react/layout'
import { MergeGrid, is_conflict, winner_of, type MergeChoices, type MergeField } from '@x-tech-laboratories/x-libs/web/react/merge_grid'
import { PageView } from '@x-tech-laboratories/x-libs/web/react/page_view'
import { Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { DataTable, type TableColumn } from '@x-tech-laboratories/x-libs/web/react/table'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { Rating } from '@x-tech-laboratories/x-libs/web/react/rating'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { is_boolean } from '@x-tech-laboratories/x-libs/web/prefs'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import { describe_call_error } from '@x-tech-laboratories/x-libs/web/errors'
import { rating_to_stars } from '@shared/fields'
import { ipc } from '../lib/ipc.ts'
import { library } from '../stores/library.ts'

type TrackId = MergePreview['ids'][number]

// ============================================================================
// Preview to grid
// ============================================================================

// The grid keys each source by text; this is the one place a track id becomes a key and back.
const key_of = (id: TrackId): string => String(id)

// A length reads as a clock time, so two rips a few milliseconds apart are easy to compare.
const length_text = (value: unknown): string => (value === null || value === undefined || value === '' ? '' : format_clock(Number(value)))

function grid_fields(preview: MergePreview): MergeField<TrackId>[] {
  return preview.fields.map((field) => ({
    id: field.field,
    label: field.name,
    value: (id) => (field.conflict ? field.options?.find((option) => option.from === id)?.value ?? null : field.value ?? null),
    combine: field.multi ? () => field.union ?? [] : undefined,
    text: field.field === 'length' ? length_text : undefined
  }))
}

// What the main process is told for each field that disagrees: exactly the winner the grid shows.
function resolutions_for(preview: MergePreview, survivor: string, choices: MergeChoices): Record<string, Resolution> {
  const by_key = new Map(preview.ids.map((id) => [key_of(id), id]))
  const fields = grid_fields(preview)
  const resolutions: Record<string, Resolution> = {}
  for (const field of preview.fields) {
    if (!field.conflict) continue
    const grid_field = fields.find((each) => each.id === field.field)!
    const winner = winner_of(grid_field, preview.ids, key_of, survivor, choices)
    const from = by_key.get(winner)
    resolutions[field.field] = from === undefined ? { kind: 'union' } : { kind: 'value', from }
  }
  return resolutions
}

// ============================================================================
// Undo
// ============================================================================

export async function undo_merge(batch_id: string, on_undone?: () => void): Promise<void> {
  try {
    await ipc('undo_merge', batch_id)
    await library.refresh()
    on_undone?.()
    toast('Merge undone', { tone: 'good' })
  } catch (error) {
    toast(`Could not undo the merge: ${describe_call_error(error)}`, { tone: 'bad' })
  }
}

// ============================================================================
// View
// ============================================================================

interface MergeViewProps {
  ids: TrackId[]
  // Closes the view, saying whether the tracks were merged.
  on_close?: (merged: boolean) => void
  // Called after the merge toast's Undo has taken the merge back.
  on_undone?: () => void
}

function MergeBody({ preview, survivor, set_survivor, choices, set_choices, only_differences }: {
  preview: MergePreview
  survivor: string
  set_survivor: (key: string) => void
  choices: MergeChoices
  set_choices: (choices: MergeChoices) => void
  only_differences: boolean
}) {
  const files_of = (id: TrackId): number => preview.media.filter((media) => media.from === id).length
  const source_name = (id: TrackId): string => `Source ${preview.ids.indexOf(id) + 1}`
  const file_columns: TableColumn<MergePreview['media'][number]>[] = [
    { label: 'Format', cell: (media) => (media.codec ?? 'Unknown').toUpperCase() },
    { label: 'File', cell: (media) => <><code className="path">{media.uri}</code>{!media.present && <> <Badge tone="bad">Missing</Badge></>}</>, text: (media) => media.uri },
    { label: 'From', cell: (media) => source_name(media.from), sort: (media) => preview.ids.indexOf(media.from) }
  ]

  return (
    <Stack>
      {preview.pinned_sources.length > 0 && (
        <p className="tone-warn">
          {plural(preview.pinned_sources.length, 'source')} of these was merged or split by hand before. Merging replaces
          that decision.
        </p>
      )}

      <MergeGrid
        label="Tracks to merge"
        items={preview.ids}
        item_key={key_of}
        item_heading={(id) => source_name(id)}
        item_detail={(id) => plural(files_of(id), 'file')}
        fields={grid_fields(preview)}
        survivor={survivor}
        on_survivor_change={set_survivor}
        choices={choices}
        on_choices_change={set_choices}
        only_differences={only_differences}
      />

      <Section level={3} title="Combined statistics">
        <p className="muted small">
          These are not a choice: plays and skips are summed, the highest rating wins, and play
          history is merged and deduplicated.
        </p>
        <Tiles>
          <Tile label="Plays" value={preview.statistics.play_count} value_first />
          <Tile label="Skips" value={preview.statistics.skip_count} value_first />
          <Tile label="Rating" value={<Rating value={rating_to_stars(preview.statistics.rating)} />} value_first />
        </Tiles>
      </Section>

      <Section level={3} title="Files the surviving track will hold">
        <DataTable caption="Files the surviving track will hold" columns={file_columns} rows={preview.media} row_key={(media) => media.id} column_hiding={false} />
      </Section>
    </Stack>
  )
}

export function MergeView({ ids, on_close, on_undone }: MergeViewProps) {
  const loaded = use_resource(() => ipc('get_merge_preview', ids), [])
  const preview = loaded.data
  // The source that survives, the preview's proposal until one is picked.
  const [chosen_survivor, set_survivor] = useState<string | null>(null)
  const survivor = chosen_survivor ?? (preview ? key_of(preview.survivor) : null)
  const [choices, set_choices] = useState<MergeChoices>({})
  const [busy, set_busy] = useState(false)
  const [only_differences, set_only_differences] = use_pref('x-music.pref.merge.onlyDifferences', false, is_boolean)

  const conflicts = preview ? grid_fields(preview).filter((field) => is_conflict(field, preview.ids)).length : 0

  async function merge(): Promise<void> {
    if (!preview || survivor === null) return
    const survivor_id = preview.ids.find((id) => key_of(id) === survivor)
    if (survivor_id === undefined) return
    set_busy(true)
    try {
      const result = await ipc('merge_tracks', preview.ids, survivor_id, resolutions_for(preview, survivor, choices))
      await library.refresh()
      toast(`Merged ${plural(preview.ids.length, 'track')} into one holding ${plural(result.media_moved + 1, 'file')}`, {
        tone: 'good',
        duration_in_milliseconds: 10_000,
        action: { text: 'Undo', run: () => void undo_merge(result.batch_id, on_undone) }
      })
      on_close?.(true)
    } catch (error) {
      toast(`Could not merge: ${describe_call_error(error)}`, { tone: 'bad' })
      set_busy(false)
    }
  }

  const actions = preview && (
    <>
      <Switch label="Only differences" show_label checked={only_differences} on_change={set_only_differences} />
      <button className="accent solid" onClick={() => void merge()} disabled={busy || survivor === null}>
        {busy ? 'Merging…' : 'Merge'}
      </button>
    </>
  )

  return (
    <PageView
      title={`Merge ${plural(ids.length, 'track')} into one`}
      subtitle={preview && (conflicts > 0
        ? `${plural(conflicts, 'field')} disagree; pick which value to keep`
        : 'Every field agrees; merging keeps all files under one track')}
      on_close={() => on_close?.(false)}
      actions={actions}
    >
      <Loaded resource={loaded} lines={6}>
        {(loaded_preview) => survivor !== null && (
          <MergeBody
            preview={loaded_preview} survivor={survivor} set_survivor={set_survivor}
            choices={choices} set_choices={set_choices} only_differences={only_differences}
          />
        )}
      </Loaded>
    </PageView>
  )
}
