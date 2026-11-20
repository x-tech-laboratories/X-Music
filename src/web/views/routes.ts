// The app's views, each at its own route such as #/folders, and the pages opened over a view, such as a track's properties at #/library/properties/<id>.

import { CopyIcon, DownloadIcon, FolderIcon, HistoryIcon, MusicIcon } from '@x-tech-laboratories/x-libs/web/react/icons'
import type { ShellView } from '@x-tech-laboratories/x-libs/web/react/shell'
import { current_route, link } from '@x-tech-laboratories/x-libs/web/router'

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

// ============================================================================
// Pages over a view
// ============================================================================

export type Overlay = { kind: 'properties'; track_id: string } | { kind: 'merge'; track_ids: string[] }

// The page a route opens over its view, if any.
export function overlay_of(parts: string[]): Overlay | null {
  const [, kind, ...rest] = parts
  if (kind === 'properties' && rest.length === 1) return { kind, track_id: rest[0]! }
  if (kind === 'merge' && rest.length > 1) return { kind, track_ids: rest }
  return null
}

export function overlay_href(view: ViewId, overlay: Overlay): string {
  return overlay.kind === 'properties' ? link([view, 'properties', overlay.track_id]) : link([view, 'merge', ...overlay.track_ids])
}

// Whether the page now open was opened from inside the window, so closing it can step Back.
let opened_here = false

export function open_overlay(view: ViewId, overlay: Overlay): void {
  opened_here = true
  location.hash = overlay_href(view, overlay)
}

// Closes the page by stepping Back when the window opened it, or by going to its view when it came from a reload.
export function close_overlay(): void {
  if (opened_here) {
    opened_here = false
    history.back()
    return
  }
  history.replaceState(null, '', view_href(view_of(current_route().parts)))
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

// Back from an open page clears the flag, so a later reload-opened page does not step Back out of the app.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (overlay_of(current_route().parts) === null) opened_here = false
  })
}
