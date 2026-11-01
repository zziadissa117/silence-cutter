import { describe, expect, it } from 'vitest'

import { hookInsights, reactionOf, type HookVideo } from './hookInsights.ts'

const NOW = Date.parse('2026-11-01T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const video = (headline: string, reaction: string, views: number, fields: Partial<HookVideo> = {}): HookVideo => ({
  campaign_id: 'c1',
  campaign_name: 'Lovable',
  headline,
  file_name: `${reaction} + IMG_9000.mp4`,
  batch: { look: 'box' },
  views: { a: views / 2, b: views / 2 },
  post_at: daysAgo(5),
  ...fields,
})

describe('hookInsights', () => {
  it('the reaction is the first clip of the name', () => {
    expect(reactionOf('IMG_0249 + IMG_0330 + IMG_1.mp4')).toBe('IMG_0249')
    expect(reactionOf(null)).toBeNull()
  })

  it('each kind best first, the best and the worst marked, songs only where carried', () => {
    const videos = [
      ...Array.from({ length: 6 }, () => video('I made $800 a day', 'IMG_1', 3000, { batch: { look: 'box', song: 'Song A' } })),
      ...Array.from({ length: 6 }, () => video('Nobody talks about this', 'IMG_2', 1000)),
      ...Array.from({ length: 6 }, () => video('stop scrolling', 'IMG_3', 200, { batch: { look: 'outline', song: 'Song B' } })),
    ]
    const [c] = hookInsights(videos, NOW)
    expect(c.videos).toBe(18)
    expect(c.rows.headline.map((r) => r.label)).toEqual(['I made $800 a day', 'Nobody talks about this', 'stop scrolling'])
    expect(c.rows.headline[0].key).toBe('i made $800 a day')
    expect(c.rows.headline[0].mark).toBe('best')
    expect(c.rows.headline[2].mark).toBe('worst')
    expect(c.rows.reaction[0]).toMatchObject({ key: 'IMG_1', views: 3000, videos: 6, mark: 'best' })
    expect(c.rows.song.map((r) => r.key)).toEqual(['Song A', 'Song B'])
    expect(c.rows.look.map((r) => r.label)).toEqual(['White box', 'Outline'])
  })

  it('one lucky video is not the best', () => {
    const videos = [video('lucky', 'IMG_9', 50_000), ...Array.from({ length: 8 }, () => video('steady', 'IMG_1', 1000)), ...Array.from({ length: 8 }, () => video('weak', 'IMG_2', 300))]
    const [c] = hookInsights(videos, NOW)
    expect(c.rows.headline.find((r) => r.key === 'lucky')!.mark).toBeUndefined()
  })

  it('leaves out videos without views, too new, too old, or not from a batch', () => {
    const videos = [
      video('a', 'IMG_1', 100, { views: null }),
      video('a', 'IMG_1', 100, { post_at: daysAgo(1) }),
      video('a', 'IMG_1', 100, { post_at: daysAgo(40) }),
      video('a', 'IMG_1', 100, { batch: null }),
    ]
    expect(hookInsights(videos, NOW)).toEqual([])
  })

  it('Claude + X is one headline, whatever its amount', () => {
    const videos = [video('Claude + Lovable = $800 a day', 'IMG_1', 100, { batch: { look: 'formula' } }), video('Claude + Lovable = $650 a day', 'IMG_1', 100, { batch: { look: 'formula' } })]
    const [c] = hookInsights(videos, NOW)
    expect(c.rows.headline).toHaveLength(1)
    expect(c.rows.headline[0]).toMatchObject({ key: 'formula', label: 'Claude + X', videos: 2 })
  })
})
