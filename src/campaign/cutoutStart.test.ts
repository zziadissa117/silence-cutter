// The cut-out tool on his iPhone failed on its first frame with "Cannot read
// properties of undefined (reading 'activeTexture')": it must then try the
// next way, and say so - not fail the green screen video.
import { describe, expect, it, vi } from 'vitest'

const made: { delegate: string; canvas: boolean }[] = []

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  ImageSegmenter: {
    createFromOptions: vi.fn(async (_engine: unknown, options: { baseOptions: { delegate: string }; canvas?: unknown }) => {
      made.push({ delegate: options.baseOptions.delegate, canvas: Boolean(options.canvas) })
      const gpu = options.baseOptions.delegate === 'GPU'
      return {
        segmentForVideo: (_frame: unknown, _t: number, done: (r: unknown) => void) => {
          if (gpu) throw new TypeError("Cannot read properties of undefined (reading 'activeTexture')")
          done({ confidenceMasks: [{ width: 2, height: 2, getAsFloat32Array: () => new Float32Array([1, 0, 0, 1]) }] })
        },
        close: () => {},
      }
    }),
  },
}))

import { WorkingSegmenter } from './cutout'

describe('the cut-out tool', () => {
  it("moves on to the next way when the first can't run on a real frame", async () => {
    const frame = { width: 2, height: 2 } as OffscreenCanvas
    const ctx = { getImageData: () => new ImageData(2, 2) } as unknown as OffscreenCanvasRenderingContext2D
    const segmenter = new WorkingSegmenter()
    const got = await segmenter.segment(frame, ctx, 1)
    expect(got?.width).toBe(2)
    expect(made.map((m) => m.delegate)).toEqual(['GPU', 'CPU'])
    expect(made.every((m) => m.canvas)).toBe(true)
    expect(segmenter.fellBack).toBe(true)
    expect(segmenter.describe()).toContain('activeTexture')
    // Afterwards it keeps the way that works.
    await segmenter.segment(frame, ctx, 2)
    expect(made).toHaveLength(2)
  })
})
