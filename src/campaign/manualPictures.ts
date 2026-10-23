// What he puts on a video himself in the edit screen, at a moment he picks,
// the way TikTok's editor does: a picture (from the picture bank or his
// phone), a video over him (from the video bank or his phone - muted, in its
// own box), or words of his own. A picture is drawn by the same code as the
// angle's pictures (same spots, same spring-in), so it looks like the others;
// words are drawn as a headline is, in its three looks.

import type { HeadlinePlace, HeadlineStyle, PictureCue } from './look'
import type { LogoPosition } from './look'
import { cameUpTogether, layoutLogo, sideBySide } from './overlay'

export interface ManualPicture {
  id: string
  /** From the picture bank (kept on the phone, shared by every campaign); a
   *  picture or video he picked from the phone for this video alone (`type`
   *  says which); a video from the video bank; or words he typed. */
  source:
    | { kind: 'bank'; pictureId: string }
    | { kind: 'phone'; name: string; type: string }
    | { kind: 'video'; videoId: string }
    | { kind: 'text'; text: string; style: HeadlineStyle }
  /** When it comes up, in seconds on the raw recording. */
  at: number
  /** How long it stays up. */
  seconds: number
  position: LogoPosition
  /** Width, as a percentage of the video's width - for words, how big they
   *  are (TEXT_BASE_PCT is a medium headline's size). */
  widthPct: number
  /** Where he dragged it: its middle, as fractions of the frame. In place of
   *  `position`; absent until he moves it. Words always have one. */
  center?: { x: number; y: number }
  /** A video's own length: it stays up no longer. */
  length?: number
}

/** How long a picture or words can stay up, and the step + and - take. */
export const PICTURE_SECONDS = { min: 0.5, max: 20, step: 0.5 } as const
/** A video plays to its end, up to this long. */
export const VIDEO_SECONDS_MAX = 60
/** How small and big a picture can be made, % of the width. */
export const PICTURE_WIDTH = { min: 8, max: 100 } as const
/** The size words start at: a medium headline's. */
export const TEXT_BASE_PCT = 40
/** Where new words go: the middle, a little above, as TikTok puts them. */
export const TEXT_START = { x: 0.5, y: 0.42 } as const

export const isText = (m: ManualPicture): m is ManualPicture & { source: { kind: 'text' } } => m.source.kind === 'text'
export const isVideo = (m: ManualPicture): boolean => m.source.kind === 'video' || (m.source.kind === 'phone' && m.source.type.startsWith('video/'))
export const isPicture = (m: ManualPicture): boolean => !isText(m) && !isVideo(m)

/** The longest a thing can stay up: a video its own length. */
export function longestFor(m: ManualPicture): number {
  if (!isVideo(m)) return PICTURE_SECONDS.max
  return Math.max(PICTURE_SECONDS.min, Math.min(VIDEO_SECONDS_MAX, m.length ?? VIDEO_SECONDS_MAX))
}

/** Words he typed, as a headline to lay out and draw (overlay.ts): their
 *  look, where he put them and how big. Null for none typed. */
export function textHeadline(m: ManualPicture): {
  text: string
  style: HeadlineStyle
  position: 'middle'
  size: 'medium'
  place: HeadlinePlace
} | null {
  if (m.source.kind !== 'text' || !m.source.text.trim()) return null
  const center = m.center ?? TEXT_START
  return { text: m.source.text, style: m.source.style, position: 'middle', size: 'medium', place: { x: center.x, y: center.y, scale: m.widthPct / TEXT_BASE_PCT } }
}

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
    if (!isPicture(m)) continue
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
