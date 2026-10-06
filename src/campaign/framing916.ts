// Footage that is not 9:16 - Meta glasses record landscape (or 3:4) - made
// into a 9:16 video for TikTok and Reels.
//
// Detected from the frame size the container reports (rotation already
// applied, see media display sizes), never from a file name or a guess about
// the camera. A clip that is already 9:16 is left exactly as it is.
//
// Two ways to fill the frame, and he picks which in Settings:
//   fill - crop the middle to 9:16 (the default; the sides are lost)
//   fit  - keep the whole picture in the middle, over a blurred copy of itself
//   off  - leave the clip's own shape alone

import { cover } from './reaction'
import { outputSize } from './overlay'

export type LandscapeMode = 'fill' | 'fit' | 'off'

export const LANDSCAPE_MODES: { id: LandscapeMode; label: string; note: string }[] = [
  { id: 'fill', label: 'Fill', note: 'Crops the middle of a wide clip to 9:16.' },
  { id: 'fit', label: 'Fit', note: 'Keeps the whole picture over a blurred copy of it.' },
  { id: 'off', label: 'Off', note: 'Leaves wide clips as they are.' },
]

const KEY = 'cutter-landscape-mode'
const TOLERANCE = 0.01

export function landscapeMode(): LandscapeMode {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'fill' || saved === 'fit' || saved === 'off') return saved
  } catch {
    // Storage blocked: the default below.
  }
  return 'fill'
}

export function setLandscapeMode(mode: LandscapeMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // Not saved; this session still uses what he picked in the page.
  }
}

/** True for a frame already within a hair of 9:16 portrait. */
export function is916(width: number, height: number): boolean {
  return height > 0 && Math.abs(width / height - 9 / 16) <= TOLERANCE * (9 / 16)
}

/** Narrower than this (width over height) is a phone held upright: 9:16, a
 *  taller phone screen (9:19.5) or a little off either. 3:4 (0.75), square
 *  and landscape are not. */
const UPRIGHT_BELOW = 0.7

/** Whether a clip is shaped like a phone held upright. Only the other shapes
 *  - landscape, square, 3:4 (Meta glasses) - are asked about when added
 *  (WideAsk): a clip filmed on a phone in portrait is a talking video, and
 *  asking about it only gave a way to leave its pauses in by mistake. It is
 *  still cropped to exactly 9:16 when it is made (is916 above decides that). */
export function isUpright(width: number, height: number): boolean {
  return height > 0 && width / height < UPRIGHT_BELOW
}

/** The finished frame for a source of `width`×`height`. */
export function framedSize(width: number, height: number, mode: LandscapeMode): { width: number; height: number } {
  if (mode === 'off' || is916(width, height)) return outputSize(width, height)
  if (mode === 'fit') return { width: 1080, height: 1920 }
  // Fill: the biggest 9:16 box inside the picture - nothing is made up.
  const cropW = width / height > 9 / 16 ? (height * 9) / 16 : width
  const cropH = width / height > 9 / 16 ? height : (width * 16) / 9
  return outputSize(cropW, cropH)
}

export interface Plan {
  /** Where the whole source frame is drawn on the canvas. */
  main: { x: number; y: number; width: number; height: number }
  /** True when a blurred copy goes behind it. */
  blurred: boolean
}

/** Where to draw a `srcW`×`srcH` frame on an `outW`×`outH` canvas. */
export function planFrame(srcW: number, srcH: number, outW: number, outH: number, mode: LandscapeMode): Plan {
  if (mode === 'off' || is916(srcW, srcH)) return { main: { x: 0, y: 0, width: outW, height: outH }, blurred: false }
  if (mode === 'fill') return { main: cover(srcW, srcH, outW, outH), blurred: false }
  const scale = Math.min(outW / srcW, outH / srcH)
  const width = srcW * scale
  const height = srcH * scale
  return { main: { x: (outW - width) / 2, y: (outH - height) / 2, width, height }, blurred: true }
}

const BLUR_SIDE = 64

/** A small canvas the frame is squeezed into, then stretched back out behind
 *  the picture: a blur that needs no canvas filter (not on every Safari). */
export function makeBlurBackdrop() {
  const small = new OffscreenCanvas(BLUR_SIDE, Math.round((BLUR_SIDE * 16) / 9))
  const sctx = small.getContext('2d')
  return {
    draw(
      ctx: OffscreenCanvasRenderingContext2D,
      sample: { draw: (c: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void },
      outW: number,
      outH: number,
      srcW: number,
      srcH: number,
    ) {
      if (!sctx) return
      const place = cover(srcW, srcH, small.width, small.height)
      sample.draw(sctx, place.x, place.y, place.width, place.height)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(small, 0, 0, outW, outH)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, outW, outH)
    },
  }
}
