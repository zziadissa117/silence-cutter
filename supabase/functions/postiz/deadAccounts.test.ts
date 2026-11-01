import { describe, expect, it } from 'vitest'

import { deadAccounts, deadNote, type AccountVideo } from './deadAccounts.ts'

const NOW = Date.parse('2026-11-01T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const tt = { id: 'tt1', name: 'lovable.zi', platform: 'tiktok' }
const ig = { id: 'ig1', name: 'lovable_zi', platform: 'instagram' }

/** Videos to both accounts: the usual weeks, then the last few days. */
function videos(recentTikTok: number, recentInstagram = 900): AccountVideo[] {
  const out: AccountVideo[] = []
  for (let d = 9; d < 30; d++) out.push({ post_at: daysAgo(d), accounts: [tt, ig], views: { 'lovable.zi': 1200, lovable_zi: 900 } })
  for (let d = 3.2; d < 7; d += 0.5) out.push({ post_at: daysAgo(d), accounts: [tt, ig], views: { 'lovable.zi': recentTikTok, lovable_zi: recentInstagram } })
  return out
}

describe('deadAccounts', () => {
  it('an account whose last days get a small share of its usual is in trouble; the other is not', () => {
    const found = deadAccounts(videos(60), NOW)
    expect(found).toEqual([{ id: 'tt1', name: 'lovable.zi', platform: 'tiktok', recent: 60, usual: 1200, videos: 8 }])
    expect(deadNote(found[0]).title).toBe('lovable.zi on TikTok may be shadowbanned')
  })

  it('a dip is not trouble', () => {
    expect(deadAccounts(videos(500), NOW)).toEqual([])
  })

  it('too few videos, or an account that never got many, says nothing', () => {
    expect(deadAccounts(videos(60).slice(-3), NOW)).toEqual([])
    const small = videos(5).map((v) => ({ ...v, views: { 'lovable.zi': v.views!['lovable.zi'] === 1200 ? 50 : 5 } }))
    expect(deadAccounts(small, NOW)).toEqual([])
  })

  it('videos too new to have their three-day views are not counted', () => {
    const fresh = [...videos(1200), ...Array.from({ length: 10 }, () => ({ post_at: daysAgo(1), accounts: [tt], views: { 'lovable.zi': 3 } }))]
    expect(deadAccounts(fresh, NOW)).toEqual([])
  })
})
