import { describe, expect, it } from 'vitest'

import { UNDER, alarmNote, changedFormat, nextAlarms, type AlarmState, type WatchedPost } from './lowViews'

const H = 3_600_000
const now = Date.parse('2026-11-23T12:00:00Z')
const iso = (t: number) => new Date(t).toISOString()
const acct = (id: string) => ({ id, name: `name-${id}`, platform: 'tiktok', profile: `user${id}` })
const post = (id: string, hoursAgo: number, views: Record<string, number>, { campaign = 'c1', readAfterH = 25, accounts = ['a'] } = {}): WatchedPost => ({
  id,
  campaign_id: campaign,
  campaign_name: 'Lovable',
  headline: `headline ${id}`,
  post_at: iso(now - hoursAgo * H),
  views_at: iso(now - hoursAgo * H + readAfterH * H),
  accounts: accounts.map(acct),
  views: Object.fromEntries(Object.entries(views).map(([k, v]) => [`name-${k}`, v])),
})
const empty: AlarmState = { alarms: [], judged: {} }
const watched = { c1: iso(now - 10 * 24 * H) }

describe('nextAlarms', () => {
  it('sets an alarm for a watched campaign video under 1k a day in', () => {
    const { state, fresh } = nextAlarms(empty, [post('p1', 30, { a: 800 })], watched, now)
    expect(fresh.map((f) => [f.accountId, f.views])).toEqual([['a', 800]])
    expect(state.alarms).toHaveLength(1)
  })

  it('says nothing for 1k or more, campaigns not watched, videos before it was turned on, or not yet a day in', () => {
    const posts = [
      post('p1', 30, { a: UNDER }),
      post('p2', 30, { a: 100 }, { campaign: 'other' }),
      post('p3', 30, { a: 100 }, { readAfterH: 5 }),
    ]
    expect(nextAlarms(empty, posts, watched, now).fresh).toEqual([])
    expect(nextAlarms(empty, [post('p4', 30, { a: 100 })], { c1: iso(now) }, now).fresh).toEqual([])
  })

  it('tells about a video once', () => {
    const first = nextAlarms(empty, [post('p1', 30, { a: 500 })], watched, now)
    const again = nextAlarms(first.state, [post('p1', 30, { a: 500 })], watched, now + H)
    expect(again.fresh).toEqual([])
    expect(again.state.alarms).toHaveLength(1)
  })

  it('clears when a newer video on the account gets 1k, or the same video catches up', () => {
    const first = nextAlarms(empty, [post('p1', 60, { a: 500 })], watched, now)
    expect(nextAlarms(first.state, [post('p2', 30, { a: 4000 })], watched, now).state.alarms).toEqual([])
    expect(nextAlarms(first.state, [post('p1', 60, { a: 1500 })], watched, now).state.alarms).toEqual([])
  })

  it('keeps one alarm per account: its newest low video', () => {
    const { state } = nextAlarms(empty, [post('p2', 30, { a: 300 }), post('p1', 60, { a: 700 })], watched, now)
    expect(state.alarms.map((a) => a.postId)).toEqual(['p2'])
  })

  it('judges each account of a video by its own views', () => {
    const { fresh } = nextAlarms(empty, [post('p1', 30, { a: 300, b: 5000 }, { accounts: ['a', 'b'] })], watched, now)
    expect(fresh.map((f) => f.accountId)).toEqual(['a'])
  })

  it('goes when he says he changed the format', () => {
    const { state } = nextAlarms(empty, [post('p1', 30, { a: 300, b: 200 }, { accounts: ['a', 'b'] })], watched, now)
    expect(changedFormat(state, ['a']).alarms.map((a) => a.accountId)).toEqual(['b'])
  })
})

describe('alarmNote', () => {
  it('names the account and its views', () => {
    const { fresh } = nextAlarms(empty, [post('p1', 30, { a: 640 })], watched, now)
    expect(alarmNote(fresh)).toEqual({
      title: 'Change the format now - @usera',
      body: 'Its Lovable video got 640 views on TikTok - under 1k. Post a different format next.',
    })
  })
})
