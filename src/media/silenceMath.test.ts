import { describe, expect, it } from 'vitest'

import {
  BALANCED_SETTINGS,
  PRESETS,
  findSilentRanges,
  keepRanges,
  mergeRanges,
  HEAD_LEEWAY_SEC,
  TAIL_LEEWAY_SEC,
  snapCutToQuiet,
  speechWindows,
  totalDuration,
  type Level,
} from './silenceMath'

/** Builds a level curve: loud for `loudSec`, then quiet for `quietSec`, repeated. */
function pattern(pairs: Array<[loudSec: number, quietSec: number]>, stepSec = 0.05): Level[] {
  const levels: Level[] = []
  let t = 0
  for (const [loudSec, quietSec] of pairs) {
    for (let i = 0; i < loudSec / stepSec; i++, t += stepSec) levels.push({ time: t, db: -10 })
    for (let i = 0; i < quietSec / stepSec; i++, t += stepSec) levels.push({ time: t, db: -50 })
  }
  return levels
}

describe('findSilentRanges', () => {
  it('finds a pause long enough to count', () => {
    const levels = pattern([[1, 1]])
    const silences = findSilentRanges(levels, BALANCED_SETTINGS)
    expect(silences).toHaveLength(1)
    expect(silences[0].start).toBeCloseTo(1, 1)
    expect(silences[0].end).toBeCloseTo(2, 1)
  })

  it('ignores a pause shorter than the minimum', () => {
    // Balanced settings cut only pauses of 0.4s or more.
    const levels = pattern([[1, 0.2]])
    expect(findSilentRanges(levels, BALANCED_SETTINGS)).toHaveLength(0)
  })

  it('closes a silence that runs to the end of the file', () => {
    const levels = pattern([[1, 1]])
    const silences = findSilentRanges(levels, BALANCED_SETTINGS)
    expect(silences.at(-1)?.end).toBeCloseTo(2, 1)
  })

  it('finds every pause in a longer clip, in order', () => {
    const levels = pattern([
      [1, 0.5],
      [2, 1],
      [0.5, 0.8],
    ])
    const silences = findSilentRanges(levels, BALANCED_SETTINGS)
    expect(silences).toHaveLength(3)
    expect(silences[0].start).toBeCloseTo(1, 1)
    expect(silences[1].start).toBeCloseTo(3.5, 1)
    expect(silences[2].start).toBeCloseTo(5, 1)
  })
})

describe('keepRanges', () => {
  it('keeps the whole clip when nothing is silent', () => {
    expect(keepRanges([], 10, 0.12)).toEqual([{ start: 0, end: 10 }])
  })

  it('cuts a silent middle section, padding both sides', () => {
    const kept = keepRanges([{ start: 4, end: 6 }], 10, 0.12)
    expect(kept).toEqual([
      { start: 0, end: 4.12 },
      { start: 5.88, end: 10 },
    ])
  })

  it('leaves room before the first word and after the last', () => {
    // Silence at the very start/end used to be cut flush, which opened the
    // video on the first syllable and ended it on the last. Both ends now
    // keep a short breath, whatever the padding is.
    const kept = keepRanges(
      [
        { start: 0, end: 1 },
        { start: 9, end: 10 },
      ],
      10,
      0.12,
    )
    expect(kept).toEqual([{ start: 1 - HEAD_LEEWAY_SEC, end: 9 + TAIL_LEEWAY_SEC }])
  })

  it('drops a leftover sliver shorter than the minimum keep length', () => {
    // A 0.05s gap between two adjacent silences isn't worth keeping.
    const kept = keepRanges(
      [
        { start: 1, end: 3 },
        { start: 3.15, end: 5 },
      ],
      10,
      0.05,
    )
    // 3.05 -> 3.10 is 0.05s wide, under the 0.1s minimum, so it's dropped.
    expect(kept.some((r) => r.end - r.start < 0.1)).toBe(false)
  })

  it('never produces a range that starts after it ends', () => {
    const kept = keepRanges([{ start: 2, end: 3 }], 5, 5) // padding wider than the clip
    for (const r of kept) expect(r.end).toBeGreaterThan(r.start)
  })
})

describe('totalDuration', () => {
  it('sums range lengths', () => {
    expect(
      totalDuration([
        { start: 0, end: 2 },
        { start: 5, end: 6.5 },
      ]),
    ).toBeCloseTo(3.5)
  })
})

describe('mergeRanges', () => {
  it('sorts out-of-order ranges', () => {
    expect(mergeRanges([{ start: 5, end: 6 }, { start: 0, end: 1 }])).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 6 },
    ])
  })

  it('merges overlapping ranges into one - a filler word landing inside a silent pause', () => {
    expect(
      mergeRanges([
        { start: 1, end: 3 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([{ start: 1, end: 4 }])
  })

  it('merges touching ranges, not just overlapping ones', () => {
    expect(
      mergeRanges([
        { start: 1, end: 2 },
        { start: 2, end: 3 },
      ]),
    ).toEqual([{ start: 1, end: 3 }])
  })

  it('leaves genuinely separate ranges apart', () => {
    expect(
      mergeRanges([
        { start: 1, end: 2 },
        { start: 5, end: 6 },
      ]),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 6 },
    ])
  })

  it('does not mutate its input', () => {
    const input = [{ start: 1, end: 2 }]
    const merged = mergeRanges(input)
    merged[0].end = 99
    expect(input[0].end).toBe(2)
  })

  it('handles an empty list', () => {
    expect(mergeRanges([])).toEqual([])
  })
})

describe('snapCutToQuiet', () => {
  /** A level curve at 20ms steps from a list of [seconds, dB] turning points. */
  function curve(spans: Array<[fromSec: number, toSec: number, db: number]>): Level[] {
    const levels: Level[] = []
    for (const [from, to, db] of spans) {
      for (let t = from; t < to - 1e-9; t += 0.02) levels.push({ time: Number(t.toFixed(3)), db })
    }
    return levels
  }

  // speech ... gap ... "um" ... gap ... speech
  const withGaps = curve([
    [0, 1, -12],
    [1, 1.2, -60],
    [1.2, 1.6, -18],
    [1.6, 1.8, -60],
    [1.8, 3, -12],
  ])

  it('pulls a slightly-late boundary back onto the real gap', () => {
    // Whisper reports the "um" ending 150ms late, inside the word after it.
    const snapped = snapCutToQuiet({ start: 1.25, end: 1.95 }, withGaps, {
      windowSec: 0.22,
      quietBelowDb: -27,
    })
    expect(snapped).not.toBeNull()
    // The end moved back into the gap rather than staying inside the speech.
    expect(snapped!.end).toBeLessThan(1.8)
    expect(snapped!.end).toBeGreaterThanOrEqual(1.6)
  })

  it('refuses the cut when the filler runs straight into the next word', () => {
    // No gap anywhere - it is speech the whole way through.
    const noGaps = curve([[0, 3, -12]])
    expect(
      snapCutToQuiet({ start: 1.2, end: 1.6 }, noGaps, { windowSec: 0.22, quietBelowDb: -27 }),
    ).toBeNull()
  })

  it('refuses rather than cutting into a word when only one side has a gap', () => {
    // Gap before the filler, but it runs straight on into the following word.
    const oneSided = curve([
      [0, 1, -12],
      [1, 1.2, -60],
      [1.2, 3, -12],
    ])
    expect(
      snapCutToQuiet({ start: 1.25, end: 1.7 }, oneSided, { windowSec: 0.22, quietBelowDb: -27 }),
    ).toBeNull()
  })

  it('returns null when the level curve does not reach the range', () => {
    expect(
      snapCutToQuiet({ start: 99, end: 99.5 }, withGaps, { windowSec: 0.22, quietBelowDb: -27 }),
    ).toBeNull()
  })

  it('refuses a cut that collapses to nothing after snapping', () => {
    // Both ends snap onto the same gap, leaving no span worth removing.
    const snapped = snapCutToQuiet({ start: 1.05, end: 1.1 }, withGaps, {
      windowSec: 0.22,
      quietBelowDb: -27,
    })
    expect(snapped).toBeNull()
  })
})

describe('speechWindows', () => {
  it('leaves silence at the ends out and pads the window into its pauses', () => {
    const windows = speechWindows([{ start: 0, end: 2 }, { start: 5, end: 8 }, { start: 9, end: 12 }], 12)
    expect(windows).toEqual([{ start: 1.7, end: 9.3 }])
  })

  it('groups speech across short pauses until the window is full', () => {
    const silences = [{ start: 10, end: 11 }, { start: 20, end: 21 }, { start: 30, end: 31 }]
    const windows = speechWindows(silences, 40, { maxSec: 25, padSec: 0 })
    expect(windows).toEqual([
      { start: 0, end: 20 },
      { start: 21, end: 40 },
    ])
  })

  it('only ever breaks inside a pause when there is one', () => {
    const silences = [{ start: 12, end: 12.5 }, { start: 24, end: 24.5 }, { start: 36, end: 36.5 }]
    for (const w of speechWindows(silences, 48, { maxSec: 25, padSec: 0 })) {
      for (const edge of [w.start, w.end]) {
        const inPause = edge === 0 || edge === 48 || silences.some((s) => edge >= s.start && edge <= s.end)
        expect(inPause).toBe(true)
      }
    }
  })

  it('never lets two windows overlap, however short the pause between them', () => {
    const windows = speechWindows([{ start: 20, end: 20.2 }], 45, { maxSec: 25, padSec: 0.3 })
    expect(windows).toHaveLength(2)
    expect(windows[0].end).toBeLessThanOrEqual(windows[1].start)
  })

  it('splits a long stretch with no pause into windows the model can take', () => {
    const windows = speechWindows([], 60, { maxSec: 25, padSec: 0.3 })
    expect(windows).toHaveLength(3)
    for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(25.6)
    expect(windows[0].start).toBe(0)
    expect(windows[windows.length - 1].end).toBe(60)
  })

  it('returns nothing for a silent video', () => {
    expect(speechWindows([{ start: 0, end: 30 }], 30)).toEqual([])
  })
})

/** A level curve from [fromSec, toSec, dB] spans, at 20ms steps. */
function spans(list: Array<[from: number, to: number, db: number]>): Level[] {
  const levels: Level[] = []
  for (const [from, to, db] of list) {
    for (let t = from; t < to - 1e-9; t += 0.02) levels.push({ time: Number(t.toFixed(3)), db })
  }
  return levels
}

describe('room at the start and end', () => {
  // Quiet, then talking from 1.5s to 4s, then quiet to 6s.
  const levels = spans([
    [0, 1.5, -70],
    [1.5, 4, -12],
    [4, 6, -70],
  ])

  it('leaves a breath before the first word and after the last, on every preset', () => {
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(levels, settings), 6, settings.paddingSec)
      expect(keeps[0].start).toBeCloseTo(1.5 - HEAD_LEEWAY_SEC, 2)
      expect(keeps[keeps.length - 1].end).toBeCloseTo(4 + TAIL_LEEWAY_SEC, 2)
    }
  })

  it('still removes the rest of the silence at both ends', () => {
    const keeps = keepRanges(findSilentRanges(levels, PRESETS.balanced), 6, PRESETS.balanced.paddingSec)
    expect(totalDuration(keeps)).toBeCloseTo(2.5 + HEAD_LEEWAY_SEC + TAIL_LEEWAY_SEC, 2)
  })

  it('leaves no more than a beat of quiet at either end', () => {
    // He found 0.4s at each end too much: the video opened on nothing.
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(levels, settings), 6, settings.paddingSec)
      expect(1.5 - keeps[0].start).toBeLessThanOrEqual(0.2)
      expect(keeps[keeps.length - 1].end - 4).toBeLessThanOrEqual(0.25)
    }
  })

  it('measures from where a soft first word really starts, and a last word really fades', () => {
    // "h..." rising out of the room for 120ms before the word proper, and
    // the last word trailing off for 150ms - both under the silence line,
    // both still the word.
    const soft = spans([
      [0, 1.4, -70],
      [1.4, 1.52, -44],
      [1.52, 4, -12],
      [4, 4.16, -46],
      [4.16, 6, -70],
    ])
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(soft, settings), 6, settings.paddingSec)
      expect(keeps[0].start).toBeCloseTo(1.4 - HEAD_LEEWAY_SEC, 2)
      expect(keeps[keeps.length - 1].end).toBeCloseTo(4.16 + TAIL_LEEWAY_SEC, 2)
    }
  })

  it('cuts a click at the very start or end, like the tap that starts the recording', () => {
    const clicks = spans([
      [0, 0.06, -8],
      [0.06, 1.5, -70],
      [1.5, 4, -12],
      [4, 5.9, -70],
      [5.9, 5.96, -8],
      [5.96, 6, -70],
    ])
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(clicks, settings), 6, settings.paddingSec)
      expect(keeps).toHaveLength(1)
      expect(keeps[0].start).toBeCloseTo(1.5 - HEAD_LEEWAY_SEC, 2)
      expect(keeps[0].end).toBeCloseTo(4 + TAIL_LEEWAY_SEC, 2)
    }
  })

  it('never takes a short first word for a click', () => {
    // "So." on its own, a pause, then the rest.
    const so = spans([
      [0, 0.3, -70],
      [0.3, 0.5, -14],
      [0.5, 1.4, -70],
      [1.4, 4, -12],
      [4, 5, -70],
    ])
    // And a word said the instant the recording starts.
    const straightIn = spans([
      [0, 0.18, -14],
      [0.18, 1.2, -70],
      [1.2, 4, -12],
      [4, 5, -70],
    ])
    for (const settings of Object.values(PRESETS)) {
      const a = keepRanges(findSilentRanges(so, settings), 5, settings.paddingSec)
      expect(a.some((k) => k.start <= 0.3 && k.end >= 0.5)).toBe(true)
      const b = keepRanges(findSilentRanges(straightIn, settings), 5, settings.paddingSec)
      expect(b.some((k) => k.start <= 0 && k.end >= 0.18)).toBe(true)
    }
  })

  it('still trims the end when the sound stops a moment before the picture', () => {
    // The file says 6.05s; its sound runs to 6s.
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(levels, settings), 6.05, settings.paddingSec)
      expect(keeps[keeps.length - 1].end).toBeCloseTo(4 + TAIL_LEEWAY_SEC, 2)
    }
  })

  it('leaves a short silence at each end as it is when it is already about a breath long', () => {
    const shortEnds = spans([
      [0, 0.2, -70],
      [0.2, 2, -12],
      [2, 2.2, -70],
    ])
    const keeps = keepRanges(findSilentRanges(shortEnds, PRESETS.tight), 2.2, PRESETS.tight.paddingSec)
    // Shorter than the shortest pause worth cutting, so there is nothing to
    // take - and it is only a few hundredths over the breath it would leave.
    expect(keeps[0].start).toBe(0)
    expect(keeps[keeps.length - 1].end).toBeCloseTo(2.2, 2)
  })
})

describe('words that fade out', () => {
  // "...word" fading through -40 for 100ms, then a real pause, then talking
  // again. The fade is under the silence line but is still the word.
  const fading = spans([
    [0, 1, -12],
    [1, 1.1, -40],
    [1.1, 3, -70],
    [3, 4, -12],
  ])

  it('does not cut the fading end off the word', () => {
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(fading, settings), 4, settings.paddingSec)
      // The cut starts after the fade, not at the moment the level dropped
      // under the silence line.
      expect(keeps[0].end).toBeGreaterThanOrEqual(1.1)
    }
  })

  it('still cuts the pause that follows it', () => {
    const keeps = keepRanges(findSilentRanges(fading, PRESETS.balanced), 4, PRESETS.balanced.paddingSec)
    expect(keeps).toHaveLength(2)
    expect(keeps[1].start - keeps[0].end).toBeGreaterThan(1.4)
  })

  it('treats a steady room as room, not as a word trailing off', () => {
    // Same shape, but the "pause" is a noisy room sitting just under the
    // line the whole way. Nothing here is a word fading out.
    const noisyRoom = spans([
      [0, 1, -12],
      [1, 3, -38],
      [3, 4, -12],
    ])
    const keeps = keepRanges(findSilentRanges(noisyRoom, PRESETS.balanced), 4, PRESETS.balanced.paddingSec)
    expect(keeps).toHaveLength(2)
    expect(keeps[1].start - keeps[0].end).toBeGreaterThan(1.4)
  })
})

describe('quiet speech is not a pause', () => {
  // A real take: room at -54, speech at -20, and one quieter word at -37 -
  // under the -35 silence line, but plainly speech next to that room. This
  // is the case that used to delete whole words: the transcript of the cut
  // read "make bank off of / if you aren't aware" where he had said "make
  // bank off of Trump. If you aren't aware."
  const quietWord = spans([
    [0, 1.5, -20],
    [1.5, 1.7, -46],
    [1.7, 2.1, -37],
    [2.1, 3.6, -54],
    [3.6, 5, -20],
  ])

  it('keeps a word that dips under the silence line', () => {
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(quietWord, settings), 5, settings.paddingSec)
      // Nothing between 1.7 and 2.1 may be cut away.
      const kept = keeps.some((k) => k.start <= 1.7 && k.end >= 2.1)
      expect(kept).toBe(true)
    }
  })

  it('still takes out the real pause after it', () => {
    const keeps = keepRanges(findSilentRanges(quietWord, PRESETS.balanced), 5, PRESETS.balanced.paddingSec)
    expect(keeps).toHaveLength(2)
    expect(keeps[1].start - keeps[0].end).toBeGreaterThan(1.0)
  })

  it('leaves little of the pause behind', () => {
    // Measured on a take with eight real pauses spliced in, the longest
    // stretch of quiet left in the cut was 0.18s. Much longer than that is
    // audible as "it did not cut".
    const quietInTake = 0.2 + 1.5 // the small gap, and the pause itself
    for (const settings of Object.values(PRESETS)) {
      const keeps = keepRanges(findSilentRanges(quietWord, settings), 5, settings.paddingSec)
      const quietLeft = quietInTake - (5 - totalDuration(keeps))
      expect(quietLeft).toBeLessThan(0.5)
    }
  })
})
