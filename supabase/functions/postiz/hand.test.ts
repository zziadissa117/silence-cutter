import { describe, expect, it } from 'vitest'

import { NO_RULES } from './caption.ts'
import { handFields } from './hand.ts'

const NOW = Date.parse('2026-09-30T18:00:00Z')

describe('a post made by hand', () => {
  it('is not one unless the phone says so', () => {
    expect(handFields(undefined, NO_RULES, 'Polsha', NOW)).toBeNull()
    expect(handFields(null, NO_RULES, 'Polsha', NOW)).toBeNull()
  })

  it('goes straight away with no time, a time gone, or one a moment off', () => {
    expect(handFields({}, NO_RULES, 'Polsha', NOW)?.post_at).toBeNull()
    expect(handFields({ at: '2026-09-30T17:00:00Z' }, NO_RULES, 'Polsha', NOW)?.post_at).toBeNull()
    expect(handFields({ at: '2026-09-30T18:01:00Z' }, NO_RULES, 'Polsha', NOW)?.post_at).toBeNull()
    expect(handFields({ at: 'not a time' }, NO_RULES, 'Polsha', NOW)?.post_at).toBeNull()
  })

  it('keeps a time he picked later on, and takes none of the campaign\'s', () => {
    const fields = handFields({ at: '2026-09-30T21:30:00Z' }, NO_RULES, 'Polsha', NOW)
    expect(fields).toMatchObject({ by_hand: true, slot: null, post_at: '2026-09-30T21:30:00.000Z' })
  })

  it('leaves the caption to Claude when he wrote none', () => {
    const fields = handFields({ caption: '  ', about: ' my reaction to the colours ' }, NO_RULES, 'Polsha', NOW)
    expect(fields?.caption).toBeUndefined()
    expect(fields?.about).toBe('my reaction to the colours')
  })

  it('holds his caption to the same rules: the campaign\'s hashtags in, never #ad', () => {
    const rules = { ...NO_RULES, hashtags: ['polshapartner'] }
    const fields = handFields({ caption: 'This colour is unreal #nails #ad' }, rules, 'Polsha', NOW)
    expect(fields?.caption).toBe('This colour is unreal #nails #polshapartner')
    expect(fields?.title).toBe('This colour is unreal')
  })

  it('spreads a batch over the campaign\'s times instead, still unapproved', () => {
    const fields = handFields({ spread: true, at: '2026-09-30T21:30:00Z', caption: 'One of six' }, NO_RULES, 'Polsha', NOW)
    expect(fields).toMatchObject({ by_hand: false, slot: null, post_at: null, caption: 'One of six' })
  })

  it('adds no hashtags to a tracking caption he pasted', () => {
    const rules = { ...NO_RULES, caption: 'paste' as const, hashtags: ['x'] }
    expect(handFields({ caption: 'Tracking caption 123' }, rules, 'Inflow', NOW)?.caption).toBe('Tracking caption 123')
  })
})
