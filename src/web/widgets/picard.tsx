// Tagging with MusicBrainz Picard from the window: a warning that Picard writes to the files, the hand-off, and word
// when the Picard window has closed and its files were read again.

import { confirm_dialog } from '@x-tech-laboratories/x-libs/web/react/dialog'
import { toast } from '@x-tech-laboratories/x-libs/web/react/toasts'
import { plural } from '@x-tech-laboratories/x-libs/web/format'
import type { PicardClosed } from '@shared/ipc'
import { page_ipc } from '../lib/ipc.ts'

// ============================================================================
// Handing off
// ============================================================================

export const PICARD_WARNING = 'Picard writes tags into the files, and renames or moves them if you have it set to. Ratings and play history stay with the tracks, since X-Music knows a file by its audio.'

// Asks first, since Picard changes the files themselves, then opens them in a Picard window of their own.
export function tag_with_picard(track_ids: readonly string[]): void {
  const many = track_ids.length > 1
  confirm_dialog({
    title: many ? `Tag ${track_ids.length} tracks with Picard?` : 'Tag this track with Picard?',
    message: (
      <>
        <p>{PICARD_WARNING}</p>
        <p>The files open in a Picard window of their own. Close that window when you are done, and X-Music reads the files again if Settings says to.</p>
      </>
    ),
    confirm_label: 'Open in Picard',
    busy_label: 'Opening Picard…',
    run: async () => {
      const handoff = await page_ipc('tag_with_picard', [...track_ids])
      const left_out = handoff.skipped > 0 ? `; ${plural(handoff.skipped, 'track')} with no whole file on disk left out` : ''
      toast(`Picard is open with ${plural(handoff.files, 'file')}${left_out}.`, { tone: 'good' })
    }
  })
}

// ============================================================================
// Closing
// ============================================================================

export function describe_picard_closed(closed: PicardClosed): { text: string; tone: 'good' | 'bad' } {
  if (closed.error) return { text: `Picard closed: ${closed.error}.`, tone: 'bad' }
  if (!closed.report) return { text: `Picard closed. Scan your music folders to pick up its changes to ${plural(closed.files, 'file')}.`, tone: 'good' }
  const moved = closed.report.moves_detected > 0 ? `, ${plural(closed.report.moves_detected, 'moved file')} followed` : ''
  return { text: `Picard closed; ${plural(closed.files, 'file')} read again${moved}.`, tone: 'good' }
}

// Says what came of each Picard window closing; gives back what stops listening.
export function listen_for_picard(): () => void {
  return window.xMusicEvents.on('picard_closed', (closed) => {
    const { text, tone } = describe_picard_closed(closed)
    toast(text, { tone })
  })
}
