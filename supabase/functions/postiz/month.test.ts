import { describe, expect, it } from 'vitest'

import { monthDays } from './month'

// 2026-11-14 18:00 in Toronto.
const NOW = Date.parse('2026-11-14T23:00:00Z')

describe('the last 30 days', () => {
  it('each day in his timezone: the views of what went out, how many went out and how many did not', () => {
    const days = monthDays(
      [
        { post_at: '2026-11-14T15:00:00Z', status: 'posted', views: { '@a': 1200, '@b': 300 } },
        // 23:30 in Toronto on the 13th, the 14th in UTC.
        { post_at: '2026-11-14T04:30:00Z', status: 'posted', views: { '@a': 500 } },
        { post_at: '2026-11-13T12:00:00Z', status: 'error', views: null },
        // Not read yet: it still counts as out.
        { post_at: '2026-11-14T20:00:00Z', status: 'posted', views: null },
        // Still to go, too old, rejected: not counted.
        { post_at: '2026-11-15T12:00:00Z', status: 'posted', views: { '@a': 9 } },
        { post_at: '2026-10-01T12:00:00Z', status: 'posted', views: { '@a': 9 } },
        { post_at: '2026-11-12T12:00:00Z', status: 'rejected', views: null },
      ],
      NOW,
      'America/Toronto',
    )
    expect(days).toHaveLength(30)
    expect(days[0].date).toBe('2026-10-16')
    expect(days[29]).toEqual({ date: '2026-11-14', views: 1500, posted: 2, failed: 0 })
    expect(days[28]).toEqual({ date: '2026-11-13', views: 500, posted: 1, failed: 1 })
    expect(days.reduce((n, d) => n + d.views, 0)).toBe(2000)
  })
})
