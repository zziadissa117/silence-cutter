// Captions out of sync (2026-10-23): the captions are put through the cut
// again each time they are shown (Captions screen opened, every keystroke
// while fixing one, the edit screen again, and the render) - and each pass
// moved the last words before a cut a little earlier again, up to 0.1 s a
// pass, so a video fixed by hand came out with words well ahead of his voice.
// However many times they go through, they must land in the same place.

import { describe, expect, it } from 'vitest'

import { captionWords, retimePhrase, type CaptionWord } from './captions'

const said = (text: string, start: number, end: number) => ({ text: ` ${text}`, start, end })

// Fast talking up to a cut at 2.0 s, then more after a pause.
const heard = [
  said('this', 0.1, 0.25),
  said('app', 0.26, 0.45),
  said('changed', 0.46, 0.75),
  said('my', 1.72, 1.82),
  said('whole', 1.83, 1.93),
  said('life.', 1.94, 2.1),
  said('Try', 3.0, 3.2),
  said('it', 3.21, 3.3),
  said('now.', 3.31, 3.6),
]
const keep = [
  { start: 0, end: 2.0 },
  { start: 2.9, end: 3.7 },
]

const again = (words: CaptionWord[], times: number, rough = false) => {
  let out = words
  for (let i = 0; i < times; i++) out = captionWords(out, keep, { rough })
  return out
}
const starts = (words: CaptionWord[]) => words.map((w) => Math.round(w.start * 1000) / 1000)

describe('captions put through the cut again and again', () => {
  it('land where they did the first time', () => {
    for (const rough of [false, true]) {
      const once = captionWords(heard, keep, { rough })
      expect(starts(again(once, 1, rough))).toEqual(starts(once))
      expect(starts(again(once, 10, rough))).toEqual(starts(once))
    }
  })

  it('keep their place through a word fixed by hand, typed one letter at a time', () => {
    let words = captionWords(heard, keep)
    const first = starts(words)
    // "whole" fixed to "hole" and back, a keystroke at a time, each kept and
    // put through the cut again as the screen does.
    for (const text of ['whol', 'who', 'whol', 'whole']) {
      words = words.map((w) => (w.text.trim() === 'whole' || w.text.trim().startsWith('who') ? { ...w, text } : w))
      words = captionWords(words, keep)
    }
    expect(starts(words)).toEqual(first)
  })

  it('a phrase typed with more words is timed from when it was heard', () => {
    const words = captionWords(heard, keep)
    const phrase = words.slice(3, 6)
    const typed = retimePhrase(phrase, 'my whole entire life.')
    const placed = captionWords([...words.slice(0, 3), ...typed, ...words.slice(6)], keep)
    expect(starts(captionWords(placed, keep))).toEqual(starts(placed))
    expect(placed[3].start).toBeGreaterThanOrEqual(1.6)
  })
})
