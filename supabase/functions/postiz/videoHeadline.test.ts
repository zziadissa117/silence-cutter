import { describe, expect, it } from 'vitest'

import { cleanVideoHeadline, pastHeadlines, videoHeadlineMessage } from './videoHeadline.ts'

describe("a talking video's headline, written from the whole video", () => {
  it('shows Claude his past headlines once each, most viewed first', () => {
    const past = pastHeadlines([
      { headline: 'POV: you found the app', views: 100 },
      { headline: 'I made $800 a day', views: 900 },
      { headline: 'POV: you found the app', views: 300 },
      { headline: '  ', views: 5 },
      { headline: 'No views yet', views: null },
    ])
    expect(past).toEqual([
      { text: 'I made $800 a day', views: 900 },
      { text: 'POV: you found the app', views: 200 },
      { text: 'No views yet', views: null },
    ])
    const message = videoHeadlineMessage('so today I want to show you', 'Cantina', past)
    expect(message).toContain('- I made $800 a day (900 views a video)')
    expect(message).toContain('so today I want to show you')
  })

  it('keeps one clean line, or nothing', () => {
    expect(cleanVideoHeadline({ headline: ' "This app replaced my editor" #ad ' })).toBe('This app replaced my editor')
    expect(cleanVideoHeadline({ headline: '' })).toBe('')
    expect(cleanVideoHeadline(null)).toBe('')
    expect(cleanVideoHeadline({ headline: 'word '.repeat(30) })).toBe('')
  })
})
