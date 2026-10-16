import { describe, expect, it } from 'vitest'

import { channelReport, endPlan, isPending, splitStop, type EndPost, type Integration, type PendingPost } from './channels'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const integration = (id: string, over: Partial<Integration> = {}): Integration => ({
  id,
  name: id,
  platform: 'tiktok',
  profile: `@${id}`,
  disabled: false,
  ...over,
})

const post = (over: Partial<PendingPost> = {}): PendingPost => ({
  campaign_id: 'inflow',
  status: 'scheduled',
  post_at: at(60),
  accounts: [{ id: 'tt' }],
  ...over,
})

describe('channelReport', () => {
  const integrations = [
    integration('tt'),
    integration('ig', { platform: 'instagram' }),
    integration('yt', { platform: 'youtube', disabled: true }),
    integration('other'),
  ]

  it('is nothing when the campaign posts to no account on this profile', () => {
    expect(channelReport('inflow', { vertus: { accounts: ['tt'] } }, integrations, [], new Map(), NOW)).toBeNull()
  })

  it('reports each account the campaign posts to, connected or disabled, and the plan count', () => {
    const report = channelReport('inflow', { inflow: { accounts: ['tt', 'yt'] } }, integrations, [], new Map(), NOW)
    expect(report?.inUse).toBe(3)
    expect(report?.accounts.map((a) => [a.id, a.disabled])).toEqual([
      ['tt', false],
      ['yt', true],
    ])
  })

  it('says when Postiz no longer has an account the campaign lists', () => {
    const report = channelReport('inflow', { inflow: { accounts: ['gone'] } }, integrations, [], new Map(), NOW)
    expect(report?.accounts[0]).toMatchObject({ id: 'gone', disabled: null })
  })

  it('names the other campaigns that post to the same account', () => {
    const report = channelReport(
      'inflow',
      { inflow: { accounts: ['tt', 'ig'] }, vertus: { accounts: ['tt'] }, old: { accounts: ['tt'] } },
      integrations,
      [],
      new Map([['vertus', 'Vertus']]),
      NOW,
    )
    expect(report?.accounts[0].alsoUsedBy).toEqual([
      { id: 'vertus', name: 'Vertus' },
      { id: 'old', name: 'another campaign' },
    ])
    expect(report?.accounts[1].alsoUsedBy).toEqual([])
  })

  it('counts posts still due on each account, not ones already out', () => {
    const report = channelReport(
      'inflow',
      { inflow: { accounts: ['tt', 'ig'] } },
      integrations,
      [
        post(),
        post({ status: 'waiting', post_at: null }),
        post({ post_at: at(-5) }), // its time has passed
        post({ status: 'posted' }),
        post({ accounts: [{ id: 'ig' }, { id: 'tt' }] }),
      ],
      new Map(),
      NOW,
    )
    expect(report?.accounts.map((a) => [a.id, a.scheduled])).toEqual([
      ['tt', 3],
      ['ig', 1],
    ])
  })
})

describe('isPending', () => {
  it('holds a post that has not gone out, and lets go of one that has', () => {
    expect(isPending({ status: 'approved', post_at: at(-60) }, NOW)).toBe(true)
    expect(isPending({ status: 'scheduled', post_at: at(1) }, NOW)).toBe(true)
    expect(isPending({ status: 'scheduled', post_at: at(-1) }, NOW)).toBe(false)
    expect(isPending({ status: 'rejected', post_at: at(60) }, NOW)).toBe(false)
  })
})

describe('splitStop', () => {
  const row = (id: string, status: string, postAt: string | null, inPostiz: boolean) => ({
    id,
    status,
    post_at: postAt,
    postiz_ids: inPostiz ? [{ postId: `p-${id}` }] : null,
  })

  it('rejects what Postiz never had, queues what it holds, and leaves what has gone out', () => {
    expect(
      splitStop(
        [
          row('waiting', 'waiting', null, false),
          row('approved', 'approved', at(30), false),
          row('in-postiz', 'scheduled', at(120), true),
          row('held', 'scheduled', at(120), false),
          row('gone', 'scheduled', at(-5), true),
          row('posted', 'posted', at(-60), true),
        ],
        NOW,
      ),
    ).toEqual({ reject: ['waiting', 'approved', 'held'], unpost: ['in-postiz'] })
  })
})


describe('ending a campaign', () => {
  const end = (over: Partial<Parameters<typeof endPlan>[0]> = {}) =>
    endPlan({
      campaignId: 'inflow',
      accountIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'gone'],
      campaigns: { inflow: { accounts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'gone'] }, vertus: { accounts: ['b'] } },
      otherProfiles: [{ friend: { accounts: ['c'] } }],
      integrations: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => integration(id, { disabled: id === 'h' })),
      posts: [
        { ...post({ campaign_id: 'vertus', accounts: [{ id: 'd' }] }), postiz_ids: [{ postId: 'pz-vertus' }] },
        { ...post({ campaign_id: 'inflow', post_at: at(-30), accounts: [{ id: 'e' }] }), postiz_ids: [{ postId: 'pz-out' }] },
        { ...post({ campaign_id: 'inflow', accounts: [{ id: 'a' }, { id: 'f' }] }), postiz_ids: [{ postId: 'pz-mine' }] },
      ] satisfies EndPost[],
      ownPostiz: new Set(['pz-mine', 'pz-out']),
      upcoming: [
        { id: 'pz-mine', integration: 'a', publishDate: at(60), state: 'QUEUE' },
        { id: 'pz-hand', integration: 'g', publishDate: at(120), state: 'QUEUE' },
        { id: 'pz-old', integration: 'f', publishDate: at(-120), state: 'PUBLISHED' },
      ],
      names: new Map([['vertus', 'Vertus']]),
      now: NOW,
      ...over,
    })

  it('takes out only what nothing else needs, and says why the rest stay', () => {
    const plan = end()
    expect(plan.remove.map((a) => a.id)).toEqual(['a', 'f'])
    expect(plan.gone).toEqual(['gone'])
    // Only what will pass stays on the campaign.
    expect(plan.keep.filter((k) => k.later).map((k) => k.account.id)).toEqual(['d', 'e', 'g'])
    expect(Object.fromEntries(plan.keep.map((k) => [k.account.id, k.why]))).toEqual({
      b: 'Vertus posts to it too',
      c: "the other login's posting uses it too",
      d: '1 Vertus post still due on it',
      e: 'a post just went out on it - end it again in a few hours',
      g: "Postiz holds 1 post on it the Cutter didn't make - delete it in Postiz, then end it again",
      h: "already switched off in Postiz - it doesn't count toward your limit",
    })
  })

  it('lets an account go once its last post is long out', () => {
    const plan = end({ now: NOW + 4 * 60 * 60 * 1000 })
    expect(plan.remove.map((a) => a.id)).toContain('e')
  })

  it("doesn't let a deleted campaign's picks hold an account", () => {
    const plan = end({ known: new Set(['inflow']) })
    expect(plan.remove.map((a) => a.id)).toContain('b')
  })
})
