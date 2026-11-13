// A 9:16 clip with a wide video already made into it - black bands above and
// below - is told from its picture, to be left as it is (his ask, 2026-11-13).

import { describe, expect, it } from 'vitest'

import { hasBlackBands } from './blackBands'

const W = 18
const H = 32
/** A frame: black from 0 to `top` rows and from `bottom` down, grey `level` between. */
function frame(top: number, bottom: number, level = 128, edge = 0): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = y < top || y >= bottom ? edge : level
      rgba.set([v, v, v, 255], (y * W + x) * 4)
    }
  return rgba
}

describe('black bands made into a clip', () => {
  it('sees a wide video put in 9:16', () => {
    // 16:9 in 9:16: the picture is about the middle third.
    expect(hasBlackBands(frame(11, 21), W, H)).toBe(true)
    // The black of a video file is not quite 0.
    expect(hasBlackBands(frame(11, 21, 128, 16), W, H)).toBe(true)
  })

  it('a phone video filling the frame has none', () => {
    expect(hasBlackBands(frame(0, H), W, H)).toBe(false)
  })

  it("can't tell from a black frame (a fade in) - waits for one that shows something", () => {
    expect(hasBlackBands(frame(0, H, 5), W, H)).toBeNull()
  })
})
