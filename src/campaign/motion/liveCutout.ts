// Him, cut out of a frame of the render as it is made - for the glass look's
// cards that sit BEHIND him (his ask, 2026-11-08: "there's my face, and then
// there's the glass behind me"). The same cut-out tool as the green screen
// (cutout.ts, MediaPipe's selfie segmenter), run only on the frames where
// such a card is up, on a small copy of the frame; the mask it gives is
// grown back to the frame's size when drawn, which also softens his edge.
//
// If the tool can't run on this phone, the card is drawn over him instead
// and the video is still made.

import { greyToAlpha, maskPixels, WorkingSegmenter } from '../cutout'
import { report as reportProblem } from '../../report'

/** The size the frame is cut at: enough for a soft edge round his head. */
const CUT_WIDTH = 256
const CUT_HEIGHT = 456

export class LiveCutout {
  private readonly segmenter = new WorkingSegmenter()
  private input: OffscreenCanvas | null = null
  private inputCtx: OffscreenCanvasRenderingContext2D | null = null
  private mask: OffscreenCanvas | null = null
  private maskCtx: OffscreenCanvasRenderingContext2D | null = null
  private image: ImageData | null = null
  private last: Float32Array | null = null
  private lastStamp = 0
  private broken = false

  /** His mask for the frame on `frame` (white and solid where he is, see-
   *  through elsewhere), or null when there is none to give. */
  async maskOf(frame: CanvasImageSource): Promise<OffscreenCanvas | null> {
    if (this.broken || typeof OffscreenCanvas === 'undefined') return null
    try {
      if (!this.input) {
        this.input = new OffscreenCanvas(CUT_WIDTH, CUT_HEIGHT)
        this.inputCtx = this.input.getContext('2d')
      }
      if (!this.inputCtx) return null
      this.inputCtx.drawImage(frame, 0, 0, CUT_WIDTH, CUT_HEIGHT)
      // The tool wants its times always going forward.
      this.lastStamp += 33
      const got = await this.segmenter.segment(this.input, this.inputCtx, this.lastStamp)
      if (!got || got.width <= 0) return null
      if (!this.mask || this.mask.width !== got.width || this.mask.height !== got.height) {
        this.mask = new OffscreenCanvas(got.width, got.height)
        this.maskCtx = this.mask.getContext('2d')
        this.image = new ImageData(got.width, got.height)
        this.last = null
      }
      this.last ??= new Float32Array(got.confidence)
      maskPixels(got.confidence, this.last, this.image!.data)
      greyToAlpha(this.image!.data)
      this.maskCtx!.putImageData(this.image!, 0, 0)
      return this.mask
    } catch (error) {
      this.broken = true
      reportProblem({ kind: 'fallback', phase: 'motion cut-out', message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  close(): void {
    this.segmenter.close()
  }
}
