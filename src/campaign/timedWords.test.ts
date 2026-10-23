import { describe, expect, it } from 'vitest'

import { isNonSpeech, keepInWindow, padWithQuiet, stuckOn, timedWords, unstuck } from './timedWords'

describe('the words of a window', () => {
  it('puts them on the video\'s timeline', () => {
    expect(timedWords([{ text: ' Hi', timestamp: [0.2, 0.4] }], 10, 3)).toEqual([{ text: ' Hi', start: 10.2, end: 10.4 }])
  })

  it('keeps the last word when the model gives it no end', () => {
    const words = timedWords(
      [
        { text: ' link', timestamp: [1.0, 1.2] },
        { text: ' in', timestamp: [1.25, 1.35] },
        { text: ' bio.', timestamp: [1.4, null] },
      ],
      5,
      1.7,
    )
    expect(words.map((w) => w.text)).toEqual([' link', ' in', ' bio.'])
    expect(words[2].start).toBeCloseTo(6.4)
    expect(words[2].end).toBeCloseTo(6.7)
  })

  it('starts a word with no start where the last one ended', () => {
    const words = timedWords(
      [
        { text: ' so', timestamp: [0.5, 0.7] },
        { text: ' good', timestamp: [null, 1.1] },
      ],
      0,
      2,
    )
    expect(words[1]).toEqual({ text: ' good', start: 0.7, end: 1.1 })
  })

  it('ends a word with no end where the next begins', () => {
    const words = timedWords(
      [
        { text: ' one', timestamp: [0.1, null] },
        { text: ' two', timestamp: [0.3, 0.5] },
      ],
      0,
      2,
    )
    expect(words[0].end).toBeCloseTo(0.3)
  })
})

describe('a stretch heard with quiet either side', () => {
  it('puts the quiet before and after, the sound itself untouched', () => {
    const padded = padWithQuiet(new Float32Array([0.5, -0.5]), 4, 0.5)
    expect([...padded]).toEqual([0, 0, 0.5, -0.5, 0, 0])
  })

  it('keeps a word timed into the quiet, moved onto the stretch', () => {
    const words = keepInWindow(
      [
        { text: ' So', start: 9.6, end: 10.3 },
        { text: ' done.', start: 12.9, end: 13.4 },
      ],
      10,
      13,
    )
    expect(words).toEqual([
      { text: ' So', start: 10, end: 10.3 },
      { text: ' done.', start: 12.9, end: 13 },
    ])
  })
})

describe('what is not a word', () => {
  it('drops the model\'s notes for sounds that are not words', () => {
    const words = timedWords(
      [
        { text: ' [Music]', timestamp: [0, 1] },
        { text: ' Hi', timestamp: [1, 1.2] },
        { text: ' (laughs)', timestamp: [1.2, 1.6] },
        { text: ' ♪', timestamp: [1.6, 1.8] },
        { text: ' [inaudible].', timestamp: [1.8, 2] },
      ],
      0,
      2,
    )
    expect(words.map((w) => w.text)).toEqual([' Hi'])
  })

  it('keeps a word in brackets inside a sentence as a word', () => {
    expect(isNonSpeech(' (really)')).toBe(true)
    expect(isNonSpeech(' [Music]')).toBe(true)
    expect(isNonSpeech(' link')).toBe(false)
    expect(isNonSpeech(' (a')).toBe(false)
  })
})

describe('a window the model got stuck on', () => {
  const word = (text: string, i: number) => ({ text, start: i * 0.3, end: i * 0.3 + 0.2 })
  it('is told apart from him repeating a word a few times', () => {
    expect(stuckOn(['no,', 'no,', 'no,', 'that', 'is', 'it'])).toBe(0)
    expect(stuckOn(['okay,', 'okay,', 'okay,', 'okay,', 'okay,', 'okay,', 'okay,'])).toBe(1)
    expect(stuckOn(['I', "'ll", 'take', 'that.', "I'll", 'take', 'that.', "I'll", 'take', 'that.', "I'll", 'take', 'that.', "I'll", 'take', 'that.', "I'll", 'take', 'that.'])).toBe(3)
    expect(stuckOn(['all', 'right.', 'Okay.', 'Okay.', 'Okay.'])).toBe(0)
  })

  it('is folded to the phrase said twice, the rest of the window kept', () => {
    const texts = ['So', 'that', 'is', 'okay,', 'okay,', 'okay,', 'okay,', 'okay,', 'okay,', 'okay,', 'okay,', 'then.']
    const words = unstuck(texts.map(word))
    expect(words.map((w) => w.text)).toEqual(['So', 'that', 'is', 'okay,', 'okay,', 'then.'])
  })

  it('folds a looping phrase of several words too', () => {
    const texts = ['Right.', ...Array(6).fill(["I'll", 'take', 'that.']).flat(), 'Over.']
    const words = unstuck(texts.map(word))
    expect(words.map((w) => w.text)).toEqual(['Right.', "I'll", 'take', 'that.', "I'll", 'take', 'that.', 'Over.'])
  })

  it('leaves a window that is not stuck exactly as it is', () => {
    const words = ['very', 'very', 'good,', 'no,', 'no,', 'no.'].map(word)
    expect(unstuck(words)).toEqual(words)
  })
})
