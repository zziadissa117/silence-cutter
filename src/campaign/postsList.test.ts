import { describe, expect, it } from 'vitest'

import type { ServerPost } from './posting'
import { byDay, campaignsIn, foldBatches, foldCampaigns, localDay, missedAccounts, postsOrder } from './postsList'

const post = (id: string, campaignId: string, batch?: string) =>
  ({ id, campaignId, campaignName: campaignId.toUpperCase(), batch: batch ? { id: batch, date: '2026-10-11', time: '10:00', size: 3 } : null }) as unknown as ServerPost

describe('foldBatches', () => {
  it('folds each batch into one row where its first post was, and leaves the rest as they are', () => {
    const items = foldBatches([post('1', 'a'), post('2', 'b', 'x'), post('3', 'a'), post('4', 'b', 'x'), post('5', 'b', 'x')])
    expect(items.map((i) => (i.kind === 'post' ? i.post.id : `batch ${i.posts.map((p) => p.id).join(',')}`))).toEqual(['1', 'batch 2,4,5', '3'])
  })

  it('keeps a batch with a single post left as a plain post', () => {
    expect(foldBatches([post('1', 'b', 'x')])).toEqual([{ kind: 'post', post: expect.objectContaining({ id: '1' }) }])
  })
})

describe('campaignsIn', () => {
  it('counts the posts per campaign, biggest first', () => {
    expect(campaignsIn([post('1', 'a'), post('2', 'b'), post('3', 'b')])).toEqual([
      { id: 'b', name: 'B', count: 2 },
      { id: 'a', name: 'A', count: 1 },
    ])
  })
})

describe('foldCampaigns', () => {
  const show = (items: ReturnType<typeof foldCampaigns>) => items.map((i) => (i.kind === 'post' ? i.post.id : `${i.id} ${i.posts.map((p) => p.id).join(',')}`))

  it('folds all of a campaign into one row, whichever batch made them', () => {
    expect(show(foldCampaigns([post('1', 'a', 'x'), post('2', 'b'), post('3', 'a', 'y'), post('4', 'a')]))).toEqual(['campaign:a 1,3,4', '2'])
  })

  it('folds only batch videos when his own posts are each to be read', () => {
    expect(show(foldCampaigns([post('1', 'a', 'x'), post('2', 'a'), post('3', 'a', 'y')], { own: false }))).toEqual(['campaign:a 1,3', '2'])
  })
})

describe('byDay', () => {
  const at = (id: string, iso: string | null) => ({ ...post(id, 'a'), postAt: iso }) as unknown as ServerPost

  it('lists posts day by day, each day in time order, no time last', () => {
    const a = new Date(2026, 9, 30, 15, 0).toISOString()
    const b = new Date(2026, 9, 30, 9, 0).toISOString()
    const c = new Date(2026, 9, 31, 1, 0).toISOString()
    const days = byDay([at('a', a), at('none', null), at('c', c), at('b', b)])
    expect(days.map((d) => [d.date, d.posts.map((p) => p.id)])).toEqual([
      ['2026-10-30', ['b', 'a']],
      ['2026-10-31', ['c']],
      [null, ['none']],
    ])
    expect(localDay(c)).toBe('2026-10-31')
  })
})

describe('the Posts screen order (postsOrder)', () => {
  const NOW = Date.parse('2026-11-11T15:00:00Z')
  const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString()
  const p = (id: string, status: string, h: number | null, error?: string, retryH?: number) =>
    ({ id, status, postAt: h === null ? null : at(h), createdAt: at(-1), retryAt: retryH === undefined ? null : at(retryH), ...(error ? { error } : {}) }) as never as Parameters<
      typeof postsOrder
    >[0][number] & { id: string }
  const ids = (list: unknown[]) => list.map((x) => (x as { id: string }).id)

  it('puts everything waiting for him first, the soonest first, apart from the rest (his ask, 2026-11-13)', () => {
    const { toApprove, next } = postsOrder([p('later', 'scheduled', 5), p('approve', 'waiting', 2), p('soon', 'approved', 1), p('none', 'waiting', null), p('first', 'waiting', 0.5)], NOW)
    expect(ids(toApprove)).toEqual(['first', 'approve', 'none'])
    expect(ids(next)).toEqual(['soon', 'later'])
  })

  it('keeps only the last few hours of what went out, newest first', () => {
    const { justPosted } = postsOrder([p('a', 'posted', -1), p('b', 'posted', -2.5), p('old', 'posted', -6)], NOW)
    expect(ids(justPosted)).toEqual(['a', 'b'])
  })

  it("lists one that didn't go out and goes again by itself at that time, with the rest still to go", () => {
    const { next, missed } = postsOrder([p('later', 'scheduled', 3), p('again', 'error', -2, "Postiz couldn't publish it to @kari.", 1.5), p('soon', 'scheduled', 1)], NOW)
    expect(ids(next)).toEqual(['soon', 'again', 'later'])
    expect(missed).toHaveLength(0)
  })

  it("keeps what didn't go out and won't go again for a day, apart, to post again", () => {
    const { missed, justPosted } = postsOrder([p('err', 'error', -5), p('half', 'posted', -2, 'Not posted to Jake (Instagram).'), p('gone', 'failed', -30)], NOW)
    expect(ids(missed)).toEqual(['half', 'err'])
    expect(justPosted).toHaveLength(0)
  })

  it('counts one he posted himself as out', () => {
    const { missed, justPosted } = postsOrder([p('mine', 'posted', -1, 'You posted it yourself to @kari.')], NOW)
    expect(missed).toHaveLength(0)
    expect(ids(justPosted)).toEqual(['mine'])
  })
})

describe('missedAccounts', () => {
  const accounts = [
    { name: 'Kari', platform: 'tiktok-business', profile: 'kari.ugc' },
    { name: 'Kari YT', platform: 'youtube' },
  ]
  it('finds the accounts its note names, by username or name', () => {
    expect(missedAccounts({ accounts, status: 'error', error: "Postiz couldn't publish it to @kari.ugc. Posting again Fri 3 PM." }).map((a) => a.platform)).toEqual(['tiktok-business'])
    expect(missedAccounts({ accounts, status: 'posted', error: 'Not posted to Kari YT.' }).map((a) => a.platform)).toEqual(['youtube'])
  })
  it('takes them all when the note names none', () => {
    expect(missedAccounts({ accounts, status: 'failed', error: 'The video could not be put into Postiz.' })).toHaveLength(2)
  })
})
