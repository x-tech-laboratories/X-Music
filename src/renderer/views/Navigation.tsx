// The app's views as rows at the top of the sidebar, each at its own route such as #/folders.

import { CopyIcon, DownloadIcon, FolderIcon, Icon, MusicIcon, type IconGlyph } from '@x-tech-laboratories/x-libs/web/react/icons'
import { link } from '@x-tech-laboratories/x-libs/web/router'

// ============================================================================
// Views
// ============================================================================

export const views = [
  { id: 'library', label: 'Library', icon: MusicIcon },
  { id: 'folders', label: 'Folders', icon: FolderIcon },
  { id: 'import', label: 'Import', icon: DownloadIcon },
  { id: 'duplicates', label: 'Duplicates', icon: CopyIcon }
] as const satisfies readonly { id: string; label: string; icon: IconGlyph }[]

export type ViewId = (typeof views)[number]['id'] | 'settings'

export const view_labels: Record<ViewId, string> = {
  ...(Object.fromEntries(views.map((view) => [view.id, view.label])) as Record<(typeof views)[number]['id'], string>),
  settings: 'Settings'
}

// The view a route names, the library for an empty or unknown route.
export function view_of(parts: string[]): ViewId {
  const [first] = parts
  if (first === 'settings') return 'settings'
  return views.find((view) => view.id === first)?.id ?? 'library'
}

export function view_href(view: ViewId): string {
  return link([view])
}

// ============================================================================
// Navigation
// ============================================================================

export function Navigation({ current }: { current: ViewId }) {
  return (
    <nav className="sidebar-nav" aria-label="Views">
      {views.map((view) => {
        const is_current = view.id === current
        return (
          <a key={view.id} href={view_href(view.id)} className={is_current ? 'tree-row active' : 'tree-row'} aria-current={is_current ? 'page' : undefined}>
            <span className="tree-label"><Icon icon={view.icon} /><span>{view.label}</span></span>
          </a>
        )
      })}
    </nav>
  )
}
