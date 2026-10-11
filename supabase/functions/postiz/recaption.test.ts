import { describe, expect, it } from 'vitest'

import { finishCaption } from './caption'
import { cleanMode, pickRecaption, recaptionMode } from './recaption'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

describe('pickRecaption', () => {
  it('redoes waiting, queued and scheduled posts, but not ones about to go or already out', () => {
    const { redo, tooSoon } = pickRecaption(
      [
        { id: 'waiting', status: 'waiting', post_at: at(60) },
        { id: 'queued', status: 'approved', post_at: null },
        { id: 'tomorrow', status: 'scheduled', post_at: at(24 * 60) },
        { id: 'in-10', status: 'scheduled', post_at: at(10) },
        { id: 'posted', status: 'posted', post_at: at(-60) },
        { id: 'stopped', status: 'rejected', post_at: at(60) },
      ],
      NOW,
    )
    expect(redo).toEqual(['waiting', 'queued', 'tomorrow'])
    expect(tooSoon).toBe(1)
  })
})

describe('recaptionMode', () => {
  it("rewrites Claude's captions, and only adds hashtags to words he wrote", () => {
    expect(recaptionMode({ by_hand: false, rules: { caption: 'claude' } })).toBe('rewrite')
    expect(recaptionMode({ by_hand: true, rules: { caption: 'claude' } })).toBe('hashtags')
    expect(recaptionMode({ by_hand: false, rules: { caption: 'paste' } })).toBe('hashtags')
  })
})

describe('adding the missing hashtags', () => {
  it('is what a redo does unless he asks to rewrite', () => {
    expect(cleanMode(undefined)).toBe('hashtags')
    expect(cleanMode('rewrite')).toBe('rewrite')
  })

  it('keeps every word and adds only the hashtags missing, once', () => {
    const before = 'This app saved me hours.\n\n#ugc #polsia'
    expect(finishCaption(before, ['#polsia', '#newtag'])).toBe('This app saved me hours.\n\n#ugc #polsia #newtag')
    expect(finishCaption('No tags here', ['#newtag'])).toBe('No tags here\n\n#newtag')
    // Already there: unchanged, so the post is not sent to Postiz again.
    expect(finishCaption(before, ['#polsia'])).toBe(before)
  })
})
