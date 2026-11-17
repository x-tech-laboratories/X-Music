// Import: bringing a gmusicbrowser library in, then on to the library once it is done.

import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { GmbImport } from '../widgets/GmbImport'
import { view_href } from './Navigation'

export function ImportView() {
  return (
    <div className="page">
      <PageHeading class_name="inline" title="Import" />
      <GmbImport ondone={() => (location.hash = view_href('library'))} />
    </div>
  )
}
