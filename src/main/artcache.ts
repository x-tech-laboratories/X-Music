// One place decides where cached art lives, so the protocol handler and the resolver agree.

import { join } from 'node:path'
import { app, nativeImage } from 'electron'

export const art_cache_dir = (): string => join(app.getPath('userData'), 'artwork')

/**
 * Resizing via Electron's own image support, so no native image library is added. It handles PNG
 * and JPEG, which is what embedded covers overwhelmingly are; anything it cannot read returns null
 * and the original is served instead.
 */
export function resize_image(data: Buffer, size: number): Buffer | null {
  const image = nativeImage.createFromBuffer(data)
  if (image.isEmpty()) return null

  const { width, height } = image.getSize()
  if (width === 0 || height === 0) return null
  if (Math.max(width, height) <= size) return null

  const scaled = width >= height
    ? image.resize({ width: size, quality: 'good' })
    : image.resize({ height: size, quality: 'good' })

  return scaled.isEmpty() ? null : scaled.toPNG()
}
