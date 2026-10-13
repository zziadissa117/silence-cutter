// A video from the bank that pops up when he says its words, and plays to
// its end - muted, in a big box over him (about two thirds of the screen),
// not a full-screen cutaway. Where it sits and how big are his to set per
// video on the caption check.
//
// This file is the arithmetic and the frame stepping, so they can be tested
// without a decoder; render.ts does the drawing.

import { TIKTOK_ZONES } from './overlay'

export type PopPosition = 'top' | 'middle' | 'bottom'
export const POP_POSITIONS: { id: PopPosition; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom', label: 'Bottom' },
]

/** How wide the box is, as a share of the video's width. */
export const POP_SIZE = { min: 40, max: 90, default: 65 } as const
export const DEFAULT_POP_POSITION: PopPosition = 'middle'
/** The most of the frame's height a tall clip may take. */
const MAX_HEIGHT_SHARE = 0.75

export interface PopLayout {
  x: number
  y: number
  width: number
  height: number
  /** Rounded corners, in pixels. */
  radius: number
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export function cleanPopSize(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(POP_SIZE.max, Math.max(POP_SIZE.min, n)) : POP_SIZE.default
}

/** Where the box goes on a `width`×`height` frame: `sizePct` of the frame's
 *  width at the clip's own shape, no taller than three quarters of the
 *  frame, centred across and kept clear of TikTok's top bar and caption
 *  area. Even sides, for the decoder to scale to. */
export function popLayout(
  width: number,
  height: number,
  clip: { width: number; height: number },
  sizePct: number,
  position: PopPosition,
): PopLayout {
  const base = Math.min(width, height * (9 / 16))
  const shape = clip.width > 0 && clip.height > 0 ? clip.height / clip.width : 16 / 9
  let w = base * (cleanPopSize(sizePct) / 100)
  let h = w * shape
  if (h > height * MAX_HEIGHT_SHARE) {
    h = height * MAX_HEIGHT_SHARE
    w = h / shape
  }
  w = even(w)
  h = even(h)
  const top = height * (TIKTOK_ZONES.top + 0.03)
  const lowest = Math.max(top, height * (1 - TIKTOK_ZONES.bottom - 0.03) - h)
  const y = position === 'top' ? top : position === 'bottom' ? lowest : Math.min(lowest, Math.max(top, height * 0.45 - h / 2))
  return { x: Math.round((width - w) / 2), y: Math.round(y), width: w, height: h, radius: Math.round(Math.min(w, h) * 0.06) }
}

/** One time a clip comes up, on the finished video's timeline. */
export interface PopOccurrence {
  /** Which clip, by its place in the list. */
  clip: number
  at: number
  /** How long it plays: the whole clip. */
  seconds: number
}

/** The occurrence on screen at `t`: the newest one said, which takes over
 *  from one still playing - as a bank picture does. */
export function popAt(occurrences: readonly PopOccurrence[], t: number): PopOccurrence | null {
  let found: PopOccurrence | null = null
  for (const o of occurrences) {
    if (o.at <= t && t < o.at + o.seconds && (!found || o.at > found.at)) found = o
  }
  return found
}

/** Every time each clip comes up, one list. */
export function occurrencesOf(clips: readonly { seconds: number; times: readonly number[] }[]): PopOccurrence[] {
  return clips.flatMap((c, clip) => c.times.map((at) => ({ clip, at, seconds: c.seconds })))
}

/** Steps through a clip's frames as the finished video goes by: one
 *  decoder at a time, opened when an occurrence starts and closed when the
 *  next one takes over. `open` gives the clip's frames in order from its
 *  start. A frame stays up until the next one is due. */
export class PopFrames<F extends { timestamp: number }> {
  private key: string | null = null
  private frames: AsyncIterator<F> | null = null
  private current: F | null = null
  private next: F | null = null
  private ended = false

  private readonly open: (clip: number) => AsyncIterator<F>

  constructor(open: (clip: number) => AsyncIterator<F>) {
    this.open = open
  }

  /** The frame `local` seconds into the clip, for the occurrence `o`. */
  async at(o: PopOccurrence, local: number): Promise<F | null> {
    const key = `${o.clip}@${o.at}`
    if (key !== this.key) {
      await this.stop()
      this.key = key
      this.frames = this.open(o.clip)
    }
    while (!this.ended && this.frames) {
      if (!this.next) {
        const step = await this.frames.next()
        if (step.done) {
          this.ended = true
          break
        }
        this.next = step.value
      }
      // The first frame shows from the start even if it is stamped a little in.
      if (this.current && this.next.timestamp > local + 1e-6) break
      this.current = this.next
      this.next = null
    }
    return this.current
  }

  /** Lets the decoder go. */
  async stop(): Promise<void> {
    const frames = this.frames
    this.frames = null
    this.key = null
    this.current = null
    this.next = null
    this.ended = false
    await frames?.return?.(undefined)
  }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** The clip's frame in its box: rounded corners, a soft shadow so it lifts
 *  off him, and the same spring in and out as the pictures. */
export function drawPop(ctx: Ctx, image: CanvasImageSource, box: PopLayout, { scale, alpha }: { scale: number; alpha: number }): void {
  if (alpha <= 0) return
  const w = box.width * scale
  const h = box.height * scale
  const x = box.x + (box.width - w) / 2
  const y = box.y + (box.height - h) / 2
  const r = box.radius * scale
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = Math.round(box.width * 0.04)
  ctx.shadowOffsetY = Math.round(box.width * 0.01)
  rounded(ctx, x, y, w, h, r)
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  rounded(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.drawImage(image, x, y, w, h)
  ctx.restore()
}
