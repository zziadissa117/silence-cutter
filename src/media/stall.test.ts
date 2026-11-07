import { describe, expect, it } from 'vitest'

import { SilenceCutError } from './errors'
import { StoppedEarly, decoderGaveUp, stalledProblem, stoppedEarly } from './recovery'

describe('a decoder that stops handing frames over, with no error', () => {
  it('is caught when the frames end well before the part does', () => {
    // VAZA: the face froze at 2.5 s of a 12 s part.
    expect(stoppedEarly(2.5, 0, 12, 12.7)).toBe(true)
    // The last frame a frame before the end: done.
    expect(stoppedEarly(11.97, 0, 12, 12.7)).toBe(false)
    // The part runs past the video's own frames (its sound is longer): not the decoder.
    expect(stoppedEarly(9.97, 0, 12, 10)).toBe(false)
    // A part shorter than a stall can't stall.
    expect(stoppedEarly(-Infinity, 5, 5.3, 20)).toBe(false)
    // No frame at all in a part that has frames.
    expect(stoppedEarly(-Infinity, 5, 8, 20)).toBe(true)
  })

  it('is picked up again like the decoder giving up, and he is told plainly if it keeps happening', () => {
    expect(decoderGaveUp(new StoppedEarly(2.5))).toBe(true)
    const told = stalledProblem(2.5)
    expect(told).toBeInstanceOf(SilenceCutError)
    expect(told.message).toContain('0:02')
    expect(told.message).toContain("wasn't made")
  })
})
