import { describe, expect, it } from 'vitest'

import type { ServerPost } from './posting'
import { byDay, campaignsIn, foldBatches, foldCampaigns, localDay, postsOrder } from './postsList'

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
  const p = (id: string, status: string, h: number | null, error?: string) =>
    ({ id, status, postAt: h === null ? null : at(h), createdAt: at(-1), ...(error ? { error } : {}) }) as never as Parameters<typeof postsOrder>[0][number] & { id: string }

  it('lists what is still to go by its time, the next first, whatever its state', () => {
    const { next } = postsOrder([p('later', 'scheduled', 5), p('approve', 'waiting', 2), p('soon', 'approved', 1), p('none', 'waiting', null)], NOW)
    expect(next.map((x) => (x as { id: string }).id)).toEqual(['soon', 'approve', 'later', 'none'])
  })

  it('keeps only the last few hours of what went out, newest first', () => {
    const { justPosted } = postsOrder([p('a', 'posted', -1), p('b', 'posted', -2.5), p('old', 'posted', -6)], NOW)
    expect(justPosted.map((x) => (x as { id: string }).id)).toEqual(['a', 'b'])
  })

  it("keeps what didn't go out for a day, apart, to post again", () => {
    const { missed, justPosted } = postsOrder([p('err', 'error', -5), p('half', 'posted', -2, 'Not posted to Jake (Instagram).'), p('gone', 'failed', -30)], NOW)
    expect(missed.map((x) => (x as { id: string }).id)).toEqual(['half', 'err'])
    expect(justPosted).toHaveLength(0)
  })
})
