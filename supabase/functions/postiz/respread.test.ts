import { describe, expect, it } from 'vitest'

import { batchChoices, batchJitter } from './batch.ts'
import { RESPREAD_LEAD_MS, evenAlready, planRespread, type RespreadRow } from './respread.ts'
import { zoned } from './slots.ts'
import { evenTimes } from './window.ts'

const TZ = 'America/Toronto'
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

describe('evenly over a part of the day', () => {
  it("spreads the rest of today from a given minute, and none when there's no room", () => {
    const rest = evenTimes(6, 'c', '2026-10-26', 14 * 60, 24 * 60)
    expect(rest).toHaveLength(6)
    expect(rest.every((t) => t >= '14:00')).toBe(true)
    for (let i = 1; i < rest.length; i++) expect(minutes(rest[i]) - minutes(rest[i - 1])).toBeGreaterThanOrEqual(80 * 0.8 - 2)
    expect(evenTimes(3, 'c', '2026-10-26', 24 * 60, 24 * 60)).toEqual([])
    // More than minutes left: one a minute, as many as fit.
    expect(evenTimes(30, 'c', '2026-10-26', 23 * 60 + 50, 24 * 60)).toHaveLength(10)
  })
})

describe("a batch video's time on the server", () => {
  it('keeps an even time to the minute and moves a round one of his 0-9 minutes', () => {
    expect(batchJitter('2026-10-26 13:47')).toBe(0)
    expect(batchJitter('2026-10-26 18:00')).toBeGreaterThanOrEqual(0)
    const [first] = batchChoices({ id: 'b', date: '2026-10-26', time: '13:47', size: 1 }, ['13:47'], TZ)
    expect(first.at.getTime()).toBe(zoned('2026-10-26', '13:47', TZ).getTime())
  })
})

describe('respreading what is scheduled', () => {
  // Monday 26 Oct 2026, 2 PM in Toronto.
  const now = zoned('2026-10-26', '14:00', TZ).getTime()
  let n = 0
  const row = (date: string, time: string, status = 'approved', over: Partial<RespreadRow> = {}): RespreadRow => {
    n++
    return {
      id: `p${String(n).padStart(3, '0')}`,
      campaign_id: 'c1',
      status,
      post_at: zoned(date, time, TZ).toISOString(),
      created_at: new Date(Date.UTC(2026, 9, 20, 0, n)).toISOString(),
      creating_at: null,
      slot: `${date} ${time}`,
      batch: { date, time },
      ...over,
    }
  }

  it('spreads a day squeezed into 11 AM - 5 PM over the whole day, evenly', () => {
    const squeezed = Array.from({ length: 10 }, (_, i) => row('2026-10-28', `${String(11 + Math.floor(i * 0.6)).padStart(2, '0')}:${String((i * 36) % 60).padStart(2, '0')}`))
    const { moves, pending } = planRespread(squeezed, { now, tz: TZ })
    expect(pending).toBe(0)
    const times = moves.map((m) => m.time).sort()
    expect(times).toHaveLength(10)
    expect(times[0] < '03:00').toBe(true)
    expect(times[9] > '21:00').toBe(true)
    for (let i = 1; i < times.length; i++) {
      const gap = minutes(times[i]) - minutes(times[i - 1])
      expect(gap).toBeGreaterThanOrEqual(144 * 0.8 - 2)
      expect(gap).toBeLessThanOrEqual(144 * 1.2 + 2)
    }
    // To the minute (an even time is never round), and slot and time agree.
    for (const m of moves) {
      expect(m.slot).toBe(`2026-10-28 ${m.time}`)
      expect(Date.parse(m.postAt)).toBe(zoned('2026-10-28', m.time, TZ).getTime())
    }
  })

  it('works out the same plan again: what is already in place stays', () => {
    const day = Array.from({ length: 5 }, (_, i) => row('2026-10-29', `1${i}:00`))
    const first = planRespread(day, { now, tz: TZ }).moves
    const placed = day.map((r) => {
      const m = first.find((x) => x.id === r.id)!
      return { ...r, slot: m.slot, post_at: m.postAt, batch: { date: m.date, time: m.time } }
    })
    expect(planRespread(placed, { now, tz: TZ }).moves).toEqual([])
  })

  it('today: only what is left of the day, after the next 20 minutes; what is out or about to go stays', () => {
    const today = [
      row('2026-10-26', '11:00', 'posted'),
      row('2026-10-26', '14:10', 'approved'),
      row('2026-10-26', '15:00'),
      row('2026-10-26', '15:30'),
      row('2026-10-26', '16:00', 'waiting'),
    ]
    const { moves } = planRespread(today, { now, tz: TZ })
    const moved = new Set(moves.map((m) => m.id))
    expect(moved.has(today[0].id)).toBe(false)
    expect(moved.has(today[1].id)).toBe(false)
    expect(moves).toHaveLength(3)
    for (const m of moves) expect(Date.parse(m.postAt)).toBeGreaterThan(now + RESPREAD_LEAD_MS)
    expect(moves.map((m) => m.time).sort()[2] > '21:00').toBe(true)
  })

  it('leaves days gone by, other things, and a day one of whose videos is going into Postiz this moment', () => {
    const rows = [
      row('2026-10-25', '12:00'),
      row('2026-10-27', '12:00', 'rejected'),
      row('2026-10-30', '12:00', 'approved', { creating_at: new Date(now).toISOString() }),
      row('2026-10-30', '13:00'),
    ]
    const { moves, pending } = planRespread(rows, { now, tz: TZ })
    expect(moves).toEqual([])
    expect(pending).toBe(2)
  })

  it('keeps each campaign to its own days', () => {
    const rows = [
      row('2026-10-28', '12:00'),
      row('2026-10-28', '13:00'),
      row('2026-10-28', '12:30', 'approved', { campaign_id: 'c2' }),
      row('2026-10-28', '13:30', 'waiting', { campaign_id: 'c2' }),
    ]
    const { moves } = planRespread(rows, { now, tz: TZ })
    expect(moves).toHaveLength(4)
    const c1 = moves.filter((m) => rows.find((r) => r.id === m.id)!.campaign_id === 'c1').map((m) => minutes(m.time))
    expect(Math.abs(c1[1] - c1[0])).toBeGreaterThan(500)
  })

  it('never takes one out of Postiz, and leaves a day with one in Postiz as it is', () => {
    const squeezed = Array.from({ length: 6 }, (_, i) => row('2026-10-28', `${11 + i}:00`, i === 0 ? 'scheduled' : 'approved'))
    expect(planRespread(squeezed, { now, tz: TZ }).moves).toEqual([])
    const inPostiz = Array.from({ length: 6 }, (_, i) => row('2026-10-29', `${11 + i}:00`, 'scheduled'))
    expect(planRespread(inPostiz, { now, tz: TZ }).moves).toEqual([])
  })

  it("leaves a day the batch already made even, though its times aren't the respread's own", () => {
    const made = evenTimes(25, 'c1', '2026-10-29').map((t) => row('2026-10-29', t))
    expect(planRespread(made, { now, tz: TZ }).moves).toEqual([])
  })

  it('leaves the rest of today once it is even, however late it gets', () => {
    const today = Array.from({ length: 8 }, (_, i) => row('2026-10-26', `${String(15 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '05'}`))
    const first = planRespread(today, { now, tz: TZ }).moves
    expect(first).toHaveLength(8)
    let placed = today.map((r) => {
      const m = first.find((x) => x.id === r.id)!
      return { ...r, slot: m.slot, post_at: m.postAt, batch: { date: m.date, time: m.time } }
    })
    for (const at of ['14:30', '16:45', '19:10', '22:40']) {
      const later = zoned('2026-10-26', at, TZ).getTime()
      // What has gone out by then stays out.
      placed = placed.map((r) => (Date.parse(r.post_at!) < later ? { ...r, status: 'posted' } : r))
      expect(planRespread(placed, { now: later, tz: TZ }).moves).toEqual([])
    }
  })
})

describe('already evenly apart', () => {
  it('tells an even day from a squeezed or lopsided one', () => {
    const even = evenTimes(10, 'x', '2026-10-28').map(minutes)
    expect(evenAlready(even, 0)).toBe(true)
    // Six between 11 and 5: the night is one big hole.
    expect(evenAlready([660, 720, 780, 840, 900, 960], 0)).toBe(false)
    // Two side by side in an otherwise even day.
    expect(evenAlready([...even.slice(0, 9), even[8] + 3], 0)).toBe(false)
    // Today's rest bunched up in its first hour, with the evening empty.
    expect(evenAlready([1000, 1010, 1020, 1030], 990)).toBe(false)
    // One alone is wherever it is.
    expect(evenAlready([700], 0)).toBe(true)
  })
})
