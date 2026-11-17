// Duplicates: tracks that look like the same recording, to review and merge.

import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { DuplicatesPanel } from '../widgets/DuplicatesPanel.tsx'

export function DuplicatesView() {
  return (
    <div className="page">
      <PageHeading title="Duplicates" subtitle="Tracks that look like the same recording. Nothing is merged until you choose to, and every merge can be undone." />
      <DuplicatesPanel />
    </div>
  )
}
