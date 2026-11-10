import { describe, expect, it } from 'vitest'

import { buildCaptionCues, cuesToSrt } from './captions'
import type { WordChunk } from './fillerWords'
import type { Range } from './silenceMath'

describe('buildCaptionCues', () => {
  it('remaps a word onto the cut video timeline, not the original', () => {
    // Original: 0-2 kept, 2-5 cut (removed silence), 5-7 kept.
    // A word at original time 6 lands at output time 3 (2 + (6-5)).
    const keep: Range[] = [
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]
    const words: WordChunk[] = [{ text: 'hello', start: 6, end: 6.4 }]
    const [cue] = buildCaptionCues(words, keep)
    expect(cue.start).toBeCloseTo(3, 5)
    expect(cue.end).toBeCloseTo(3.4, 5)
  })

  it('drops a word that was cut out of the video entirely', () => {
    const keep: Range[] = [
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]
    // This word sits inside the 2-5 gap - e.g. a removed "um" or silence.
    const words: WordChunk[] = [
      { text: 'kept', start: 1, end: 1.5 },
      { text: 'gone', start: 3, end: 3.4 },
    ]
    const cues = buildCaptionCues(words, keep)
    const text = cues.map((c) => c.text).join(' ')
    expect(text).toContain('kept')
    expect(text).not.toContain('gone')
  })

  it('keeps consecutive words on one line', () => {
    const keep: Range[] = [{ start: 0, end: 10 }]
    const words: WordChunk[] = [
      { text: 'this', start: 0, end: 0.3 },
      { text: 'is', start: 0.3, end: 0.5 },
      { text: 'fine', start: 0.5, end: 0.9 },
    ]
    const cues = buildCaptionCues(words, keep)
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe('this is fine')
  })

  it('starts a new line after a real gap in speech', () => {
    const keep: Range[] = [{ start: 0, end: 10 }]
    const words: WordChunk[] = [
      { text: 'first', start: 0, end: 0.4 },
      { text: 'second', start: 3, end: 3.4 }, // 2.6s gap
    ]
    const cues = buildCaptionCues(words, keep)
    expect(cues).toHaveLength(2)
    expect(cues[0].text).toBe('first')
    expect(cues[1].text).toBe('second')
  })

  it('starts a new line after a sentence ends', () => {
    const keep: Range[] = [{ start: 0, end: 10 }]
    const words: WordChunk[] = [
      { text: 'Done.', start: 0, end: 0.4 },
      { text: 'Next', start: 0.5, end: 0.9 },
    ]
    const cues = buildCaptionCues(words, keep)
    expect(cues).toHaveLength(2)
  })

  it('starts a new line once the current one gets too long to read', () => {
    const keep: Range[] = [{ start: 0, end: 100 }]
    const longWord = 'antidisestablishmentarianism' // 28 chars
    const words: WordChunk[] = [
      { text: longWord, start: 0, end: 0.5 },
      { text: longWord, start: 0.6, end: 1.1 }, // together > 42 chars
    ]
    const cues = buildCaptionCues(words, keep)
    expect(cues).toHaveLength(2)
  })
})

describe('cuesToSrt', () => {
  it('writes standard numbered SubRip blocks', () => {
    const srt = cuesToSrt([
      { start: 0, end: 1.5, text: 'Hello there' },
      { start: 62, end: 63.25, text: 'Second line' },
    ])
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nHello there\n\n2\n00:01:02,000 --> 00:01:03,250\nSecond line\n',
    )
  })
})

describe('words at the edge of a cut', () => {
  const w = (text: string, start: number, end: number): WordChunk => ({ text, start, end })
  // A pause at 2.0-3.5, cut with balanced padding.
  const keep: Range[] = [
    { start: 0, end: 2.08 },
    { start: 3.42, end: 10 },
  ]

  it('keeps a word whose late-reported end falls inside the cut, clamped to the edge', () => {
    const cues = buildCaptionCues([w('make', 1.2, 1.5), w('aware.', 1.6, 2.15), w('If', 3.5, 3.7)], keep)
    expect(cues.map((c) => c.text)).toEqual(['make aware.', 'If'])
    expect(cues[0].end).toBeCloseTo(2.08, 6)
    // "If" starts 0.08 s into the second kept part, which follows straight on.
    expect(cues[1].start).toBeCloseTo(2.08 + 0.08, 6)
  })

  it('keeps a word whose start is reported inside the cut', () => {
    const cues = buildCaptionCues([w('So', 3.3, 3.6)], keep)
    expect(cues).toHaveLength(1)
    expect(cues[0].start).toBeCloseTo(2.08, 6)
    expect(cues[0].end).toBeCloseTo(2.08 + 0.18, 6)
  })

  it('still drops a word that was cut out whole', () => {
    expect(buildCaptionCues([w('um', 2.5, 2.9)], keep)).toEqual([])
  })

  it('places words by where each kept part really landed when told', () => {
    // The second part landed 0.05 s later than the plan says.
    const shifts = [0, 2.08 - 3.42 + 0.05]
    const cues = buildCaptionCues([w('If', 3.5, 3.7)], keep, shifts)
    expect(cues[0].start).toBeCloseTo(2.08 + 0.08 + 0.05, 6)
  })
})

describe('lines on screen', () => {
  const w = (text: string, start: number, end: number): WordChunk => ({ text, start, end })
  const whole: Range[] = [{ start: 0, end: 10 }]

  it('never overlap', () => {
    const cues = buildCaptionCues([w('Done.', 0.2, 1.9), w('Next', 1.5, 1.5), w('thing', 1.6, 2.0)], whole)
    expect(cues.map((c) => c.text)).toEqual(['Done.', 'Next thing'])
    expect(cues[0].end).toBeCloseTo(1.5, 6)
    expect(cues[1].end).toBeCloseTo(2.0, 6)
  })
})
