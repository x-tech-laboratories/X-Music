// The library: three filter panes over the song list, or what to do while there is nothing to show yet.

import { Split } from '@x-tech-laboratories/x-libs/web/react/split'
import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Empty, Failure, Skeleton } from '@x-tech-laboratories/x-libs/web/react/states'
import { use_store } from '@x-tech-laboratories/x-libs/web/react/store'
import { library, results } from '../stores/library.ts'
import { FilterPane } from '../widgets/FilterPane.tsx'
import { SongList } from '../widgets/SongList.tsx'
import { view_href } from './Navigation.tsx'

// ============================================================================
// Panes
// ============================================================================

function Browser() {
  const panes_row = (
    <Split
      storage_key="x-music.split.hpfp"
      specs={[{ min: 140 }, { min: 140 }, { min: 140, grow: true }]}
      preferred={[200, 200, undefined]}
      panes={[
        <FilterPane key="fp0" id="fp0" field="genre" />,
        <FilterPane key="fp1" id="fp1" field="album_artist" />,
        <FilterPane key="fp2" id="fp2" field="album" />
      ]}
    />
  )

  return (
    <Split
      storage_key="x-music.split.vpright"
      axis="vertical"
      specs={[{ min: 90, max: 480 }, { min: 160, grow: true }]}
      preferred={[190, undefined]}
      panes={[panes_row, <SongList key="songs" />]}
    />
  )
}

// ============================================================================
// View
// ============================================================================

export function LibraryView() {
  const { stats, error } = use_store(results)

  let body
  if (stats === null && error !== null) {
    body = <Failure error={error} retry={() => void library.refresh()} />
  } else if (stats === null) {
    body = <Skeleton lines={4} />
  } else if (stats.tracks === 0) {
    body = (
      <Empty
        title="Your library is empty."
        hint={<>Add a music folder under <a href={view_href('folders')}>Folders</a>, or bring in a gmusicbrowser library under <a href={view_href('import')}>Import</a>.</>}
      />
    )
  } else {
    body = <Browser />
  }

  return (
    <div className="library-view">
      <PageHeading class_name="inline" title="Library" />
      {body}
    </div>
  )
}
