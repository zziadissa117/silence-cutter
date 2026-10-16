import { describe, expect, it } from 'vitest'

import { findPhrase, placeCues } from './cueClips'

const said = (text: string, from = 1, step = 0.3) =>
  text.split(' ').map((t, i) => ({ text: t, start: from + i * step, end: from + i * step + 0.25 }))

describe('findPhrase', () => {
  const words = said("So, I'm going to show you how. It takes a minute.")

  it('finds the phrase whatever its case and punctuation', () => {
    expect(findPhrase(words, "I'm going to show you how")).toBe(6)
    expect(findPhrase(words, 'im GOING to show you HOW!')).toBe(6)
  })

  it('lets a long phrase have one word misheard, never its first or last', () => {
    expect(findPhrase(said("I'm gonna to show you how."), "I'm going to show you how")).toBe(5)
    expect(findPhrase(said("I'm going to show me now."), "I'm going to show you how")).toBe(-1)
  })

  it('says when it is not said', () => {
    expect(findPhrase(words, 'link in bio')).toBe(-1)
    expect(findPhrase(words, '   ')).toBe(-1)
  })
})

describe('placeCues', () => {
  const cue = { phrase: 'show you how', clip: 'demo' }

  it('splits the kept part right after the phrase', () => {
    // "show you how" ends at 2.45 s, in a part kept from 0.5 to 6.
    const words = said('I will show you how it works', 1.3)
    const out = placeCues(words, [{ start: 0.5, end: 6 }], [cue])
    expect(out.notSaid).toEqual([])
    expect(out.keep).toHaveLength(2)
    expect(out.keep[0].end).toBeCloseTo(words[4].end + 0.06)
    expect(out.keep[1].start).toBe(out.keep[0].end)
    expect(out.placed).toEqual([{ cue: 0, at: out.keep[0].end, after: 0 }])
  })

  it('goes into the pause after the phrase rather than splitting him', () => {
    const words = said('I will show you how', 1)
    const out = placeCues(words, [{ start: 0.5, end: 2.5 }, { start: 3.2, end: 5 }], [cue])
    expect(out.keep).toEqual([{ start: 0.5, end: 2.5 }, { start: 3.2, end: 5 }])
    expect(out.placed).toEqual([{ cue: 0, at: 2.5, after: 0 }])
  })

  it('leaves a phrase out when it is not in what is kept', () => {
    const out = placeCues(said('nothing like it'), [{ start: 0, end: 3 }], [cue])
    expect(out.placed).toEqual([])
    expect(out.notSaid).toEqual(['show you how'])
  })
})
