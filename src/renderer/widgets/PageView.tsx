// A full-window view over the library on the X-Libs dialog, so Escape and the Close button always lead back out.

import type { ReactNode } from 'react'
import { Dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { Tabs, type TabItem } from '@x-tech-laboratories/x-libs/web/react/layout'

export function PageView<Section extends string>({
  title,
  subtitle,
  onclose,
  actions,
  sections,
  section,
  onSection,
  children
}: {
  title: string
  subtitle?: string
  onclose: () => void
  // Buttons beside Close, such as Merge.
  actions?: ReactNode
  sections?: TabItem<Section>[]
  section?: Section
  onSection?: (section: Section) => void
  children: ReactNode
}) {
  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      on_close={onclose}
      full
      class_name="page-view"
      actions={<>{actions}<button onClick={onclose} title="Close (Esc)">Close</button></>}
    >
      {sections && section !== undefined && (
        <Tabs label={`${title} sections`} items={sections} active={section} on_select={onSection} />
      )}
      <div className="page-view-content">{children}</div>
    </Dialog>
  )
}
