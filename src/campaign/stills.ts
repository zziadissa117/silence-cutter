// A few stills from a finished video, for Claude to write its caption from
// when the video is posted by hand: nothing in it was ever listened to, but
// the hook written on screen and what the video shows are right there in
// the pictures. Small JPEGs - a caption needs to read the text, not see
// every pixel - taken early (where the hook is), then across the video.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'

import { within } from '../media/within'

const WIDTH = 512
const QUALITY = 0.72
const MAX = 4

/** When to take them: the hook's first seconds, then the middle and end. */
export function stillTimes(duration: number): number[] {
  if (!(duration > 0)) return [0]
  const times = [Math.min(0.6, duration * 0.1), Math.min(2.5, duration * 0.3), duration * 0.55, duration * 0.85]
  return times.filter((t, i) => i === 0 || t - times[i - 1] > 0.4).slice(0, MAX)
}

async function jpegOf(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no still'))), 'image/jpeg', QUALITY),
        )
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** Base64 JPEGs, in order. None when the video can't be read in time - the
 *  caption is then written without them. */
export async function stillsOf(file: Blob): Promise<string[]> {
  const read = async () => {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    try {
      const video = await input.getPrimaryVideoTrack()
      if (!video || !(await video.canDecode())) return []
      const sink = new CanvasSink(video, { width: WIDTH, poolSize: 1 })
      const out: string[] = []
      for (const t of stillTimes(await input.computeDuration())) {
        const frame = await sink.getCanvas(t)
        if (frame) out.push(await jpegOf(frame.canvas))
      }
      return out
    } finally {
      input.dispose()
    }
  }
  return within(
    read().catch(() => []),
    20_000,
    [],
  )
}
