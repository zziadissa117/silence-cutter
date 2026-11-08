// Single frames of his recording for the plan screen's stills and scrubbing:
// one reader kept open while the screen is up, each frame read already
// shrunk to the still's size, one at a time - asking again while one is
// being read only keeps the newest ask.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'

export class FrameReader {
  private readonly input: Input
  private sink: Promise<CanvasSink | null>
  private busy: Promise<unknown> = Promise.resolve()

  constructor(file: Blob, width: number, height: number) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    this.input = input
    this.sink = (async () => {
      const track = await input.getPrimaryVideoTrack()
      if (!track || !(await track.canDecode())) return null
      return new CanvasSink(track, { width, height, fit: 'cover', poolSize: 2 })
    })().catch(() => null)
  }

  /** The frame shown at `raw` seconds of the recording, or null when this
   *  phone can't read it. */
  frameAt(raw: number): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
    const next = this.busy.then(async () => {
      const sink = await this.sink
      if (!sink) return null
      const frame = await sink.getCanvas(Math.max(0, raw)).catch(() => null)
      return frame?.canvas ?? null
    })
    this.busy = next.catch(() => null)
    return next
  }

  dispose(): void {
    this.input.dispose()
  }
}
