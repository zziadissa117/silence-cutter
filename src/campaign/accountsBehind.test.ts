import { describe, expect, it } from 'vitest'

import { attachSummary, accountsBehind, type ServerPost } from './posting'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const post = (over: Partial<ServerPost>): ServerPost =>
  ({
    id: 'p',
    key: 'k',
    campaignId: 'c1',
    campaignName: 'Inflow',
    status: 'waiting',
    postAt: at(600),
    accounts: [{ id: 'tiktok', name: 'T', platform: 'tiktok' }],
    ...over,
  }) as ServerPost

describe('accountsBehind', () => {
  it('finds a picked account that waiting videos do not go to, and how many', () => {
    const posts = [post({ id: '1' }), post({ id: '2', status: 'approved' })]
    expect(accountsBehind('c1', ['tiktok', 'ig'], posts, NOW)).toEqual({ accounts: ['ig'], videos: 2 })
  })

  it('counts a scheduled video only while it is not about to go out', () => {
    const posts = [post({ id: '1', status: 'scheduled', postAt: at(300) }), post({ id: '2', status: 'scheduled', postAt: at(1) })]
    expect(accountsBehind('c1', ['ig'], posts, NOW)).toEqual({ accounts: ['ig'], videos: 1 })
  })

  it('ignores videos that have gone out, failed, or belong to another campaign', () => {
    const posts = [post({ status: 'posted' }), post({ status: 'failed' }), post({ campaignId: 'c2' })]
    expect(accountsBehind('c1', ['ig'], posts, NOW)).toEqual({ accounts: [], videos: 0 })
  })

  it('is empty when every video already goes to every picked account', () => {
    expect(accountsBehind('c1', ['tiktok'], [post({})], NOW)).toEqual({ accounts: [], videos: 0 })
  })
})

describe('attachSummary', () => {
  it('says what was added and what was left', () => {
    expect(attachSummary({ added: 5, scheduled: 3, left: 2 })).toBe(
      'Added to 5 videos waiting and 3 already scheduled. 2 have already gone out or are about to - they stay as they were, and a new post is needed for the new account.',
    )
  })
  it('says so plainly when nothing was waiting', () => {
    expect(attachSummary({ added: 0, scheduled: 0, left: 0 })).toBe('No videos were waiting for it.')
  })
})
