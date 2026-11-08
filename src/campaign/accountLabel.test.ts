import { describe, expect, it } from 'vitest'

import { accountLabel, handleOf, linkLabel } from './posting'
import { deadNote, userName } from '../../supabase/functions/postiz/deadAccounts.ts'
import { heldNote } from '../../supabase/functions/postiz/limits.ts'

describe('accountLabel', () => {
  it('is the username alone - never the name, however many share it', () => {
    expect(accountLabel({ name: 'Kari', platform: 'tiktok', profile: 'kari.ugc' })).toBe('@kari.ugc · TT')
    expect(accountLabel({ name: 'Kari', platform: 'instagram-standalone', profile: '@kari.ugc' })).toBe('@kari.ugc · IG')
  })
  it('falls back to the name only when there is no username', () => {
    expect(accountLabel({ name: 'Kari', platform: 'youtube' })).toBe('Kari · YT')
    expect(handleOf({ profile: '  @x ' })).toBe('x')
  })
  it("names a posted video's link by its account's username", () => {
    const accounts = [
      { name: 'Kari', platform: 'tiktok', profile: 'kari.tt' },
      { name: 'Kari', platform: 'instagram', profile: 'kari.ig' },
    ]
    expect(linkLabel('Kari (Instagram)', accounts)).toBe('@kari.ig · IG')
    expect(linkLabel('Someone', accounts)).toBe('Someone')
  })
  it('is how the server names them too: shadowban warnings and held posts', () => {
    expect(userName({ name: 'Jake', profile: 'jake.ugc' })).toBe('@jake.ugc')
    expect(deadNote({ id: 'a', name: 'Jake', profile: 'jake.ugc', platform: 'instagram', recent: 40, usual: 900, videos: 6 }).title).toBe('@jake.ugc on Instagram may be shadowbanned')
    expect(heldNote([{ id: 'a', name: 'Jake', profile: 'jake.ugc', platform: 'tiktok', held: 'paused' }])).toContain('@jake.ugc is paused')
  })
})
