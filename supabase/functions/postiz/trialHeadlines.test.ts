import { describe, expect, it } from 'vitest'

import { cleanTrialHeadlines, trialHeadlinesMessage } from './trialHeadlines'

describe("a talking Trial clip's headlines", () => {
  it('one line each, no quotes or hashtags, none twice or already had', () => {
    const got = cleanTrialHeadlines(
      { headlines: ['"This changed everything"', 'this changed   everything', 'Nobody tells you this #fyp', 'Old one', 42, ''] },
      ['old one'],
    )
    expect(got).toEqual(['This changed everything', 'Nobody tells you this'])
    expect(cleanTrialHeadlines(null, [])).toEqual([])
    expect(cleanTrialHeadlines({ headlines: ['a', 'b', 'c'] }, [], 2)).toEqual(['a', 'b'])
  })
  it('tells Claude what he says, his best past ones and what it has', () => {
    const message = trialHeadlinesMessage('I lost 10 kilos', 20, [{ text: 'POV: day one', views: 5000 }], ['Old one'])
    expect(message).toContain('Write 20 headlines.')
    expect(message).toContain('POV: day one (5000 views a video)')
    expect(message).toContain('- Old one')
    expect(message).toContain('I lost 10 kilos')
  })
})
