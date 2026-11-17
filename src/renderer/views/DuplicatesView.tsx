// Duplicates: tracks that look like the same recording, to review and merge.

import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { DuplicatesPanel } from '../widgets/DuplicatesPanel'

export function DuplicatesView() {
  return (
    <div className="page">
      <PageHeading class_name="inline" title="Duplicates" />
      <DuplicatesPanel />
    </div>
  )
}
