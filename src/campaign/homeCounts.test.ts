import { describe, expect, it } from 'vitest'

import { dayOf, hueOf } from './HomeTop'
import { weekOf } from './Overview'

const NOW = new Date('2026-11-11T15:00:00').getTime()
const at = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 3600e3).toISOString()

describe('the Videos tab: today', () => {
  it("counts what went out today, what is set to go, and what waits for him", () => {
    const posts = [
      { status: 'posted' as const, postAt: at(-2) },
      { status: 'scheduled' as const, postAt: at(3) },
      { status: 'approved' as const, postAt: at(4) },
      { status: 'scheduled' as const, postAt: at(30) }, // tomorrow
      { status: 'waiting' as const, postAt: at(50) },
      { status: 'posted' as const, postAt: at(-40) }, // two days ago
    ]
    const day = dayOf(posts, new Date(NOW))
    expect(day).toMatchObject({ out: 1, going: 2, waiting: 1 })
  })

  it('gives each name the same colour every time', () => {
    expect(hueOf('Lovable')).toBe(hueOf('Lovable'))
    expect(hueOf('Lovable')).toBeGreaterThanOrEqual(0)
    expect(hueOf('Lovable')).toBeLessThan(360)
  })
})

describe('Analytics: the week', () => {
  it('adds up the views of what went out, each day, and how many went out', () => {
    const posts = [
      { status: 'posted' as const, postAt: at(-1), createdAt: at(-5), views: { a: 1000, b: 500 } as Record<string, number> },
      { status: 'posted' as const, postAt: at(-26), createdAt: at(-30), views: { a: 2000 } as Record<string, number> },
      { status: 'error' as const, postAt: at(-3), createdAt: at(-6), views: null },
      { status: 'scheduled' as const, postAt: at(5), createdAt: at(-1), views: null },
      { status: 'posted' as const, postAt: at(-24 * 9), createdAt: at(-24 * 9), views: { a: 9999 } as Record<string, number> }, // too old
    ]
    const w = weekOf(posts, NOW)
    expect(w.views).toBe(3500)
    expect(w.counts).toEqual({ posted: 2, scheduled: 1, waiting: 0, failed: 1 })
    expect(w.total).toBe(4)
    expect(w.rate).toBe(67)
    expect(w.days).toHaveLength(7)
    expect(w.days[6].out).toBe(1)
    expect(w.days.reduce((n, d) => n + d.out, 0)).toBe(2)
  })

  it('has no rate before anything went out or failed', () => {
    expect(weekOf([], NOW).rate).toBeNull()
  })
})
