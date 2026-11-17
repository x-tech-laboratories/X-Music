// Folders: the music folders the library is built from, and scanning them.

import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { ScanPanel } from '../widgets/ScanPanel'

export function FoldersView() {
  return (
    <div className="page">
      <PageHeading class_name="inline" title="Folders" />
      <ScanPanel />
    </div>
  )
}
