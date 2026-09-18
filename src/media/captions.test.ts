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
