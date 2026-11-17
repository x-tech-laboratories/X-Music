// A track's cover art. Resolution is lazy in the main process, so this asks and waits; a track
// with no art shows a stable placeholder rather than a broken image or a flicker.

import { Cover, cover_source } from '@x-tech-laboratories/x-libs/web/react/media'
import { Icon, MusicIcon } from '@x-tech-laboratories/x-libs/web/react/icons'
import { use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { ipc } from '../lib/ipc'
import s from './Cover.module.css'

// Fills the width it is given; size is the picture's resolution in pixels.
export function TrackCover({ track_id, size }: { track_id: string | null; size: number }) {
  const art = use_resource(
    async () => (track_id === null ? null : (await ipc('art:forTrack', { trackId: track_id, size })).url),
    [track_id, size],
    { enabled: track_id !== null }
  )

  return <Cover src={cover_source(art)} placeholder={<Icon icon={MusicIcon} size="large" className={s.placeholder} />} />
}
