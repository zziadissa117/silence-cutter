import { describe, expect, it } from 'vitest'

import { atBestHour, bestOf, ideaOfKey, ideaViews, planExtra, planWarmups, quietAccounts } from './warmupPlan'
import type { MadeWarmup } from './warmups'

const made = (id: string, ideaId: string, category = 'training', fields: Partial<MadeWarmup> = {}): MadeWarmup => ({
  id,
  ideaId,
  title: ideaId,
  category,
  headline: '',
  seconds: 7,
  madeAt: 1,
  file: { id: `f-${id}`, name: 'x.mp4', type: 'video/mp4', size: 1 },
  ...fields,
})
const now = new Date('2026-11-12T09:00:00')
const hour = () => 19

describe('when warm-ups go out', () => {
  it('two a week on a campaign, evenly apart, at its best hour', () => {
    const plan = planWarmups({
      campaigns: [{ id: 'c1', warmups: { categories: [], perWeek: 2 } }],
      made: [made('m1', 'a'), made('m2', 'b'), made('m3', 'c')],
      posts: [],
      bestHour: hour,
      now,
    })
    expect(plan.map((p) => p.made.id)).toEqual(['m1', 'm2'])
    expect(plan[0].at.getHours()).toBe(19)
    expect(plan[0].at.getDate()).toBe(12)
    expect((plan[1].at.getTime() - plan[0].at.getTime()) / 3600_000).toBeGreaterThan(80)
  })

  it('never the same filmed video twice, never the same idea twice on a campaign, only its categories', () => {
    const plan = planWarmups({
      campaigns: [
        { id: 'c1', warmups: { categories: ['ai'], perWeek: 3 } },
        { id: 'c2', warmups: { categories: [], perWeek: 3 } },
        { id: 'c3' },
      ],
      made: [made('m1', 'a', 'ai'), made('m2', 'a', 'ai'), made('m3', 'b', 'training'), made('m4', 'c', 'training', { posted: { campaignId: 'c9', key: 'k', at: 'x' } })],
      posts: [{ key: 'warmup:b:old', campaignId: 'c2', postAt: '2026-11-01T19:00:00', status: 'posted', views: null }],
      bestHour: hour,
      now,
    })
    const by = (c: string) => plan.filter((p) => p.campaignId === c).map((p) => p.made.id)
    expect(by('c1')).toEqual(['m1'])
    expect(by('c2')).toEqual(['m2'])
    expect(by('c3')).toEqual([])
  })

  it('waits its turn after the last one, and puts the ideas that get views first', () => {
    const plan = planWarmups({
      campaigns: [{ id: 'c1', warmups: { categories: [], perWeek: 3 } }],
      made: [made('m1', 'a'), made('m2', 'b')],
      posts: [
        { key: 'warmup:x:1', campaignId: 'c1', postAt: '2026-11-15T19:00:00', status: 'waiting', views: null },
        { key: 'warmup:b:2', campaignId: 'c9', postAt: '2026-11-01T19:00:00', status: 'posted', views: { a: 3000, b: 2000 } },
      ],
      bestHour: hour,
      now,
    })
    // The next only once 7/3 days have passed since the 15th's; idea b's
    // warm-ups get 5,000 views, so it goes before idea a (none yet).
    expect(plan.map((p) => p.made.id)).toEqual(['m2'])
    expect(plan[0].at.getTime()).toBeGreaterThan(Date.parse('2026-11-17T00:00:00'))
  })

  it('reads the idea from the key, and views per idea', () => {
    expect(ideaOfKey('warmup:w-1:m-2')).toBe('w-1')
    expect(ideaOfKey('job-1')).toBeNull()
    expect(ideaViews([{ key: 'warmup:w:1', views: { a: 100, b: 100 } }, { key: 'warmup:w:2', views: { a: 400 } }]).get('w')).toBe(300)
  })

  it('takes the best hour of the day, or the next day once it has gone', () => {
    expect(bestOf(Array.from({ length: 24 }, (_, h) => (h === 13 ? 5 : 1)))).toBe(13)
    expect(bestOf(undefined)).toBe(19)
    expect(atBestHour(new Date('2026-11-12T20:00:00').getTime(), 19, 's').getDate()).toBe(13)
  })
})

describe('an extra warm-up for a cold account', () => {
  it('the best one the campaign has not had, its own categories first, soon', () => {
    const p = planExtra({
      campaign: { id: 'c1', warmups: { categories: ['ai'], perWeek: 2 } },
      made: [made('m1', 'a', 'ai'), made('m2', 'b', 'training'), made('m3', 'c', 'ai', { posted: { campaignId: 'c2', key: 'k', at: '' } })],
      posts: [{ key: 'warmup:a:m0', campaignId: 'c1', status: 'scheduled', views: null }],
      bestHour: hour,
      now,
    })
    // "a" was on c1 already, m3 went out elsewhere: the training one, though not its category.
    expect(p?.made.id).toBe('m2')
    expect(p!.at.getTime() - now.getTime()).toBeGreaterThanOrEqual(3 * 3600_000)
    expect(p!.at.getHours()).toBe(19)
  })
  it('none when nothing filmed can go there', () => {
    expect(planExtra({ campaign: { id: 'c1' }, made: [], posts: [], bestHour: hour, now })).toBeNull()
  })
})

describe('an account forgotten for a day gets a warm-up (his ask, 2026-11-11)', () => {
  const at = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString()
  const post = (account: string, h: number, status = 'posted') => ({ campaignId: 'c1', postAt: at(h), status, accounts: [{ id: account, name: account, platform: 'instagram' }] }) as never
  const long = () => now.getTime() - 5 * 24 * 3600_000

  it('nothing posted for a day and nothing coming: that account', () => {
    const quiet = quietAccounts({
      campaigns: [{ id: 'c1', accounts: ['a', 'b', 'c'] }],
      posts: [post('a', -30), post('b', -5), post('c', 6, 'scheduled')],
      now,
      since: long,
    })
    expect(quiet).toEqual([{ campaignId: 'c1', accountId: 'a' }])
  })

  it('a post refused or taken out does not count as posted', () => {
    expect(quietAccounts({ campaigns: [{ id: 'c1', accounts: ['a'] }], posts: [post('a', -2, 'failed')], now, since: long })).toHaveLength(1)
  })

  it('an account new to the Cutter waits a day; one in two campaigns gets one warm-up', () => {
    expect(quietAccounts({ campaigns: [{ id: 'c1', accounts: ['a'] }], posts: [], now, since: () => now.getTime() - 3600_000 })).toEqual([])
    const both = quietAccounts({ campaigns: [{ id: 'c1', accounts: ['a'] }, { id: 'c2', accounts: ['a'] }], posts: [], now, since: long })
    expect(both).toEqual([{ campaignId: 'c1', accountId: 'a' }])
  })
})
