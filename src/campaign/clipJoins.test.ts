// Clips written one after another (a batch's reaction then its steps): the
// sound runs on with no hole at the change of clip, where the music used to
// drop out for a moment - a pop at every change.

import { describe, expect, it, vi } from 'vitest'

/** Frames at 30 a second, from 0 to the clip's end. */
const FPS = 30
let clipFrames: number[] = []

vi.mock('mediabunny', async (original) => {
  const real = await original<Record<string, unknown>>()
  const frame = (timestamp: number) => ({ timestamp, duration: 1 / FPS, close() {}, clone() { return frame(timestamp) } })
  return {
    ...real,
    EncodedPacketSink: class {
      async getKeyPacket() {
        return { timestamp: 0 }
      }
    },
    VideoSampleSink: class {
      async *samples(from: number, to: number) {
        for (const t of clipFrames) if (t + 1 / FPS > from && t < to) yield frame(t)
      }
    },
  }
})

import { writeWhole, type Clip } from './clipParts'
import { contiguousAudio, forwardOnly } from '../media/forwardOnly'

const RATE = 48000

describe('clips written one after another', () => {
  it('leave no hole in the sound where one clip meets the next', async () => {
    // 2 s of picture; each clip plays a window that ends between two frames.
    clipFrames = Array.from({ length: 2 * FPS }, (_, i) => i / FPS)
    const clip = { video: {}, audio: null, width: 1080, height: 1920, first: 0, duration: 2 } as unknown as Clip
    const videoClock = forwardOnly()
    const audioClock = contiguousAudio()
    const sound: { start: number; end: number }[] = []
    let at = 0
    for (const window of [{ start: 0.1, end: 1.01 }, { start: 0.2, end: 0.75 }, { start: 0.5, end: 1.333 }]) {
      at = await writeWhole(clip, at, {
        window,
        rate: RATE,
        channels: 2,
        videoClock,
        audioClock,
        maxRecoveries: 0,
        onFrame: async () => {},
        onSound: async (planes, timestamp) => {
          sound.push({ start: timestamp, end: timestamp + planes[0].length / RATE })
        },
      })
    }
    // Each piece of sound starts where the one before it ended...
    for (let i = 1; i < sound.length; i++) expect(Math.abs(sound[i].start - sound[i - 1].end)).toBeLessThan(1 / RATE + 1e-9)
    // ...and runs right up to the end of the picture.
    expect(Math.abs(sound.at(-1)!.end - at)).toBeLessThan(1 / RATE + 1e-9)
  })
})
