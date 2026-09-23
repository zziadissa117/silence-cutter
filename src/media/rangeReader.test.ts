import { describe, expect, it } from 'vitest'

import { RangeReader } from './rangeReader'

/** mediabunny's `samples(start, end)`, reduced to timestamps - the same
 *  decisions as the decoder callback in mediaSamplesInRange (media-sink.js):
 *  hold the latest frame before `start`, release it once a frame after
 *  `start` arrives (or drop it if one lands exactly on `start`), keep every
 *  frame before `end`, and if nothing was released by the end, release the
 *  held one. The per-range calls the cut used to make are this. */
function samplesInRange(all: number[], start: number, end: number): number[] {
  const out: number[] = []
  let firstQueued = false
  let last: number | null = null
  for (const t of all) {
    if (t >= end) break
    if (last !== null && t > start) {
      out.push(last)
      firstQueued = true
    }
    if (t >= start) {
      out.push(t)
      firstQueued = true
    }
    last = firstQueued ? null : t
  }
  if (!firstQueued && last !== null) out.push(last)
  return out
}

class FakeSample {
  static open = 0
  closed = false
  readonly timestamp: number
  constructor(timestamp: number) {
    this.timestamp = timestamp
    FakeSample.open++
  }
  close() {
    if (this.closed) throw new Error(`closed twice: ${this.timestamp}`)
    this.closed = true
    FakeSample.open--
  }
  clone() {
    return new FakeSample(this.timestamp)
  }
}

async function* stream(timestamps: number[]) {
  for (const t of timestamps) yield new FakeSample(t)
}

/** The new way: one pass over [first start, last end), split by the reader. */
async function viaReader(all: number[], ranges: Array<[number, number]>): Promise<number[][]> {
  const single = samplesInRange(all, ranges[0][0], ranges[ranges.length - 1][1])
  const reader = new RangeReader(stream(single))
  const out: number[][] = []
  for (const [start, end] of ranges) {
    const got: number[] = []
    for await (const sample of reader.range(start, end)) {
      got.push(sample.timestamp)
      sample.close()
    }
    out.push(got)
  }
  await reader.dispose()
  return out
}

const FRAME = 1 / 30
const frames = (seconds: number) => Array.from({ length: Math.round(seconds / FRAME) }, (_, i) => i * FRAME)

describe('reading every kept range from one decoder', () => {
  it('gives each range exactly the frames its own decoder used to', async () => {
    const all = frames(10)
    const ranges: Array<[number, number]> = [
      [0.5, 2.1],
      [3.0, 3.4],
      [5.017, 7.2],
    ]
    expect(await viaReader(all, ranges)).toEqual(ranges.map(([s, e]) => samplesInRange(all, s, e)))
  })

  it('puts a frame in both ranges when the gap between them is shorter than it', async () => {
    const all = frames(4)
    // A 10ms cut - an "um" boundary - inside one 33ms frame.
    const ranges: Array<[number, number]> = [
      [0, 1.005],
      [1.015, 2],
    ]
    const got = await viaReader(all, ranges)
    expect(got).toEqual(ranges.map(([s, e]) => samplesInRange(all, s, e)))
    expect(got[0].at(-1)).toBe(got[1][0])
  })

  it('handles a range shorter than a frame, and one starting exactly on a frame', async () => {
    const all = frames(3)
    const ranges: Array<[number, number]> = [
      [0.2, 0.21],
      [10 * FRAME, 20 * FRAME],
      [1.5, 1.51],
    ]
    expect(await viaReader(all, ranges)).toEqual(ranges.map(([s, e]) => samplesInRange(all, s, e)))
  })

  it('matches on hundreds of random cuts, and leaves nothing open', async () => {
    let seed = 7
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let run = 0; run < 400; run++) {
      // Frames with a little jitter, as real timestamps have.
      const all = frames(20).map((t, i) => (i === 0 ? 0 : t + (random() - 0.5) * 0.002))
      const ranges: Array<[number, number]> = []
      let at = random() * 0.5
      while (at < 19) {
        const length = random() < 0.2 ? random() * 0.03 : 0.05 + random() * 2
        const gap = random() < 0.3 ? random() * 0.03 : 0.05 + random() * 1.5
        // Sometimes exactly on a frame.
        const start = random() < 0.15 ? all[Math.min(all.length - 1, Math.round(at / FRAME))] : at
        ranges.push([start, Math.min(20, start + length)])
        at = start + length + gap
      }
      FakeSample.open = 0
      const got = await viaReader(all, ranges)
      expect(got).toEqual(ranges.map(([s, e]) => samplesInRange(all, s, e)))
      expect(FakeSample.open).toBe(0)
    }
  })

  it('never opens a range on a frame from before the key frame its decoder would have started at', async () => {
    // A range starting a hair before a key frame: mediabunny rounds the seek
    // onto the key frame, so the old per-range decoder never saw the frame
    // before it and the range began cleanly on the key frame.
    const all = frames(4)
    const key = 60 * FRAME
    const single = samplesInRange(all, 0, 4)
    const reader = new RangeReader(stream(single))
    const skipped: number[] = []
    for await (const s of reader.range(0, 1)) s.close()
    for await (const s of reader.range(key - 1e-9, 3, key)) {
      skipped.push(s.timestamp)
      s.close()
    }
    await reader.dispose()
    expect(skipped[0]).toBe(key)
  })
})
