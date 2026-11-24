import { describe, expect, it } from 'vitest'

import { ASK_AGAIN_DAYS, STALE_DAYS, newestFirst, staleCampaigns } from './campaignOrder'
import type { Campaign } from './look'

const DAY = 86_400_000
const now = Date.parse('2026-11-24T12:00:00Z')
const c = (id: string, extra: Partial<Campaign> = {}) => ({ id, name: id, updatedAt: now, ...extra }) as Campaign
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()

describe('newestFirst', () => {
  it('lists the newest made first, by its own date or its first video, General last', () => {
    const list = [c('general', { general: true }), c('old', { createdAt: now - 90 * DAY }), c('older-no-date', { updatedAt: now }), c('new', { createdAt: now - DAY })]
    const dates = { 'older-no-date': { first: iso(200), last: iso(1) } }
    expect(newestFirst(list, dates).map((x) => x.id)).toEqual(['new', 'old', 'older-no-date', 'general'])
  })
})

describe('staleCampaigns', () => {
  const all = () => true
  it('asks about a campaign nothing has gone out for in two weeks (his ask, 2026-11-24)', () => {
    const got = staleCampaigns([c('a'), c('b')], { a: { first: iso(60), last: iso(STALE_DAYS + 3) }, b: { first: iso(60), last: iso(2) } }, all, {}, now)
    expect(got.map((s) => [s.campaign.id, s.days])).toEqual([['a', STALE_DAYS + 3]])
  })
  it('not one with a video set to go, nor one he said he still posts for, nor one posting nowhere', () => {
    const dates = { a: { first: iso(60), last: iso(-2) }, b: { first: iso(60), last: iso(40) } }
    expect(staleCampaigns([c('a'), c('b')], dates, all, { b: now - DAY }, now)).toEqual([])
    expect(staleCampaigns([c('b')], dates, () => false, {}, now)).toEqual([])
    expect(staleCampaigns([c('b')], dates, all, { b: now - (ASK_AGAIN_DAYS + 1) * DAY }, now)).toHaveLength(1)
  })
})
