import { describe, expect, it } from 'vitest'

import { findRepeats } from './repeats'

const said = (text: string, from = 0) =>
  text.split(' ').map((w, i) => ({ text: w, start: from + i * 0.4, end: from + i * 0.4 + 0.3 }))

describe('a phrase said twice', () => {
  it('finds a retake, and cutting the first takes out the first try', () => {
    const words = said('so the best way to so the best way to do it is simple')
    const found = findRepeats(words)
    expect(found).toHaveLength(1)
    expect(found[0].text).toBe('so the best way to')
    expect(found[0].cut).toEqual({ start: words[0].start, end: words[5].start })
  })

  it('allows a few words of a false start between the tries', () => {
    const words = said('this app makes um wait no this app makes videos for me')
    const [r] = findRepeats(words)
    expect(r.text).toBe('this app makes')
    expect(r.cut).toEqual({ start: words[0].start, end: words[6].start })
  })

  it('ignores punctuation and case', () => {
    expect(findRepeats(said('I made $800. I made $800 a day')).map((r) => r.text)).toEqual(['I made $800'])
  })

  it('leaves alone two words said twice, and phrases said far apart', () => {
    expect(findRepeats(said('you know you know it works'))).toEqual([])
    const far = [...said('the app is great'), ...said('and more words here and here and here and more more more', 2), ...said('the app is great', 12)]
    expect(findRepeats(far)).toEqual([])
  })

  it('finds each retake in a take with several', () => {
    const words = said('first of all first of all I tried it and I tried it and it worked')
    expect(findRepeats(words).map((r) => r.text)).toEqual(['first of all', 'I tried it and'])
  })
})
