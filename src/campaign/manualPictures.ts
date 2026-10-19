// A picture he puts on a video himself, at a moment he picks in the cuts
// editor - from the picture bank or from his phone - instead of one that comes
// up when a word is said. It is drawn by the same code as the angle's pictures
// (same spots, same spring-in), so it looks like the others.

import type { PictureCue } from './look'
import type { LogoPosition } from './look'
import { cameUpTogether, layoutLogo, sideBySide } from './overlay'

export interface ManualPicture {
  id: string
  /** From the picture bank (kept on the phone, shared by every campaign), or a
   *  picture he picked from the phone for this video alone. */
  source: { kind: 'bank'; pictureId: string } | { kind: 'phone'; name: string; type: string }
  /** When it comes up, in seconds on the raw recording. */
  at: number
  /** How long it stays up. */
  seconds: number
  position: LogoPosition
  /** Width, as a percentage of the video's width. */
  widthPct: number
  /** Where he dragged it: its middle, as fractions of the frame. In place of
   *  `position`; absent until he moves it. */
  center?: { x: number; y: number }
}

/** How long a picture can stay up, and the step + and - take. */
export const PICTURE_SECONDS = { min: 0.5, max: 20, step: 0.5 } as const
/** How small and big a picture can be made, % of the width. */
export const PICTURE_WIDTH = { min: 8, max: 100 } as const

export const SIZES: { label: string; widthPct: number }[] = [
  { label: 'Small', widthPct: 25 },
  { label: 'Medium', widthPct: 40 },
  { label: 'Large', widthPct: 60 },
]

export const POSITIONS: { id: LogoPosition; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
]

export const DURATIONS = [1, 2, 3, 4, 5, 6, 8]

/** The picture cues for the render, and the moment each comes up. Pictures
 *  whose image could not be found are left out (and named, so he can be told). */
export function manualCues(
  manual: readonly ManualPicture[],
  images: ReadonlyMap<string, Blob>,
): { cues: PictureCue[]; at: Map<string, number>; missing: ManualPicture[] } {
  const cues: PictureCue[] = []
  const at = new Map<string, number>()
  const missing: ManualPicture[] = []
  for (const m of manual) {
    const image = images.get(m.id)
    if (!image) {
      missing.push(m)
      continue
    }
    cues.push({ id: m.id, image, words: [], seconds: m.seconds, position: m.position, widthPct: m.widthPct, ...(m.center ? { center: m.center } : {}) })
    at.set(m.id, m.at)
  }
  return { cues, at, missing }
}

/** Where a CSS box puts a picture so the preview matches the render (see
 *  overlay.ts layoutLogo): inside TikTok's safe zones. */
export function previewStyle(position: LogoPosition, widthPct: number): Record<string, string> {
  const base = { position: 'absolute', width: `${widthPct}%` }
  switch (position) {
    case 'top':
      return { ...base, left: '50%', top: '13%', transform: 'translateX(-50%)' }
    case 'top-left':
      return { ...base, left: '6%', top: '13%' }
    case 'top-right':
      return { ...base, right: '6%', top: '13%' }
    case 'bottom-left':
      return { ...base, left: '6%', bottom: '23%' }
    case 'bottom-right':
      return { ...base, right: '15%', bottom: '23%' }
    default:
      return { ...base, left: '50%', top: '42%', transform: 'translate(-50%, -50%)' }
  }
}

/** A short unique id for a picture on a video. */
export function newPictureId(): string {
  return `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Where each picture sits in the preview, as fractions of the frame: the
 *  render's own layout (overlay.ts), so what he sees is what he gets - side
 *  by side for pictures that come up together. `aspect` is each picture's
 *  width over height (square until it has loaded); `frame` the video's. */
export function previewBoxes(
  pictures: readonly (Pick<ManualPicture, 'id' | 'at' | 'position' | 'widthPct' | 'center'> & { aspect?: number })[],
  frame: number,
): Record<string, { left: number; top: number; width: number; height: number }> {
  const W = 1000
  const H = W / (frame > 0 ? frame : 9 / 16)
  const laid = pictures.map((p) => ({
    id: p.id,
    at: p.at,
    layout: layoutLogo(W, H, { width: (p.aspect && p.aspect > 0 ? p.aspect : 1) * 100, height: 100 }, p),
  }))
  const out: Record<string, { left: number; top: number; width: number; height: number }> = {}
  for (const group of cameUpTogether(laid.map((l) => ({ item: l, start: l.at })))) {
    const placed = sideBySide(group.map((g) => g.layout), W, H)
    group.forEach((g, k) => {
      const b = placed[k]
      out[g.id] = { left: b.x / W, top: b.y / H, width: b.width / W, height: b.height / H }
    })
  }
  return out
}

/** A picture's middle, as fractions of the frame - where he dragged it, or
 *  where its spot puts it. */
export function centerOf(box: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}
