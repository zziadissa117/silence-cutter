import { describe, expect, it } from 'vitest'

import { typedBack } from './captionFixes'

const timed = (texts: string[], from: number) => texts.map((text, i) => ({ text, start: from + i * 0.3, end: from + i * 0.3 + 0.25 }))

describe('typedBack', () => {
  it('names a first word he typed back, and whether the model heard it', () => {
    const shown = timed(['app', 'changed', 'my', 'life.'], 3)
    const approved = timed(['This', 'app', 'changed', 'my', 'life.'], 3)
    expect(typedBack(shown, approved, timed(['This', 'app'], 2.7))).toEqual([{ where: 'first', word: 'this', heard: true }])
    expect(typedBack(shown, approved, timed(['app'], 3))).toEqual([{ where: 'first', word: 'this', heard: false }])
  })

  it('names a last word he typed back', () => {
    const shown = timed(['link', 'in'], 10)
    const approved = timed(['link', 'in', 'bio.'], 10)
    expect(typedBack(shown, approved, [])).toEqual([{ where: 'last', word: 'bio', heard: false }])
  })

  it('says nothing when the edges are as he was shown them', () => {
    const shown = timed(['so', 'listen'], 1)
    expect(typedBack(shown, timed(['so', 'really', 'listen'], 1), [])).toEqual([])
    expect(typedBack(shown, shown, [])).toEqual([])
  })
})
