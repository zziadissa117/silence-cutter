import { describe, expect, it } from 'vitest'

import { CTC_LETTERS, forceAlign, logSoftmax, numberWords, placeWords, spellForAlignment } from './align'

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
