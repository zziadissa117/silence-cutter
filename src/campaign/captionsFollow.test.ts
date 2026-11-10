import { describe, expect, it } from 'vitest'

import { captionsInView } from './CaptionReview'

describe('the caption list follows the video only when he is looking at it', () => {
  it('does not pull the page down while he watches the video at the top', () => {
    // The list starts below the video and the timeline, off the screen.
    expect(captionsInView({ top: 1100, bottom: 2400 }, 850)).toBe(false)
    expect(captionsInView({ top: 700, bottom: 2000 }, 850)).toBe(false)
  })

  it('follows once he has scrolled down to the captions', () => {
    expect(captionsInView({ top: 200, bottom: 1500 }, 850)).toBe(true)
    expect(captionsInView({ top: -400, bottom: 900 }, 850)).toBe(true)
    // Scrolled past it: nothing to follow.
    expect(captionsInView({ top: -2000, bottom: -10 }, 850)).toBe(false)
  })
})
