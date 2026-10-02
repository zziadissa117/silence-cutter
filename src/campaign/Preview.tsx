// An angle's look drawn on an empty 9:16 frame by the same code that draws
// the real videos, with TikTok's buttons and caption area marked so nothing
// is put where the app will cover it.

import { useEffect, useRef, useState } from 'react'

import { headlineFontReady } from './headlineFont'
import type { VideoLook } from './look'
import { TIKTOK_ZONES, drawHeadline, drawLogo, layoutHeadline, layoutLogo } from './overlay'

export function LookPreview({ look, headlineText, compact = false }: { look: VideoLook; headlineText?: string; compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [logo, setLogo] = useState<ImageBitmap | null>(null)
  // Decoded once per picture, however often the words beside it change.
  const pictureBitmaps = useRef(new WeakMap<Blob, ImageBitmap>())
  const [decoded, setDecoded] = useState(0)
  // Drawn again once TikTok Sans has loaded, so the preview is the real font.
  const [fontReady, setFontReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void headlineFontReady().then(() => !cancelled && setFontReady(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    for (const picture of look.pictures) {
      if (pictureBitmaps.current.has(picture.image)) continue
      void createImageBitmap(picture.image)
        .then((bitmap) => {
          pictureBitmaps.current.set(picture.image, bitmap)
          if (!cancelled) setDecoded((n) => n + 1)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [look.pictures])

  useEffect(() => {
    let cancelled = false
    let bitmap: ImageBitmap | null = null
    if (look.logo.image) {
      void createImageBitmap(look.logo.image)
        .then((b) => {
          bitmap = b
          if (cancelled) b.close()
          else setLogo(b)
        })
        .catch(() => setLogo(null))
    } else setLogo(null)
    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [look.logo.image])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)
    const ground = ctx.createLinearGradient(0, 0, 0, height)
    ground.addColorStop(0, '#2b323d')
    ground.addColorStop(1, '#161a21')
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, width, height)

    ctx.save()
    ctx.fillStyle = 'rgb(255 255 255 / 0.07)'
    ctx.fillRect(width * (1 - TIKTOK_ZONES.right), height * 0.42, width * TIKTOK_ZONES.right, height * 0.4)
    ctx.fillRect(0, height * (1 - TIKTOK_ZONES.bottom), width, height * TIKTOK_ZONES.bottom)
    ctx.fillRect(0, 0, width, height * TIKTOK_ZONES.top * 0.7)
    ctx.restore()

    for (const picture of look.pictures) {
      const bitmap = pictureBitmaps.current.get(picture.image)
      if (bitmap) drawLogo(ctx, bitmap, layoutLogo(width, height, bitmap, picture))
    }
    const headline = layoutHeadline(ctx, width, height, { ...look.headline, text: headlineText ?? look.headline.text })
    if (headline) drawHeadline(ctx, headline)
    if (logo) drawLogo(ctx, logo, layoutLogo(width, height, logo, look.logo))
  }, [look.headline, look.logo, look.pictures, logo, decoded, headlineText, fontReady])

  return (
    <div className={compact ? 'preview compact' : 'preview'}>
      <canvas ref={canvasRef} width={540} height={960} aria-label="Preview of the angle" />
      {compact ? null : (
        <div className="hint">
          Shaded: where TikTok's buttons and caption sit.
          {look.logo.image || look.pictures.length > 0
            ? ' Everything is shown at once here; in a video the logo and pictures come when you say their words.'
            : ''}
        </div>
      )}
    </div>
  )
}
