// The app's views, each at its own route such as #/folders.

import { CopyIcon, DownloadIcon, FolderIcon, HistoryIcon, MusicIcon } from '@x-tech-laboratories/x-libs/web/react/icons'
import type { ShellView } from '@x-tech-laboratories/x-libs/web/react/shell'
import { link } from '@x-tech-laboratories/x-libs/web/router'

// ============================================================================
// Views
// ============================================================================

const sidebar_views = [
  { id: 'library', label: 'Library', icon: MusicIcon },
  { id: 'folders', label: 'Folders', icon: FolderIcon },
  { id: 'import', label: 'Import', icon: DownloadIcon },
  { id: 'duplicates', label: 'Duplicates', icon: CopyIcon },
  { id: 'history', label: 'History', icon: HistoryIcon }
] as const

export type ViewId = (typeof sidebar_views)[number]['id'] | 'settings'

export function view_href(view: ViewId): string {
  return link([view])
}

// The rows the Shell draws at the top of the sidebar.
export const views: ShellView[] = sidebar_views.map((view) => ({ ...view, href: view_href(view.id) }))

export const view_labels: Record<ViewId, string> = {
  ...(Object.fromEntries(sidebar_views.map((view) => [view.id, view.label])) as Record<(typeof sidebar_views)[number]['id'], string>),
  settings: 'Settings'
}

// The view a route names, the library for an empty or unknown route.
export function view_of(parts: string[]): ViewId {
  const [first] = parts
  if (first === 'settings') return 'settings'
  return sidebar_views.find((view) => view.id === first)?.id ?? 'library'
}
