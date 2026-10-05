import { describe, expect, it } from 'vitest'

import { accountLabel, handleOf } from './posting'

describe('accountLabel', () => {
  it('puts the username first so accounts with the same name can be told apart', () => {
    expect(accountLabel({ name: 'Kari', platform: 'tiktok', profile: 'kari.ugc' })).toBe('@kari.ugc · TikTok (Kari)')
    expect(accountLabel({ name: 'Kari', platform: 'tiktok', profile: 'kari.ugc2' })).toBe('@kari.ugc2 · TikTok (Kari)')
  })
  it('does not repeat the name when it is the username', () => {
    expect(accountLabel({ name: 'kari.ugc', platform: 'instagram', profile: '@kari.ugc' })).toBe('@kari.ugc · Instagram')
  })
  it('falls back to the name when there is no username', () => {
    expect(accountLabel({ name: 'Kari', platform: 'youtube' })).toBe('Kari · YouTube')
    expect(handleOf({ profile: '  @x ' })).toBe('x')
  })
})
