// A filter pane: the values of one field, chosen by the user, picked to narrow the library, on X-Libs' FacetPane.

import { Select } from '@x-tech-laboratories/x-libs/web/react/controls'
import { FacetPane, type FacetValue } from '@x-tech-laboratories/x-libs/web/react/facet_pane'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { Rating } from '@x-tech-laboratories/x-libs/web/react/rating'
import { use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { use_store } from '@x-tech-laboratories/x-libs/web/react/store'
import type { GroupRow } from '@shared/ipc'
import { field, fieldsWith, ratingToStars } from '@shared/fields'
import { sanitizePaneField } from '@shared/viewstate'
import { browse, library, results } from '../stores/library'

const FALLBACK_ROW_HEIGHT = 28

// Halon's row height for the density in force, which the pane's virtual rows are drawn at.
function row_height(): number {
  const height = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-height'))
  return Number.isFinite(height) && height > 0 ? height : FALLBACK_ROW_HEIGHT
}

// Every field that can group the library, by name, so no field is second class.
const groupable: [string, string][] = fieldsWith('groupable')
  .map((descriptor): [string, string] => [descriptor.id, descriptor.name])
  .sort((first, second) => first[1].localeCompare(second[1]))

// The pane's rows: values the user can pick, a rating drawn as stars; tracks with no value have no row, since picking none is not a filter.
export function facet_values(field_id: string, groups: readonly GroupRow[]): FacetValue[] {
  return groups.flatMap((group): FacetValue[] => {
    if (group.label === null || group.label === '') return []
    const value = String(group.label)
    if (field_id !== 'rating') return [{ value, count: group.n }]
    return [{ value, count: group.n, label: <Rating value={ratingToStars(Number(value))} label={`${ratingToStars(Number(value))} stars`} /> }]
  })
}

export function FilterPane({ field: default_field = 'genre', id = 'pane' }: { field?: string; id?: string }) {
  // What the user last chose wins over the default, while it still names a real field.
  const [remembered, remember] = use_pref<string>(`x-music.pref.pane.${id}.field`, default_field)
  const current = sanitizePaneField(remembered, default_field)
  const state = use_store(browse)
  const groups = use_resource(() => library.groups_for(current), [current], { watch: results.watch })

  return (
    <FacetPane
      label={field(current).name}
      heading={<Select bare label="Field to browse by" options={groupable} value={current} on_change={remember} />}
      values={facet_values(current, groups.data ?? [])}
      total={(groups.data ?? []).reduce((sum, group) => sum + group.n, 0)}
      selected={state.panes[current] ?? []}
      on_change={(values) => void library.set_pane(current, values)}
      loading={groups.loading}
      error={groups.error}
      on_retry={() => void groups.reload()}
      virtual={{ row_height: row_height() }}
    />
  )
}
