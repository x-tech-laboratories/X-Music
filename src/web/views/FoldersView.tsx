// Folders: the music folders the library is built from, and scanning them.

import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { ScanPanel } from '../widgets/ScanPanel'

export function FoldersView() {
  return (
    <div className="page">
      <PageHeading title="Folders" subtitle="The folders X-Music builds your library from. Your music files are only ever read, never changed." />
      <ScanPanel />
    </div>
  )
}
