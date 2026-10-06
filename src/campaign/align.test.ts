import { describe, expect, it } from 'vitest'

import {
  ALIGN_PIECE_SEC,
  CTC_LETTERS,
  forceAlign,
  joinPieces,
  logSoftmax,
  numberWords,
  pieceCuts,
  placeWords,
  placeWordsAt,
  spellForAlignment,
} from './align'

describe('numberWords', () => {
  it('says numbers the way they are said', () => {
    expect(numberWords(0)).toBe('zero')
    expect(numberWords(13)).toBe('thirteen')
    expect(numberWords(35)).toBe('thirty five')
    expect(numberWords(105)).toBe('one hundred five')
    expect(numberWords(20000)).toBe('twenty thousand')
    expect(numberWords(1_500_000)).toBe('one million five hundred thousand')
  })
})

describe('spellForAlignment', () => {
  it('spells money, percentages and ranges out', () => {
    expect(spellForAlignment(' $20,000')).toBe('TWENTY THOUSAND DOLLARS')
    expect(spellForAlignment('2.8%,')).toBe('TWO POINT EIGHT PERCENT')
    expect(spellForAlignment('6-7%.')).toBe('SIX TO SEVEN PERCENT')
  })

  it('keeps apostrophes and drops what is not said', () => {
    expect(spellForAlignment(" don't")).toBe("DON'T")
    expect(spellForAlignment(' -')).toBe('')
  })
})

/** Scores that say, frame by frame, which letter is heard. */
function heard(sequence: string): { scores: Float32Array; frames: number } {
  const frames = sequence.length
  const letters = CTC_LETTERS.length
  const scores = new Float32Array(frames * letters).fill(-5)
  ;[...sequence].forEach((ch, t) => {
    const id = ch === '_' ? 0 : CTC_LETTERS.indexOf(ch)
    scores[t * letters + id] = 5
  })
  return { scores: logSoftmax(scores, frames, letters), frames }
}

describe('forceAlign', () => {
  it('finds each word where its letters are heard', () => {
    //                        0123456789012345
    const { scores, frames } = heard('___HHII__|YYOO__')
    const spans = forceAlign(scores, frames, CTC_LETTERS.length, ['HI', 'YO'])
    expect(spans).toEqual([
      { first: 3, last: 6 },
      { first: 10, last: 13 },
    ])
  })

  it('handles a doubled letter, which needs a gap to be heard twice', () => {
    const { scores, frames } = heard('__LL_LL__')
    const [span] = forceAlign(scores, frames, CTC_LETTERS.length, ['LL'])
    expect(span).toEqual({ first: 2, last: 6 })
  })

  it('gives up cleanly when the audio is too short for the words', () => {
    const { scores, frames } = heard('HI')
    expect(forceAlign(scores, frames, CTC_LETTERS.length, ['HELLO', 'THERE'])).toEqual([null, null])
  })

  it('leaves a word with nothing to say without a span', () => {
    const { scores, frames } = heard('__HI__')
    expect(forceAlign(scores, frames, CTC_LETTERS.length, ['', 'HI'])[0]).toBeNull()
  })
})

describe('placeWords', () => {
  it('times words from their frames, and puts an unplaced word between its neighbours', () => {
    const words = ['a', '-', 'b'].map((text) => ({ text, start: 0, end: 0 }))
    const placed = placeWords(words, [{ first: 0, last: 4 }, null, { first: 10, last: 14 }], 0.02, 5)
    expect(placed[0]).toEqual({ text: 'a', start: 5, end: 5.1 })
    expect(placed[1].start).toBeCloseTo(5.1)
    expect(placed[1].end).toBeCloseTo(5.2)
    expect(placed[2].start).toBeCloseTo(5.2)
  })
})

describe('pieceCuts (the letter model hears a window a piece at a time)', () => {
  const r = (start: number, end: number) => ({ start, end })

  it('cuts a long window in the middle of its pauses, each piece at most the limit', () => {
    const window = r(0, 25)
    const cuts = pieceCuts(window, [r(5, 5.5), r(9, 9.6), r(15, 15.4), r(21, 21.5)])
    expect(cuts).toEqual([5.25, 9.3, 15.2, 21.25])
    const bounds = [window.start, ...cuts, window.end]
    for (let i = 1; i < bounds.length; i++) expect(bounds[i] - bounds[i - 1]).toBeLessThanOrEqual(ALIGN_PIECE_SEC)
  })
  it('leaves a short window whole', () => {
    expect(pieceCuts(r(0, 7), [r(3, 3.5)])).toEqual([])
  })
  it('never cuts in talk with no pause: a long stretch of it stays whole', () => {
    expect(pieceCuts(r(0, 20), [])).toEqual([])
    // 12 s of talk, a pause, then 7.5 s more: the only cut is the pause.
    expect(pieceCuts(r(0, 20), [r(12, 12.5)])).toEqual([12.25])
  })
  it('only cuts at pauses inside the window, never at its padded edges', () => {
    expect(pieceCuts(r(10, 30), [r(9.5, 10.2), r(29.8, 31)])).toEqual([])
  })
  it('never leaves a sliver of a piece at either end', () => {
    const cuts = pieceCuts(r(0, 9), [r(0.3, 0.5), r(8.6, 8.8)])
    expect(cuts).toEqual([])
  })
})

describe('joinPieces', () => {
  it('times every frame from its own piece', () => {
    const letters = CTC_LETTERS.length
    const a = heard('__HI')
    const b = heard('YO__')
    const joined = joinPieces(
      [
        { logProbs: a.scores, frames: a.frames, start: 10, end: 10.08 },
        { logProbs: b.scores, frames: b.frames, start: 10.5, end: 10.58 },
      ],
      letters,
    )
    expect(joined.frames).toBe(8)
    expect(joined.starts[0]).toBeCloseTo(10)
    expect(joined.ends[3]).toBeCloseTo(10.08)
    expect(joined.starts[4]).toBeCloseTo(10.5)
    expect(joined.ends[7]).toBeCloseTo(10.58)
  })

  it('places words where aligning the window whole placed them', () => {
    const letters = CTC_LETTERS.length
    const said = '___HHII__|YYOO___|__BBYYEE__'
    const whole = heard(said)
    const words = ['HI', 'YO', 'BYE']
    const asWhole = placeWords(
      words.map((text) => ({ text, start: 0, end: 0 })),
      forceAlign(whole.scores, whole.frames, letters, words),
      0.02,
      3,
    )
    // The same audio heard in three pieces, cut in its pauses.
    const pieces = [said.slice(0, 9), said.slice(9, 17), said.slice(17)].map((part, i, all) => {
      const { scores, frames } = heard(part)
      const first = all.slice(0, i).reduce((n, p) => n + p.length, 0)
      return { logProbs: scores, frames, start: 3 + first * 0.02, end: 3 + (first + frames) * 0.02 }
    })
    const joined = joinPieces(pieces, letters)
    const inPieces = placeWordsAt(
      words.map((text) => ({ text, start: 0, end: 0 })),
      forceAlign(joined.logProbs, joined.frames, letters, words),
      joined.starts,
      joined.ends,
    )
    inPieces.forEach((w, i) => {
      expect(w.start).toBeCloseTo(asWhole[i].start, 6)
      expect(w.end).toBeCloseTo(asWhole[i].end, 6)
    })
  })
})
