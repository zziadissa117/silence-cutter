import { describe, expect, it } from 'vitest'

import { alignToAudio, fillerWordRanges } from './fillerWords'
import type { Level } from './silenceMath'

/** A level curve at 20ms steps from [fromSec, toSec, dB] spans. */
function curve(spans: Array<[from: number, to: number, db: number]>): Level[] {
  const levels: Level[] = []
  for (const [from, to, db] of spans) {
    for (let t = from; t < to - 1e-9; t += 0.02) levels.push({ time: Number(t.toFixed(3)), db })
  }
  return levels
}

/** "so" ... gap ... "um" ... gap ... "then" - the ordinary case. */
const spacedOut = curve([
  [0, 0.6, -12],
  [0.6, 0.9, -60],
  [0.9, 1.3, -20],
  [1.3, 1.6, -60],
  [1.6, 2.4, -12],
])

const spacedWords = [
  { text: ' so', start: 0, end: 0.6 },
  { text: ' um', start: 0.9, end: 1.3 },
  { text: ' then', start: 1.6, end: 2.4 },
]

describe('fillerWordRanges', () => {
  it('cuts the filler along with the dead air around it', () => {
    const [range] = fillerWordRanges(spacedWords, spacedOut, { guardSec: 0.04 })
    expect(range).toBeDefined()
    // Opened out into the gaps either side, not clamped to the word itself.
    expect(range.start).toBeLessThan(0.9)
    expect(range.end).toBeGreaterThan(1.3)
  })

  it('never reaches into the word before or the word after', () => {
    const [range] = fillerWordRanges(spacedWords, spacedOut, { guardSec: 0.04 })
    // "so" ends at 0.6 and "then" starts at 1.6. The cut has to stay inside.
    expect(range.start).toBeGreaterThanOrEqual(0.6)
    expect(range.end).toBeLessThanOrEqual(1.6)
  })

  it('leaves real words alone entirely', () => {
    const noFillers = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    expect(fillerWordRanges(noFillers, spacedOut, { guardSec: 0.04 })).toEqual([])
  })

  it('refuses when the filler is reported on top of the next word', () => {
    // This is the "connections" case: the recogniser puts the filler's end
    // inside the following word, leaving no corridor at all.
    const crowded = [
      { text: ' and', start: 0, end: 0.5 },
      { text: ' uh', start: 0.5, end: 0.54 },
      { text: ' connections', start: 0.5, end: 1.2 },
    ]
    expect(fillerWordRanges(crowded, spacedOut, { guardSec: 0.04 })).toEqual([])
  })

  it('does not let a cut swallow a short word next to the filler', () => {
    // "And, uh, my" - all three tight together. Whatever comes back must not
    // cover "And" or "my".
    const tight = [
      { text: ' And', start: 3.84, end: 3.92 },
      { text: ' uh', start: 4.0, end: 4.08 },
      { text: ' my', start: 4.2, end: 4.54 },
    ]
    const levels = curve([
      [3.8, 3.94, -14],
      [3.94, 4.0, -55],
      [4.0, 4.1, -20],
      [4.1, 4.2, -55],
      [4.2, 4.6, -14],
    ])
    for (const range of fillerWordRanges(tight, levels, { guardSec: 0.04 })) {
      expect(range.start).toBeGreaterThanOrEqual(3.92)
      expect(range.end).toBeLessThanOrEqual(4.2)
    }
  })

  it('treats a run of fillers as one corridor between the real words', () => {
    const run = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' um', start: 0.9, end: 1.1 },
      { text: ' uh', start: 1.15, end: 1.3 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    for (const range of fillerWordRanges(run, spacedOut, { guardSec: 0.04 })) {
      expect(range.start).toBeGreaterThanOrEqual(0.6)
      expect(range.end).toBeLessThanOrEqual(1.6)
    }
  })

  it('is case-insensitive and ignores punctuation', () => {
    const upper = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' Um,', start: 0.9, end: 1.3 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    expect(fillerWordRanges(upper, spacedOut, { guardSec: 0.04 })).toHaveLength(1)
  })

  it('leaves a real word that merely starts like a filler', () => {
    const umbrella = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' umbrella', start: 0.9, end: 1.3 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    expect(fillerWordRanges(umbrella, spacedOut, { guardSec: 0.04 })).toEqual([])
  })

  it('leaves the um in when a mistimed cut would also take the start of the next word', () => {
    // The model says "um" runs to 1.5 and "then" starts at 1.6, but in the
    // audio "then" really starts at 1.2 with no pause after the "um".
    const words = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' um', start: 0.9, end: 1.5 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    const levels = curve([
      [0, 0.6, -12],
      [0.6, 0.9, -60],
      [0.9, 2.4, -15],
    ])
    expect(fillerWordRanges(words, levels, { guardSec: 0.04 })).toEqual([])
  })

  it('leaves the um in when the cut would hold a second, separate sound', () => {
    // Quiet at both edges, but two sounds inside where the model heard one
    // "um" - one of them is a real word it mistimed.
    const words = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' um', start: 0.9, end: 1.4 },
      { text: ' then', start: 1.7, end: 2.4 },
    ]
    const levels = curve([
      [0, 0.6, -12],
      [0.6, 0.9, -60],
      [0.9, 1.1, -20],
      [1.1, 1.2, -60],
      [1.2, 1.4, -14],
      [1.4, 1.7, -60],
      [1.7, 2.4, -12],
    ])
    expect(fillerWordRanges(words, levels, { guardSec: 0.04 })).toEqual([])
  })

  it('treats quiet as the same threshold the silence cut uses', () => {
    // A room whose "quiet" sits at -30 dB: with the silence level set to -25
    // the um is cut, with the default -35 the edges don't count as quiet.
    const words = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' um', start: 0.9, end: 1.3 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    const noisyRoom = curve([
      [0, 0.6, -12],
      [0.6, 0.9, -30],
      [0.9, 1.3, -20],
      [1.3, 1.6, -30],
      [1.6, 2.4, -12],
    ])
    expect(fillerWordRanges(words, noisyRoom, { guardSec: 0.04 })).toEqual([])
    expect(fillerWordRanges(words, noisyRoom, { guardSec: 0.04, quietBelowDb: -25 })).toHaveLength(1)
  })
})


describe('alignToAudio', () => {
  // Sound at 0-0.6, 0.9-1.3 and 1.6-2.4, silence between.
  const exact = [
    { text: ' so', start: 0, end: 0.6 },
    { text: ' um', start: 0.9, end: 1.3 },
    { text: ' then', start: 1.6, end: 2.4 },
  ]

  it('pulls words that arrived late back onto the sound', () => {
    const late = exact.map((w) => ({ ...w, start: w.start + 0.3, end: w.end + 0.3 }))
    const aligned = alignToAudio(late, spacedOut)
    aligned.forEach((w, i) => {
      expect(w.start).toBeCloseTo(exact[i].start, 1)
      expect(w.end).toBeCloseTo(exact[i].end, 1)
    })
  })

  it('leaves words that already sit on the sound where they are', () => {
    expect(alignToAudio(exact, spacedOut)).toEqual(exact)
  })

  it('does nothing when the audio gives no clue, like a room that is loud throughout', () => {
    const late = exact.map((w) => ({ ...w, start: w.start + 0.3, end: w.end + 0.3 }))
    const allLoud = curve([[0, 3, -10]])
    expect(alignToAudio(late, allLoud)).toEqual(late)
  })

  it('lets a late um be cut once the words are lined up', () => {
    // Late by 0.3s, "so" appears to run into the "um" and no cut is safe;
    // lined up, the pause before the "um" is plain to see.
    const late = exact.map((w) => ({ ...w, start: w.start + 0.3, end: w.end + 0.3 }))
    expect(fillerWordRanges(alignToAudio(late, spacedOut), spacedOut)).toHaveLength(1)
  })
})
