// A track's cover art at one of Halon's cover sizes, asked of the main process and held blank while it is found, or a music note when there is none.

import { Cover, cover_source } from '@x-tech-laboratories/x-libs/web/react/media'
import { Icon, MusicIcon } from '@x-tech-laboratories/x-libs/web/react/icons'
import { use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { page_ipc } from '../lib/ipc.ts'

export type CoverSize = 'small' | 'medium' | 'large'

// The picture's width in pixels at each of Halon's cover sizes, which is what the main process makes it at.
const pixels: Record<CoverSize, number> = { small: 48, medium: 96, large: 160 }

// alt names the cover to screen readers; it is left empty beside a title that already names the track.
export function TrackCover({ track_id, size, alt = '' }: { track_id: string | null; size: CoverSize; alt?: string }) {
  const art = use_resource(
    async () => (track_id === null ? null : (await page_ipc('cache_cover', track_id, pixels[size])).url),
    [track_id, size],
    { enabled: track_id !== null }
  )

  return <Cover size={size} alt={alt} src={cover_source(art)} placeholder={<Icon icon={MusicIcon} size="large" />} />
}
