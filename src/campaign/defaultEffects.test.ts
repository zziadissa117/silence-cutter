import { describe, expect, it } from 'vitest'
import { NO_EFFECTS } from './effects'
import { PRESET_EFFECTS, effectsFor, presetOf } from './defaultEffects'

describe('effectsFor', () => {
  it('uses the default when the angle has no effects', () => {
    expect(effectsFor(NO_EFFECTS, PRESET_EFFECTS.subtle)).toEqual(PRESET_EFFECTS.subtle)
  })
  it("keeps the angle's own effects over the default", () => {
    const own = { ...NO_EFFECTS, brandHit: 'strong' as const }
    expect(effectsFor(own, PRESET_EFFECTS.subtle)).toEqual(own)
  })
  it('a video set to none gets the angle as it is', () => {
    expect(effectsFor(NO_EFFECTS, null)).toEqual(NO_EFFECTS)
  })
})

describe('presetOf', () => {
  it('names a preset, or null when custom', () => {
    expect(presetOf(PRESET_EFFECTS.strong)).toBe('strong')
    expect(presetOf({ ...PRESET_EFFECTS.strong, hookPush: 'off' })).toBeNull()
  })
})
