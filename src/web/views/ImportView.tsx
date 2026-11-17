// Import: bringing a gmusicbrowser library in.

import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { GmbImport } from '../widgets/GmbImport'

export function ImportView() {
  return (
    <div className="page">
      <PageHeading title="Import" subtitle="Bring in a gmusicbrowser library: ratings, play counts and history, genres, groupings, labels and saved lists." />
      <GmbImport />
    </div>
  )
}
