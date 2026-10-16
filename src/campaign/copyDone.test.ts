import { describe, expect, it } from 'vitest'

import { copyDone } from './outbox'

describe("the phone's copy of a sent video", () => {
  it('goes once Postiz has the video or the post is over', () => {
    expect(copyDone({ status: 'scheduled', videoUrl: 'https://postiz/x.mp4' })).toBe(true)
    expect(copyDone({ status: 'error', videoUrl: 'https://postiz/x.mp4' })).toBe(true)
    expect(copyDone({ status: 'posted', videoUrl: null })).toBe(true)
    expect(copyDone({ status: 'rejected', videoUrl: null })).toBe(true)
  })

  it('stays while he still decides, or Postiz has no copy', () => {
    expect(copyDone({ status: 'waiting', videoUrl: 'https://postiz/x.mp4' })).toBe(false)
    expect(copyDone({ status: 'approved', videoUrl: 'https://postiz/x.mp4' })).toBe(false)
    expect(copyDone({ status: 'scheduled', videoUrl: null })).toBe(false)
    expect(copyDone({ status: 'failed', videoUrl: null })).toBe(false)
  })
})
