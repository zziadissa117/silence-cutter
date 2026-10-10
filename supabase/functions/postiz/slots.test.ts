import { describe, expect, it } from 'vitest'

import { addDays, endOfDay, jitterMinutes, lastTimeToday, localDate, localTime, nextSlot, normalTimes, pickTime, spreadDay, zoned } from './slots.ts'

const TZ = 'America/Toronto'

describe('zoned', () => {
  it('is Montreal time, summer and winter', () => {
    expect(zoned('2026-07-01', '18:00', TZ).toISOString()).toBe('2026-07-01T22:00:00.000Z')
    expect(zoned('2026-12-01', '18:00', TZ).toISOString()).toBe('2026-12-01T23:00:00.000Z')
  })

  it('holds across the night the clocks change', () => {
    // Clocks go back at 2am on 2026-11-01.
    expect(zoned('2026-11-01', '09:00', TZ).toISOString()).toBe('2026-11-01T14:00:00.000Z')
    expect(zoned('2026-10-31', '23:00', TZ).toISOString()).toBe('2026-11-01T03:00:00.000Z')
  })

  it('round-trips through localDate and localTime', () => {
    const at = zoned('2026-09-28', '21:00', TZ)
    expect(localDate(at, TZ)).toBe('2026-09-28')
    expect(localTime(at, TZ)).toBe('21:00')
  })
})

describe('normalTimes', () => {
  it('keeps valid times, sorted, once each', () => {
    expect(normalTimes(['20:00', '18:00', 'nope', '18:00', '24:00', ' 09:30 '])).toEqual(['09:30', '18:00', '20:00'])
  })
})

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('nextSlot', () => {
  const at = (date: string, time: string) => zoned(date, time, TZ)

  it('takes the next time today', () => {
    const choice = nextSlot({ times: ['18:00', '20:00'], taken: new Set(), now: at('2026-09-28', '12:00'), tz: TZ })
    expect(choice?.slot).toBe('2026-09-28 18:00')
    const minutes = (choice!.at.getTime() - at('2026-09-28', '18:00').getTime()) / 60_000
    expect(minutes).toBe(jitterMinutes('2026-09-28 18:00'))
    expect(minutes).toBeGreaterThanOrEqual(0)
    expect(minutes).toBeLessThan(10)
  })

  it('skips taken times, then rolls to tomorrow', () => {
    const taken = new Set(['2026-09-28 18:00', '2026-09-28 20:00'])
    const choice = nextSlot({ times: ['18:00', '20:00'], taken, now: at('2026-09-28', '12:00'), tz: TZ })
    expect(choice?.slot).toBe('2026-09-29 18:00')
  })

  it('skips a time too close to now', () => {
    const choice = nextSlot({ times: ['18:00', '20:00'], taken: new Set(), now: at('2026-09-28', '18:00'), tz: TZ, leadMinutes: 10 })
    expect(choice?.slot).toBe('2026-09-28 20:00')
  })

  it('today only: nothing once the last time has gone', () => {
    const late = { times: ['21:00'], taken: new Set<string>(), tz: TZ, todayOnly: true, leadMinutes: 3 }
    expect(nextSlot({ ...late, now: at('2026-09-28', '15:00') })?.slot).toBe('2026-09-28 21:00')
    expect(nextSlot({ ...late, now: at('2026-09-28', '21:30') })).toBeNull()
  })

  it('no times, no slot', () => {
    expect(nextSlot({ times: [], taken: new Set(), now: new Date(), tz: TZ })).toBeNull()
  })

  it('six a day fill in order', () => {
    const times = ['08:00', '11:00', '14:00', '17:00', '20:00', '23:00']
    const taken = new Set<string>()
    const got: string[] = []
    for (let i = 0; i < 8; i++) {
      const choice = nextSlot({ times, taken, now: at('2026-09-28', '07:00'), tz: TZ })!
      taken.add(choice.slot)
      got.push(choice.slot)
    }
    expect(got).toEqual([
      '2026-09-28 08:00',
      '2026-09-28 11:00',
      '2026-09-28 14:00',
      '2026-09-28 17:00',
      '2026-09-28 20:00',
      '2026-09-28 23:00',
      '2026-09-29 08:00',
      '2026-09-29 11:00',
    ])
  })
})

describe('pickTime', () => {
  const DATE = '2026-09-28'
  const at = (time: string) => zoned(DATE, time, TZ)
  const PUMP = ['18:00', '20:00']

  it('on time, takes the next of the campaign\'s own times', () => {
    const choice = pickTime({ times: PUMP, others: [], now: at('09:00'), tz: TZ })
    expect(choice).toMatchObject({ kind: 'fixed', slot: `${DATE} 18:00` })
    const second = pickTime({ times: PUMP, others: [{ slot: `${DATE} 18:00`, spread: null }], now: at('09:00'), tz: TZ })
    expect(second).toMatchObject({ kind: 'fixed', slot: `${DATE} 20:00` })
  })

  it('a video beyond the day\'s times is an extra for today, not tomorrow', () => {
    const others = [
      { slot: `${DATE} 18:00`, spread: null },
      { slot: `${DATE} 20:00`, spread: null },
    ]
    expect(pickTime({ times: PUMP, others, now: at('09:00'), tz: TZ })).toEqual({ kind: 'spread', spread: 'extra', slot: `${DATE} +1` })
    expect(pickTime({ times: PUMP, others: [...others, { slot: `${DATE} +1`, spread: 'extra' as const }], now: at('09:00'), tz: TZ })).toEqual({
      kind: 'spread',
      spread: 'extra',
      slot: `${DATE} +2`,
    })
  })

  it('once a time has gone by with no video, the day runs late', () => {
    expect(pickTime({ times: PUMP, others: [], now: at('18:30'), tz: TZ })).toEqual({ kind: 'spread', spread: 'late', slot: `${DATE} +1` })
    // Still late for the next one, even with 8 PM free.
    expect(pickTime({ times: PUMP, others: [{ slot: `${DATE} +1`, spread: 'late' }], now: at('18:31'), tz: TZ })).toMatchObject({
      kind: 'spread',
      spread: 'late',
      slot: `${DATE} +2`,
    })
    // A time that went out with its video was not missed.
    expect(pickTime({ times: PUMP, others: [{ slot: `${DATE} 18:00`, spread: null }], now: at('18:30'), tz: TZ })).toMatchObject({
      kind: 'fixed',
      slot: `${DATE} 20:00`,
    })
  })

  it('made for the next days: the normal times, from tomorrow', () => {
    const tomorrow = addDays(DATE, 1)
    expect(pickTime({ times: PUMP, others: [], now: at('09:00'), tz: TZ, later: true })).toMatchObject({ kind: 'fixed', slot: `${tomorrow} 18:00` })
    const others = [
      { slot: `${tomorrow} 18:00`, spread: null },
      { slot: `${tomorrow} 20:00`, spread: null },
    ]
    expect(pickTime({ times: PUMP, others, now: at('23:00'), tz: TZ, later: true })).toMatchObject({ slot: `${addDays(DATE, 2)} 18:00` })
  })

  it('no times at all: none', () => {
    expect(pickTime({ times: [], others: [], now: at('09:00'), tz: TZ })).toBeNull()
  })
})

describe('spreadDay', () => {
  const DATE = '2026-09-28'
  const at = (time: string) => zoned(DATE, time, TZ).getTime()
  const end = endOfDay(DATE, TZ)
  const GAP = 15 * 60_000
  const members = (count: number, prefix = 'p') => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, at: null, locked: false }))
  const late = (list: { id: string; at: number | null; locked: boolean }[], arrived: string, now = arrived) =>
    spreadDay(list, { start: at(arrived) + 20 * 60_000, end, now: at(now), leadMs: 5 * 60_000, minGapMs: GAP })
  const sorted = (placed: Map<string, number>) => [...placed.values()].sort((a, b) => a - b)

  it('puts a video in at 10 PM at a random time before midnight', () => {
    const [only] = sorted(late(members(1), '22:00'))
    expect(only).toBeGreaterThanOrEqual(at('22:20'))
    expect(only).toBeLessThanOrEqual(end)
  })

  it('spreads several at random until midnight, at least 15 minutes apart, not evenly', () => {
    const times = sorted(late(members(5), '18:00'))
    expect(times[0]).toBeGreaterThanOrEqual(at('18:20'))
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(GAP)
    const gaps = times.slice(1).map((t, i) => t - times[i])
    expect(new Set(gaps).size).toBeGreaterThan(1)
  })

  it('gives different nights different times', () => {
    const one = sorted(late(members(3, 'mon'), '18:00')).map((ms) => localTime(new Date(ms), TZ))
    const two = sorted(late(members(3, 'tue'), '18:00')).map((ms) => localTime(new Date(ms), TZ))
    expect(one).not.toEqual(two)
  })

  it('keeps a video at its time when another late one arrives, unless they would collide', () => {
    const first = late(members(2), '18:00')
    const again = late(members(3), '18:00')
    for (const [id, ms] of first) {
      if ([...again.values()].every((other) => other === again.get(id) || Math.abs(other - ms) >= GAP)) {
        expect(again.get(id)).toBe(ms)
      }
    }
  })

  it('past 11:30 PM, still after it came in, 15 minutes apart past midnight', () => {
    const times = sorted(late(members(2), '23:45'))
    expect(times[0]).toBeGreaterThanOrEqual(at('23:45') + 20 * 60_000)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(GAP)
  })

  it('ones already in Postiz keep their time; the rest keep clear of them', () => {
    const locked = { id: 'a', at: at('20:00'), locked: true }
    const placed = late([locked, ...members(4)], '18:00', '18:40')
    expect(placed.has('a')).toBe(false)
    for (const ms of placed.values()) expect(Math.abs(ms - at('20:00'))).toBeGreaterThanOrEqual(GAP)
  })

  it('never sooner than a few minutes from now', () => {
    const placed = late(members(3), '18:00', '22:30')
    for (const ms of placed.values()) expect(ms).toBeGreaterThanOrEqual(at('22:35'))
  })

  it('extras go at random between the last time and midnight', () => {
    const last = lastTimeToday(['18:00', '20:00'], DATE, TZ)!
    const placed = spreadDay(members(3), { start: last, end, now: at('09:00'), leadMs: 5 * 60_000, minGapMs: GAP })
    for (const ms of placed.values()) {
      expect(ms).toBeGreaterThanOrEqual(last)
      expect(ms).toBeLessThanOrEqual(end + 2 * GAP)
    }
  })
})
