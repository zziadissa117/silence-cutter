import { describe, expect, it } from 'vitest'

import { alignToAudio, fillerWordRanges, isFillerWord, stutterRanges } from './fillerWords'
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

describe('isFillerWord', () => {
  it('knows every spelling the model uses, whatever the case and punctuation', () => {
    for (const text of [' um,', 'Um...', ' uh', 'Uhh,', ' UHM', ' er,', ' erm', ' Hmm.', ' ah,']) expect(isFillerWord(text), text).toBe(true)
  })
  it('leaves words that only start like one, and sounds said on purpose', () => {
    for (const text of [' umbrella', ' her', ' mm-hmm', ' oh', ' eh?', ' a', ' I']) expect(isFillerWord(text), text).toBe(false)
  })
})

/** "least" running straight into "um" and "um" straight into "you" - no
 *  pause anywhere, the ordinary way an "um" is said mid-sentence. The
 *  curve is the real one from a phone call (fixtures/ums-call.json, 24.2 s
 *  on), moved to start at 0. */
const connected = curve([
  [0, 0.36, -27],
  [0.36, 0.4, -27],
  [0.4, 0.48, -30],
  [0.48, 0.62, -33],
  [0.62, 0.66, -39],
  [0.66, 0.76, -46],
  [0.76, 0.78, -42],
  [0.78, 1.2, -37],
])
const connectedWords = [
  { text: ' least,', start: 0, end: 0.36 },
  { text: ' um,', start: 0.36, end: 0.76 },
  { text: ' you', start: 0.76, end: 1.2 },
]

describe('fillerWordRanges with exact times', () => {
  it('cuts an "um" said straight on from the word before it, right up against both words', () => {
    const [cut] = fillerWordRanges(connectedWords, connected, { quietBelowDb: -50, exact: true })
    expect(cut).toBeDefined()
    expect(cut.start).toBeGreaterThanOrEqual(0.36)
    expect(cut.start).toBeLessThanOrEqual(0.44)
    expect(cut.end).toBeGreaterThanOrEqual(0.68)
    expect(cut.end).toBeLessThanOrEqual(0.76)
  })

  it('is the same "um" the rough times leave in, for want of a pause', () => {
    expect(fillerWordRanges(connectedWords, connected, { quietBelowDb: -50 })).toEqual([])
  })

  it('takes the pause either side along with the "um"', () => {
    const [cut] = fillerWordRanges(spacedWords, spacedOut, { exact: true })
    expect(cut.start).toBeCloseTo(0.64, 1)
    expect(cut.end).toBeCloseTo(1.56, 1)
  })

  it('still refuses a cut that would hold a second, separate sound', () => {
    // "um" then a real word the model missed, then "then".
    const levels = curve([
      [0, 0.6, -12],
      [0.6, 0.7, -60],
      [0.7, 1.0, -20],
      [1.0, 1.1, -60],
      [1.1, 1.5, -20],
      [1.5, 1.6, -60],
      [1.6, 2.4, -12],
    ])
    const words = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' um', start: 0.7, end: 1.0 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    expect(fillerWordRanges(words, levels, { exact: true })).toEqual([])
  })

  it('leaves a heard "um" marked as a real word (the letters said so)', () => {
    const words = connectedWords.map((w, i) => (i === 1 ? { ...w, keep: true } : w))
    expect(fillerWordRanges(words, connected, { quietBelowDb: -50, exact: true })).toEqual([])
  })

  it('cuts a stumble between its neighbours the same way', () => {
    const levels = curve([
      [0, 0.4, -12],
      [0.4, 0.6, -14],
      [0.6, 0.8, -14],
      [0.8, 1.4, -12],
    ])
    const words = [
      { text: ' so', start: 0, end: 0.4 },
      { text: ' I', start: 0.4, end: 0.6 },
      { text: ' I', start: 0.6, end: 0.8 },
      { text: ' want', start: 0.8, end: 1.4 },
    ]
    expect(stutterRanges(words, levels, { exact: true })).toHaveLength(1)
    expect(stutterRanges(words, levels, {})).toEqual([])
  })
})
