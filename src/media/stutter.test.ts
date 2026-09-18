import { describe, expect, it } from 'vitest'

import { stutterRanges } from './fillerWords'
import type { Level } from './silenceMath'

/** A level curve at 20ms steps from [fromSec, toSec, dB] spans. */
function curve(spans: Array<[from: number, to: number, db: number]>): Level[] {
  const levels: Level[] = []
  for (const [from, to, db] of spans) {
    for (let t = from; t < to - 1e-9; t += 0.02) levels.push({ time: Number(t.toFixed(3)), db })
  }
  return levels
}

/** Quiet gaps between every word, so snapping always has somewhere to land. */
const roomy = curve([
  [0, 0.3, -12],
  [0.3, 0.4, -60],
  [0.4, 0.6, -12],
  [0.6, 0.7, -60],
  [0.7, 0.9, -12],
  [0.9, 1.0, -60],
  [1.0, 2.0, -12],
])

describe('stutterRanges', () => {
  it('cuts the earlier attempts and keeps the last one', () => {
    // "I - I - I want"
    const words = [
      { text: ' I', start: 0.0, end: 0.3 },
      { text: ' I', start: 0.4, end: 0.6 },
      { text: ' I', start: 0.7, end: 0.9 },
      { text: ' want', start: 1.0, end: 1.4 },
    ]
    const [range] = stutterRanges(words, roomy, { guardSec: 0.04 })
    expect(range).toBeDefined()
    // Everything up to the final "I" goes; the final one survives.
    expect(range.start).toBeLessThanOrEqual(0.3)
    expect(range.end).toBeLessThanOrEqual(0.7)
  })

  it('never reaches into the repeat it is keeping', () => {
    const words = [
      { text: ' the', start: 0.0, end: 0.3 },
      { text: ' the', start: 0.4, end: 0.6 },
      { text: ' point', start: 0.7, end: 1.2 },
    ]
    for (const range of stutterRanges(words, roomy, { guardSec: 0.04 })) {
      expect(range.end).toBeLessThanOrEqual(0.4)
    }
  })

  it('leaves deliberate repetition of a real word alone', () => {
    // "very very good" is emphasis, not a stumble - and "very" is not in the
    // small set of words a stutter lands on.
    const words = [
      { text: ' very', start: 0.0, end: 0.3 },
      { text: ' very', start: 0.4, end: 0.6 },
      { text: ' good', start: 0.7, end: 1.2 },
    ]
    expect(stutterRanges(words, roomy, { guardSec: 0.04 })).toEqual([])
  })

  it('leaves a word said twice far apart alone', () => {
    // Same small word, but a second apart - that is just a sentence.
    const words = [
      { text: ' the', start: 0.0, end: 0.3 },
      { text: ' thing', start: 0.4, end: 0.9 },
      { text: ' the', start: 1.6, end: 1.9 },
    ]
    expect(stutterRanges(words, roomy, { guardSec: 0.04 })).toEqual([])
  })

  it('leaves a long, drawn-out repeat alone', () => {
    // Held that long, it is being said for weight, not stumbled over.
    const words = [
      { text: ' so', start: 0.0, end: 0.9 },
      { text: ' so', start: 1.0, end: 1.9 },
      { text: ' good', start: 2.0, end: 2.4 },
    ]
    const longCurve = curve([
      [0, 0.9, -12],
      [0.9, 1.0, -60],
      [1.0, 1.9, -12],
      [1.9, 2.0, -60],
      [2.0, 2.4, -12],
    ])
    expect(stutterRanges(words, longCurve, { guardSec: 0.04 })).toEqual([])
  })

  it('handles a run of three and still keeps only the last', () => {
    const words = [
      { text: ' and', start: 0.0, end: 0.3 },
      { text: ' and', start: 0.4, end: 0.6 },
      { text: ' and', start: 0.7, end: 0.9 },
      { text: ' then', start: 1.0, end: 1.4 },
    ]
    const ranges = stutterRanges(words, roomy, { guardSec: 0.04 })
    expect(ranges).toHaveLength(1)
    expect(ranges[0].end).toBeLessThanOrEqual(0.7)
  })

  it('finds nothing in a clean sentence', () => {
    const words = [
      { text: ' I', start: 0.0, end: 0.3 },
      { text: ' really', start: 0.4, end: 0.6 },
      { text: ' mean', start: 0.7, end: 0.9 },
      { text: ' it', start: 1.0, end: 1.4 },
    ]
    expect(stutterRanges(words, roomy, { guardSec: 0.04 })).toEqual([])
  })

  it('leaves the stumble in when the kept word follows with no pause', () => {
    // "the the point", but the second "the" runs straight on from the first
    // with no quiet between - nowhere safe to end the cut.
    const words = [
      { text: ' so', start: 0.0, end: 0.3 },
      { text: ' the', start: 0.4, end: 0.6 },
      { text: ' the', start: 0.62, end: 0.8 },
      { text: ' point', start: 0.9, end: 1.2 },
    ]
    const joined = curve([
      [0, 0.3, -12],
      [0.3, 0.4, -60],
      [0.4, 1.2, -12],
    ])
    expect(stutterRanges(words, joined, { guardSec: 0.04 })).toEqual([])
  })
})

