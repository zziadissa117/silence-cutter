import { describe, expect, it } from 'vitest'

import { IDEAS, cleanIdeas, ideasMessage } from './headlineIdeas.ts'

describe('headline ideas', () => {
  it('tells Claude how each does and what the batch has', () => {
    const text = ideasMessage('Lovable', [{ text: 'I made $800 a day', views: 2100, videos: 9 }], ['I made $800 a day', 'wait for it'])
    expect(text).toContain('Campaign: Lovable')
    expect(text).toContain('"I made $800 a day" - 2100 views a video (9 videos)')
    expect(text).toContain('- wait for it')
  })

  it('keeps clean new ones only', () => {
    const got = cleanIdeas(
      { headlines: ['"POV: you found Lovable"', 'I made $800 a day!', 'pov: You found lovable', 42, '', 'a '.repeat(30), 'This app builds apps\nfor you'] },
      ['I made $800 a day'],
    )
    expect(got).toEqual(['POV: you found Lovable', 'This app builds apps for you'])
    expect(cleanIdeas({ headlines: Array.from({ length: 20 }, (_, i) => `idea ${i}`) }, []).length).toBe(IDEAS)
    expect(cleanIdeas('nonsense', [])).toEqual([])
  })
})
