// The little pictures along the edit screen's clip bar, as in TikTok (his
// ask, 2026-11-10): small frames of the recording every `step` seconds, read
// once when the editor opens and kept as small JPEGs. They come in a few at a
// time, so the bar fills while he already works; one the phone can't read
// leaves its tile dark.

import { useEffect, useState } from 'react'
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'

/** A frame's size: tall and narrow, like the tiles they fill. */
export const THUMB = { width: 40, height: 56 } as const
/** No more than this many frames for one recording. */
const MOST = 240

export interface Filmstrip {
  /** Seconds between frames. */
  step: number
  /** Each frame as an image URL, by its number (frame n is at n * step);
   *  null while it hasn't come. */
  frames: (string | null)[]
}

/** How far apart the frames are for a recording `duration` long: a frame
 *  every quarter second at most, MOST in all. */
export function stepFor(duration: number): number {
  return Math.max(0.25, Math.ceil((duration / MOST) * 100) / 100)
}

/** The frame nearest raw moment `t`. */
export function frameAt(strip: Filmstrip, t: number): string | null {
  const n = Math.min(strip.frames.length - 1, Math.max(0, Math.round(t / strip.step)))
  return strip.frames[n] ?? null
}

export function useFilmstrip(file: Blob | null, duration: number): Filmstrip {
  const step = stepFor(duration)
  const count = Math.max(1, Math.floor(duration / step) + 1)
  const [frames, setFrames] = useState<(string | null)[]>(() => Array.from({ length: count }, () => null))
  useEffect(() => {
    setFrames(Array.from({ length: count }, () => null))
    if (!file || typeof document === 'undefined') return
    let alive = true
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    void (async () => {
      const track = await input.getPrimaryVideoTrack()
      if (!track || !(await track.canDecode())) return
      // Twice the size on screen, for a sharp tile on a phone's screen.
      const sink = new CanvasSink(track, { width: THUMB.width * 2, height: THUMB.height * 2, fit: 'cover', poolSize: 0 })
      const first = Math.max(0, await track.getFirstTimestamp())
      const times = Array.from({ length: count }, (_, n) => Math.max(first, n * step))
      const out = document.createElement('canvas')
      out.width = THUMB.width * 2
      out.height = THUMB.height * 2
      const ctx = out.getContext('2d')
      if (!ctx) return
      let got: (string | null)[] = Array.from({ length: count }, () => null)
      let n = 0
      for await (const wrapped of sink.canvasesAtTimestamps(times)) {
        if (!alive) return
        if (wrapped) {
          ctx.drawImage(wrapped.canvas as CanvasImageSource, 0, 0)
          got[n] = out.toDataURL('image/jpeg', 0.6)
        }
        n++
        // A few at a time: each update draws the bar again.
        if (n % 12 === 0 || n === count) {
          setFrames(got)
          got = [...got]
        }
      }
    })()
      .catch(() => {
        // Left dark: the bar works the same without its pictures.
      })
      .finally(() => input.dispose())
    return () => {
      alive = false
    }
  }, [file, count, step])
  return { step, frames }
}
