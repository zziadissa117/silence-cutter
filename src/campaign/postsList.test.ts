import { describe, expect, it } from 'vitest'

import type { ServerPost } from './posting'
import { campaignsIn, foldBatches } from './postsList'

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
