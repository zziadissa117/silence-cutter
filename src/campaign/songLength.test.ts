import { describe, expect, it } from 'vitest'

import type { CampaignPlan } from './plan'
import { cutLength, songAgainstVideo, songTime } from './songLength'

const plan = (keep: { start: number; end: number }[], duration = 80) => ({ keep, duration }) as unknown as CampaignPlan

describe('the song against the video once cut', () => {
  it("is the video's kept parts, his own cuts when he changed them, or all of it when it isn't cut", () => {
    expect(cutLength({ day: { approved: false, plan: plan([{ start: 0, end: 20 }, { start: 30, end: 60 }]) } })).toBe(50)
    expect(cutLength({ day: { approved: false, plan: plan([{ start: 0, end: 20 }]), keep: [{ start: 0, end: 10 }] } })).toBe(10)
    expect(cutLength({ day: { approved: false, plan: plan([{ start: 0, end: 20 }]), noSpeech: true } })).toBe(80)
    expect(cutLength({})).toBeNull()
  })

  it('says when the song ends before the video', () => {
    expect(songAgainstVideo(42, 50)).toEqual({ text: 'Song 0:42 · your video 0:50 once cut - the song ends 8 s before the video does.', short: true })
    expect(songAgainstVideo(130, 50)?.short).toBe(false)
    expect(songAgainstVideo(130, 50)?.text).toContain('lasts the whole video')
    expect(songAgainstVideo(42, null)).toEqual({ text: 'Song 0:42.', short: false })
    expect(songAgainstVideo(undefined, 50)).toBeNull()
  })

  it('writes times as minutes and seconds', () => {
    expect(songTime(59.6)).toBe('1:00')
    expect(songTime(125)).toBe('2:05')
  })
})
