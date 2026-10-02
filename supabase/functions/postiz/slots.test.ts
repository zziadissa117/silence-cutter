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
  const clock = (ms: number) => localTime(new Date(ms), TZ)
  const late = (count: number, arrived: string, now = arrived) =>
    [
      ...spreadDay(
        Array.from({ length: count }, (_, i) => ({ id: String(i), at: null, locked: false })),
        { start: at(arrived) + 30 * 60_000, end, firstAtStart: true, now: at(now), leadMs: 5 * 60_000, minGapMs: 10 * 60_000 },
      ).values(),
    ].map(clock)

  it('one late video goes half an hour after it came in', () => {
    expect(late(1, '17:00')).toEqual(['17:30'])
  })

  it('several are evenly divided until midnight', () => {
    expect(late(2, '18:00')).toEqual(['18:30', '21:15'])
    expect(late(3, '18:00')).toEqual(['18:30', '20:20', '22:10'])
    expect(late(6, '17:00')).toEqual(['17:30', '18:35', '19:40', '20:45', '21:50', '22:55'])
  })

  it('past 11:30 PM, half an hour after, ten minutes apart', () => {
    expect(late(2, '23:45')).toEqual(['00:15', '00:25'])
  })

  it('extras go evenly between the last time and midnight', () => {
    const last = lastTimeToday(['18:00', '20:00'], DATE, TZ)!
    const extra = (count: number) =>
      [
        ...spreadDay(
          Array.from({ length: count }, (_, i) => ({ id: String(i), at: null, locked: false })),
          { start: last, end, firstAtStart: false, now: at('09:00'), leadMs: 5 * 60_000, minGapMs: 10 * 60_000 },
        ).values(),
      ].map((ms) => clock(ms - (last - at('20:00'))))
    expect(extra(1)).toEqual(['22:00'])
    expect(extra(2)).toEqual(['21:20', '22:40'])
  })

  it('ones already in Postiz keep their time; the rest spread after them', () => {
    const placed = spreadDay(
      [
        { id: 'a', at: at('18:30'), locked: true },
        { id: 'b', at: at('21:15'), locked: false },
        { id: 'c', at: null, locked: false },
      ],
      { start: at('18:30'), end, firstAtStart: true, now: at('18:40'), leadMs: 5 * 60_000, minGapMs: 10 * 60_000 },
    )
    expect(placed.has('a')).toBe(false)
    expect([...placed.values()].map(clock)).toEqual(['20:20', '22:10'])
  })

  it('never sooner than a few minutes from now', () => {
    // Approved long after their spread time: from now on, evenly.
    const placed = spreadDay(
      [
        { id: 'a', at: at('18:30'), locked: false },
        { id: 'b', at: at('21:15'), locked: false },
      ],
      { start: at('18:30'), end, firstAtStart: true, now: at('22:00'), leadMs: 5 * 60_000, minGapMs: 10 * 60_000 },
    )
    expect([...placed.values()].map(clock)).toEqual(['22:05', '23:02'])
  })

  it('holds on the night the clocks go back', () => {
    const NIGHT = '2026-10-31'
    const start = zoned(NIGHT, '22:00', TZ).getTime()
    const placed = spreadDay([{ id: 'a', at: null, locked: false }, { id: 'b', at: null, locked: false }], {
      start,
      end: endOfDay(NIGHT, TZ),
      firstAtStart: true,
      now: start - 30 * 60_000,
      leadMs: 5 * 60_000,
      minGapMs: 10 * 60_000,
    })
    expect([...placed.values()].map((ms) => localTime(new Date(ms), TZ))).toEqual(['22:00', '23:00'])
  })
})
