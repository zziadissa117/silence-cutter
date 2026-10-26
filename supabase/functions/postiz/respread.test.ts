import { describe, expect, it } from 'vitest'

import { batchChoices, batchJitter } from './batch.ts'
import { RESPREAD_LEAD_MS, planRespread, type RespreadRow } from './respread.ts'
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
  const row = (date: string, time: string, status = 'scheduled', over: Partial<RespreadRow> = {}): RespreadRow => {
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
      row('2026-10-26', '14:10', 'scheduled'),
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
    const rows = [row('2026-10-28', '12:00'), row('2026-10-28', '12:30', 'scheduled', { campaign_id: 'c2' })]
    const { moves } = planRespread(rows, { now, tz: TZ })
    expect(moves).toHaveLength(2)
  })
})
