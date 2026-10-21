import { describe, expect, it } from 'vitest'

import { afterMixing, daysLine, emptyScript, mixesOf, perDayCounts, spreadOver, type FormatScript, type FormatTake } from './formats'
import type { CampaignPlace } from './posting'

const place: CampaignPlace = { accounts: ['tt'], times: ['12:00', '15:00', '18:00'] }
const MORNING = new Date(2026, 9, 19, 8, 0) // a Monday
const NIGHT = new Date(2026, 9, 19, 21, 30)

describe('spreading a format over the days', () => {
  it('shares the videos out as evenly as it can, starting on the first day', () => {
    expect(perDayCounts(4, 7)).toEqual([1, 1, 0, 1, 0, 1, 0])
    expect(perDayCounts(7, 7)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(perDayCounts(10, 5)).toEqual([2, 2, 2, 2, 2])
    expect(perDayCounts(3, 5)).toEqual([1, 1, 0, 1, 0])
  })

  it('puts a week of videos on the campaign times, from today', () => {
    const slots = spreadOver({ count: 7, days: 7, place, campaignId: 'c', now: MORNING })
    expect(slots).toHaveLength(7)
    expect(slots[0].date).toBe('2026-10-19')
    expect(new Set(slots.map((s) => s.date)).size).toBe(7)
    expect(slots.every((s) => place.times.includes(s.time))).toBe(true)
  })

  it('starts tomorrow when today has no time left an hour ahead', () => {
    const slots = spreadOver({ count: 5, days: 5, place, campaignId: 'c', now: NIGHT })
    expect(slots[0].date).toBe('2026-10-20')
    expect(slots.at(-1)!.date).toBe('2026-10-24')
  })

  it('keeps clear of the times a day already holds', () => {
    const slots = spreadOver({ count: 7, days: 7, place, campaignId: 'c', now: MORNING, taken: (d) => (d === '2026-10-20' ? ['12:00'] : []) })
    const tuesday = slots.find((s) => s.date === '2026-10-20')!
    const at = Number(tuesday.time.slice(0, 2)) * 60 + Number(tuesday.time.slice(3, 5))
    expect(Math.abs(at - 12 * 60)).toBeGreaterThanOrEqual(20)
  })

  it('gives every video a time, more a day when there are many', () => {
    const slots = spreadOver({ count: 12, days: 5, place, campaignId: 'c', now: MORNING })
    expect(slots).toHaveLength(12)
    const perDay = Object.values(slots.reduce<Record<string, number>>((n, s) => ({ ...n, [s.date]: (n[s.date] ?? 0) + 1 }), {}))
    expect(Math.max(...perDay) - Math.min(...perDay)).toBeLessThanOrEqual(1)
    expect(slots.every((s) => s.date <= '2026-10-23')).toBe(true)
  })

  it('makes nothing of nothing', () => {
    expect(spreadOver({ count: 0, days: 7, place, campaignId: 'c', now: MORNING })).toEqual([])
  })
})

describe('a format month in one go: the script mixed into videos', () => {
  const HOUR = 3_600_000
  // Take k of a line, filmed in session k (an hour apart), `offset` minutes in.
  const take = (line: string, k: number, offset = 0, filmed = true): FormatTake => ({
    id: `${line}${k}`,
    name: `${line}${k}.mov`,
    type: 'video/quicktime',
    size: 1000 + k,
    fp: `fp-${line}${k}`,
    ...(filmed ? { filmedAt: k * HOUR + offset * 60_000 } : {}),
  })
  const script = (counts: number[], filmed = true): FormatScript => ({
    ...emptyScript('f1'),
    lines: counts.map((n, i) => ({
      id: `l${i}`,
      words: `Line ${i + 1}`,
      takes: Array.from({ length: n }, (_, k) => take('abcd'[i], k, i, filmed)),
    })),
  })
  const ids = (mixes: FormatTake[][]) => mixes.map((mix) => mix.map((t) => t.id).join(' '))

  it('makes one video per opening, every take of every line once, takes filmed together together', () => {
    const mixes = mixesOf(script([30, 30, 30, 30]))
    expect(mixes).toHaveLength(30)
    expect(ids(mixes).slice(0, 2)).toEqual(['a0 b0 c0 d0', 'a1 b1 c1 d1'])
    for (const line of [1, 2, 3]) expect(new Set(mixes.map((mix) => mix[line].id)).size).toBe(30)
  })

  it('goes round a line with fewer takes, evenly', () => {
    const mixes = mixesOf(script([6, 6, 6, 2]))
    const linkInBio = mixes.map((mix) => mix[3].id)
    expect(linkInBio.filter((id) => id === 'd0')).toHaveLength(3)
    expect(linkInBio.filter((id) => id === 'd1')).toHaveLength(3)
    // Every video still opens its own way.
    expect(new Set(mixes.map((mix) => mix[0].id)).size).toBe(6)
  })

  it('without filming times, pairs takes by their place in the line', () => {
    expect(ids(mixesOf(script([3, 3], false)))).toEqual(['a0 b0', 'a1 b1', 'a2 b2'])
  })

  it('makes nothing until every line has a take', () => {
    expect(mixesOf(script([5, 5, 0]))).toEqual([])
    expect(mixesOf(script([0, 5]))).toEqual([])
    expect(mixesOf(emptyScript('f1'))).toEqual([])
  })

  it('a one-line format: each take its own video', () => {
    expect(ids(mixesOf(script([3])))).toEqual(['a0', 'a1', 'a2'])
  })

  it('once made, the openings are gone for good and the rest counted - new openings use the least used takes', () => {
    const first = script([2, 3, 1])
    const mixes = mixesOf(first)
    const after = afterMixing(first, mixes)
    expect(after.lines[0].takes).toEqual([])
    expect(after.opened).toEqual(['fp-a0', 'fp-a1'])
    expect(after.uses).toEqual({ b0: 1, b1: 1, c0: 2 })
    expect(mixesOf(after)).toEqual([])
    // Next month: two new openings. The take of line 2 not used yet goes first.
    const next = { ...after, lines: after.lines.map((line, i) => (i === 0 ? { ...line, takes: [take('a', 5), take('a', 6)] } : line)) }
    expect(mixesOf(next)[0].map((t) => t.id)).toEqual(['a5', 'b2', 'c0'])
  })
})

describe('daysLine', () => {
  it('names the days of a week, and the first and last of a month', () => {
    expect(daysLine([{ date: '2026-10-19', time: '12:00' }, { date: '2026-10-21', time: '12:00' }])).toBe(
      ['2026-10-19', '2026-10-21'].map((d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })).join(', '),
    )
    const month = Array.from({ length: 30 }, (_, d) => ({ date: `2026-11-${String(d + 1).padStart(2, '0')}`, time: '12:00' }))
    expect(daysLine(month)).toMatch(/ to /)
  })
})
