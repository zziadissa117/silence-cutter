// Pictures and videos he puts on a product step, where he wants them (his
// ask, 2026-11-13: "I want to also add some overlays that are going to pop
// up every single time there is that exact format ... a video or a picture
// from the video bank, from whatever"). Placed on the step words screen
// (StepTexts.tsx) like the words; in every video, each pops in as its step
// comes on - a picture stays for the step, a video plays muted to its end.
// The boxes are worked out here (tested without a decoder); montageRender.ts
// draws them.

import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny'

import { firstShown } from './clipParts'
import { logoPop } from './effects'

/** Where one sits: its middle, as fractions of the frame, and its width as a
 *  share of the frame's width. */
export interface OverlayPlace {
  x: number
  y: number
  width: number
}

/** How small and big one can be made, as a share of the frame's width. */
export const OVERLAY_WIDTH = { min: 0.15, max: 1, start: 0.5, step: 0.05 } as const

/** Where it starts when added: the middle, a little above. */
export const OVERLAY_START: OverlayPlace = { x: 0.5, y: 0.42, width: OVERLAY_WIDTH.start }

/** Its box on a `width`×`height` frame for a picture or video `shape`
 *  (height over width), never taller than the frame. */
export function overlayBox(place: OverlayPlace, shape: number, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const s = Number.isFinite(shape) && shape > 0 ? shape : 1
  let w = Math.max(2, Math.min(OVERLAY_WIDTH.max, Math.max(OVERLAY_WIDTH.min, place.width)) * width)
  let h = w * s
  if (h > height) {
    h = height
    w = h / s
  }
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { x: Math.round(place.x * width - w / 2), y: Math.round(place.y * height - h / 2), width: even(w), height: even(h) }
}

/** How an overlay looks `since` seconds after its step came on, with `left`
 *  seconds until it goes: the pictures' spring in and fade out. */
export const overlayPop = logoPop

/** One overlay ready to draw: a picture, or a video's frames in order. */
export interface ReadyOverlay {
  box: { x: number; y: number; width: number; height: number }
  /** A video's length: it goes when it ends. Infinity for a picture. */
  seconds: number
  /** The picture, or the video frame `local` seconds in. */
  frameAt(local: number): Promise<CanvasImageSource | null>
  close(): Promise<void>
}

/** A picture or video, decoded at its box's size. Null when this browser
 *  can't read it - left out, never the video. */
export async function readyOverlay(file: Blob, type: string, place: OverlayPlace, width: number, height: number): Promise<ReadyOverlay | null> {
  if (type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file).catch(() => null)
    if (!bitmap) return null
    const box = overlayBox(place, bitmap.height / bitmap.width, width, height)
    return { box, seconds: Infinity, frameAt: async () => bitmap, close: async () => bitmap.close() }
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) {
      input.dispose()
      return null
    }
    const first = await firstShown(track)
    const [w, h, end] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight(), track.computeDuration()])
    const box = overlayBox(place, h / w, width, height)
    const seconds = Math.max(0.1, end - first)
    const sink = new CanvasSink(track, { width: box.width, height: box.height, fit: 'fill', poolSize: 3 })
    let frames: AsyncGenerator<WrappedCanvas> | null = null
    let current: WrappedCanvas | null = null
    let next: WrappedCanvas | null = null
    let ended = false
    return {
      box,
      seconds,
      async frameAt(local: number) {
        frames ??= sink.canvases(first, first + seconds)
        while (!ended) {
          if (!next) {
            const step = await frames.next()
            if (step.done) {
              ended = true
              break
            }
            next = step.value
          }
          // The first frame shows from the start, even stamped a little in.
          if (current && next.timestamp - first > local + 1e-6) break
          current = next
          next = null
        }
        return current?.canvas ?? null
      },
      async close() {
        await frames?.return(undefined).catch(() => {})
        input.dispose()
      },
    }
  } catch {
    input.dispose()
    return null
  }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** One overlay on the frame, `since` seconds after its step came on, with
 *  `left` seconds of its step to go: popped in, a soft shadow under it. */
export async function drawOverlay(ctx: Ctx, overlay: ReadyOverlay, since: number, left: number): Promise<void> {
  const until = Math.min(left, overlay.seconds - since)
  const { scale, alpha } = overlayPop(since, until)
  if (alpha <= 0) return
  const image = await overlay.frameAt(Math.max(0, since))
  if (!image) return
  const { box } = overlay
  const w = box.width * scale
  const h = box.height * scale
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  ctx.shadowBlur = Math.round(box.width * 0.03)
  ctx.drawImage(image, box.x + (box.width - w) / 2, box.y + (box.height - h) / 2, w, h)
  ctx.restore()
}
