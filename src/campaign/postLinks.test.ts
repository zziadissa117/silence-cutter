import { describe, expect, it } from 'vitest'

import { accountPage, postLinks } from './posting'

const yt = { name: 'Jake', platform: 'youtube', profile: '@jake.sbanks' }
const tt = { name: 'Kari', platform: 'tiktok', profile: 'kari.ugc' }

describe('postLinks', () => {
  it("adds the YouTube channel's page when YouTube gave no link (his ask, 2026-11-24)", () => {
    const links = postLinks({ status: 'posted', accounts: [tt, yt], links: { Kari: 'https://www.tiktok.com/@kari.ugc/video/1' } })
    expect(links.map((l) => l.href)).toEqual(['https://www.tiktok.com/@kari.ugc/video/1', 'https://www.youtube.com/@jake.sbanks/shorts'])
    expect(links[1].page).toBe(true)
  })
  it('nothing added before it is meant to be out', () => {
    expect(postLinks({ status: 'scheduled', accounts: [yt], links: {} })).toEqual([])
  })
  it('no page without a username', () => {
    expect(accountPage({ platform: 'youtube' })).toBeNull()
  })
})
