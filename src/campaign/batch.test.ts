import { describe, expect, it } from 'vitest'

import { combos, dayTimes, emptyBank, headlinesFrom, pickBatch, planSlots, spend, type BankFile, type BatchBank } from './batch'

const files = (prefix: string, n: number): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}.mov`, type: 'video/quicktime', size: 1 }))

/** The same "random" every run. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

const bank = (): BatchBank => ({
  ...emptyBank('polsia', 'polsia-a1'),
  reactions: files('r', 6),
  products: files('p', 3),
  headlines: ['POV: your nails', 'wait for it', 'no way this works', 'I was today years old'],
  music: files('m', 2),
})

const count = (values: (string | null)[]) => values.reduce<Record<string, number>>((n, v) => (v ? { ...n, [v]: (n[v] ?? 0) + 1 } : n), {})

describe('mixing a batch', () => {
  it('uses everything evenly: nothing comes round again before everything has', () => {
    const { picks } = pickBatch(bank(), 21, seeded(1))
    expect(picks).toHaveLength(21)
    const reactions = Object.values(count(picks.map((p) => p.reaction)))
    expect(reactions).toHaveLength(6)
    expect(Math.max(...reactions) - Math.min(...reactions)).toBeLessThanOrEqual(1)
    expect(Object.values(count(picks.map((p) => p.product)))).toEqual([7, 7, 7])
    const headlines = Object.values(count(picks.map((p) => p.headline)))
    expect(Math.max(...headlines) - Math.min(...headlines)).toBeLessThanOrEqual(1)
    const music = Object.values(count(picks.map((p) => p.music)))
    expect(Math.max(...music) - Math.min(...music)).toBeLessThanOrEqual(1)
  })

  it('never puts the same reaction, or the same pair, twice in a row', () => {
    const { picks } = pickBatch(bank(), 40, seeded(7))
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].reaction).not.toBe(picks[i - 1].reaction)
    }
  })

  it('is in a different order each time', () => {
    const a = pickBatch(bank(), 6, seeded(1)).picks.map((p) => p.reaction).join()
    const b = pickBatch(bank(), 6, seeded(2)).picks.map((p) => p.reaction).join()
    expect(a).not.toBe(b)
  })

  it('carries on where the last batch left off', () => {
    const first = pickBatch(bank(), 4, seeded(3))
    const next = pickBatch({ ...bank(), used: first.used, lastPair: first.lastPair, made: first.made }, 2, seeded(4))
    const all = [...first.picks, ...next.picks].map((p) => p.reaction)
    // Six reactions, six videos: each once.
    expect(new Set(all).size).toBe(6)
  })

  it('works with one of everything, and with no music', () => {
    const { picks } = pickBatch({ ...bank(), reactions: files('r', 1), products: files('p', 1), headlines: ['one'], music: [] }, 3, seeded(5))
    expect(picks).toEqual(Array(3).fill({ reaction: 'r1', product: 'p1', headline: 'one', music: null }))
  })

  it('makes nothing from an empty bank', () => {
    expect(pickBatch({ ...bank(), products: [] }, 3).picks).toEqual([])
  })
})

describe('his bank: 6 reactions, 1 product, 4 headlines, 2 tracks, 4 a day', () => {
  const his = (): BatchBank => ({
    ...emptyBank('polsia', 'polsia-a1'),
    reactions: files('r', 6),
    products: files('p', 1),
    headlines: ['h1', 'h2', 'h3', 'h4'],
    music: files('m', 2),
  })
  const key = (p: { reaction: string; product: string; headline: string; music: string | null }) => `${p.reaction}|${p.headline}|${p.music}`

  it('makes all 48 different videos before any comes twice - a week at a time', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rand = seeded(seed)
      const week1 = pickBatch(his(), 28, rand)
      const week2 = pickBatch({ ...his(), used: week1.used, lastPair: week1.lastPair, made: week1.made }, 28, rand)
      const all = [...week1.picks, ...week2.picks]
      expect(new Set(all.slice(0, 48).map(key)).size).toBe(48)
      // Then a new round: the next 8 are different from each other too.
      expect(new Set(all.slice(48).map(key)).size).toBe(8)
      // Everything evenly: over the 48, each reaction 8 times, each headline
      // 12, each track 24; within the first week, never more than one apart.
      expect(Object.values(count(all.slice(0, 48).map((p) => p.reaction)))).toEqual([8, 8, 8, 8, 8, 8])
      for (const part of ['reaction', 'headline', 'music'] as const) {
        const week = Object.values(count(week1.picks.map((p) => p[part])))
        expect(Math.max(...week) - Math.min(...week)).toBeLessThanOrEqual(1)
      }
      for (let i = 1; i < all.length; i++) expect(all[i].reaction).not.toBe(all[i - 1].reaction)
    }
  })

  it('forgets combinations with an item that was taken out of the bank', () => {
    const first = pickBatch(his(), 40, seeded(9))
    const fewer = { ...his(), reactions: files('r', 5), used: first.used, lastPair: first.lastPair, made: first.made }
    // 5 x 4 x 2 = 40 combinations; the ones made with r1-r5 still count.
    const next = pickBatch(fewer, 10, seeded(10))
    const before = new Set(first.picks.filter((p) => p.reaction !== 'r6').map(key))
    const fresh = next.picks.filter((p) => !before.has(key(p)))
    expect(fresh.length).toBe(Math.min(10, 40 - before.size))
  })
})

describe('a bank that has made every video it can', () => {
  const his = (): BatchBank => ({
    ...emptyBank('polsia', 'polsia-a1'),
    reactions: files('r', 6),
    products: files('p', 1),
    headlines: ['h1', 'h2', 'h3', 'h4'],
    music: files('m', 2),
  })

  it('counts down: 48, then 20 left after a week', () => {
    expect(combos(his())).toEqual({ total: 48, left: 48 })
    const week = pickBatch(his(), 28, seeded(1))
    expect(combos({ ...his(), made: week.made })).toEqual({ total: 48, left: 20 })
    const rest = pickBatch({ ...his(), used: week.used, lastPair: week.lastPair, made: week.made }, 20, seeded(2))
    expect(combos({ ...his(), made: rest.made })).toEqual({ total: 48, left: 0 })
  })

  it('then lets the footage go and keeps the headlines and music', () => {
    const full = { ...his(), made: pickBatch(his(), 48, seeded(3)).made }
    const { bank, retired } = spend(full, '2026-10-10')
    expect(bank.reactions).toEqual([])
    expect(bank.products).toEqual([])
    expect(bank.headlines).toEqual(['h1', 'h2', 'h3', 'h4'])
    expect(bank.music.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(bank.spent).toEqual({ videos: 48, through: '2026-10-10' })
    expect(retired.sort()).toEqual(['p1', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    expect(combos(bank)).toEqual({ total: 0, left: 0 })
  })

  it('has nothing to count with no footage', () => {
    expect(combos({ ...his(), reactions: [] })).toEqual({ total: 0, left: 0 })
  })
})

describe('headlines pasted in', () => {
  it('are one a line, with blanks and repeats taken out', () => {
    expect(headlinesFrom('POV: your nails\n\n  wait for it \nPOV: YOUR NAILS\n')).toEqual(['POV: your nails', 'wait for it'])
  })
})

describe('when a batch posts', () => {
  const polsia = ['08:00', '11:00', '14:00', '17:00', '20:00', '23:00']

  it('spreads the day\'s videos over the campaign\'s times', () => {
    expect(dayTimes(polsia, 3)).toEqual(['08:00', '14:00', '20:00'])
    expect(dayTimes(polsia, 4)).toEqual(['08:00', '14:00', '17:00', '23:00'])
    expect(dayTimes(polsia, 6)).toEqual(polsia)
    expect(dayTimes(polsia, 9)).toEqual(polsia)
    expect(dayTimes(['20:00', '08:00', 'nope'], 1)).toEqual(['08:00'])
  })

  it('starts today with the times still an hour away, then whole days', () => {
    const now = new Date(2026, 8, 30, 12, 30)
    const slots = planSlots({ times: polsia, perDay: 3, days: 2, now })
    expect(slots).toEqual([
      { date: '2026-09-30', time: '14:00' },
      { date: '2026-09-30', time: '20:00' },
      { date: '2026-10-01', time: '08:00' },
      { date: '2026-10-01', time: '14:00' },
      { date: '2026-10-01', time: '20:00' },
    ])
  })

  it('starts tomorrow when today has no time left', () => {
    const slots = planSlots({ times: polsia, perDay: 3, days: 1, now: new Date(2026, 8, 30, 19, 30) })
    expect(slots.map((s) => s.date)).toEqual(['2026-10-01', '2026-10-01', '2026-10-01'])
  })

  it('carries on the day after the last batch', () => {
    const slots = planSlots({ times: polsia, perDay: 3, days: 7, madeThrough: '2026-10-06', now: new Date(2026, 8, 30, 9, 0) })
    expect(slots[0]).toEqual({ date: '2026-10-07', time: '08:00' })
    expect(slots).toHaveLength(21)
    expect(slots[20]).toEqual({ date: '2026-10-13', time: '20:00' })
  })

  it('makes nothing with no posting times', () => {
    expect(planSlots({ times: [], perDay: 3, days: 7 })).toEqual([])
  })

  it("takes each day's own times from a campaign's random window", () => {
    const own: Record<string, string[]> = { '2026-10-07': ['11:12', '16:40'], '2026-10-08': ['09:55', '19:03'] }
    const slots = planSlots({ times: (date) => own[date] ?? [], perDay: 2, days: 2, madeThrough: '2026-10-06', now: new Date(2026, 8, 30, 9, 0) })
    expect(slots).toEqual([
      { date: '2026-10-07', time: '11:12' },
      { date: '2026-10-07', time: '16:40' },
      { date: '2026-10-08', time: '09:55' },
      { date: '2026-10-08', time: '19:03' },
    ])
  })
})
