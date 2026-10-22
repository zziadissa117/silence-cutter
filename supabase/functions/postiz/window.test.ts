import { describe, expect, it } from 'vitest'

import { DEFAULT_WINDOW, LEAST_GAP_MINUTES, cleanWindow, fits, gapFor, lengthOf, pastMidnight, windowTimes } from './window'
import { nextSlot, pickTime, timesFor, timesOn, zoned } from './slots'

const WINDOW = { from: '10:00', to: '22:00', perDay: 3 }
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

describe('random times inside a window', () => {
  it('gives the same times for the same campaign and day', () => {
    expect(windowTimes(WINDOW, 'inflow', '2026-10-09')).toEqual(windowTimes(WINDOW, 'inflow', '2026-10-09'))
  })

  it('gives different times on different days, and to different campaigns', () => {
    const days = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map((d) => windowTimes(WINDOW, 'inflow', d).join())
    expect(new Set(days).size).toBeGreaterThan(1)
    expect(windowTimes(WINDOW, 'inflow', '2026-10-09')).not.toEqual(windowTimes(WINDOW, 'vertus', '2026-10-09'))
  })

  it('keeps every time inside the window, in order, at least 30 minutes apart', () => {
    for (let d = 1; d <= 28; d++) {
      const times = windowTimes(WINDOW, 'inflow', `2026-10-${String(d).padStart(2, '0')}`)
      expect(times).toHaveLength(3)
      for (const t of times) {
        expect(minutes(t)).toBeGreaterThanOrEqual(10 * 60)
        // Room left for the 0-9 minutes every post lands after its time.
        expect(minutes(t)).toBeLessThanOrEqual(22 * 60 - 10)
      }
      for (let i = 1; i < times.length; i++) expect(minutes(times[i]) - minutes(times[i - 1])).toBeGreaterThanOrEqual(30)
    }
  })

  it('closes the gap below half an hour only when he wants more than fit 30 minutes apart', () => {
    const tight = { from: '18:00', to: '19:10', perDay: 6 }
    expect(fits(tight)).toBe(3)
    const times = windowTimes(tight, 'inflow', '2026-10-09')
    expect(times).toHaveLength(6)
    for (let i = 1; i < times.length; i++) expect(minutes(times[i]) - minutes(times[i - 1])).toBeGreaterThanOrEqual(12)
    // 40 a day in the whole day still fit half an hour apart.
    expect(gapFor({ from: '00:00', to: '00:00', perDay: 40 }, 40)).toBe(30)
  })

  it('fits 125 a day in a whole day, 11 minutes apart', () => {
    const allDay = { from: '01:00', to: '01:00', perDay: 125 }
    expect(gapFor(allDay, 125)).toBe(11)
    const times = windowTimes({ ...allDay, perDay: 125 }, 'lovable', '2026-10-22', gapFor(allDay, 125))
    expect(times).toHaveLength(125)
    expect(new Set(times).size).toBe(125)
    // Never closer than a minute, however many he wants.
    expect(gapFor({ from: '11:00', to: '12:00', perDay: 12 }, 500)).toBe(LEAST_GAP_MINUTES)
  })

  it('takes a window that ends at or before its start as running past midnight', () => {
    expect(lengthOf({ from: '01:00', to: '01:00' })).toBe(24 * 60)
    expect(lengthOf({ from: '22:00', to: '02:00' })).toBe(4 * 60)
    expect(pastMidnight({ from: '22:00', to: '02:00' })).toBe(true)
    expect(pastMidnight({ from: '01:00', to: '23:59' })).toBe(false)
    for (let d = 1; d <= 28; d++) {
      const times = windowTimes({ from: '22:00', to: '02:00', perDay: 4 }, 'night', `2026-10-${String(d).padStart(2, '0')}`)
      expect(times).toHaveLength(4)
      expect([...times].sort()).toEqual(times)
      for (const t of times) expect(minutes(t) >= 22 * 60 || minutes(t) <= 2 * 60 - 10).toBe(true)
    }
  })

  it('refuses a window too short to hold a time, or a silly count', () => {
    expect(cleanWindow({ from: '10:00', to: '10:05', perDay: 1 })).toBeNull()
    expect(cleanWindow({ from: '10:00', to: '22:00', perDay: 0 })).toBeNull()
    expect(cleanWindow({ from: '10:00', to: '22:00', perDay: 13 })).toBeNull()
    expect(cleanWindow({ from: '10:00', to: '22:00', perDay: 2 })).toEqual({ from: '10:00', to: '22:00', perDay: 2 })
    expect(cleanWindow({ from: '22:00', to: '10:00', perDay: 2 })).toEqual({ from: '22:00', to: '10:00', perDay: 2 })
  })
})

describe('which times a campaign posts at', () => {
  it('uses his own times when he has any, even with a window saved', () => {
    expect(timesFor({ times: ['18:00'], window: WINDOW }, 'inflow')).toEqual(['18:00'])
  })

  it('uses the window as he set it when he has none of his own', () => {
    const times = timesFor({ times: [], window: WINDOW }, 'inflow')
    expect(timesOn(times, '2026-10-09')).toEqual(windowTimes(WINDOW, 'inflow', '2026-10-09'))
    // 1 AM to midnight is used whole - not cut to the middle of the day.
    const allDay = timesFor({ times: [], window: { from: '01:00', to: '23:59', perDay: 12 } }, 'lovable')
    const day = timesOn(allDay, '2026-10-09')
    expect(day).toHaveLength(12)
    expect(day.some((t) => minutes(t) < 11 * 60 || minutes(t) > 18 * 60)).toBe(true)
  })

  it('keeps every one of his own times, night ones too', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:43`)
    expect(timesFor({ times: hourly }, 'lovable')).toEqual(hourly)
    expect(timesFor({ times: ['09:00', '18:00'] }, 'x')).toEqual(['09:00', '18:00'])
    const night = ['01:25', '02:25', '03:25', '04:25', '05:25', '06:25', '07:25', '08:25']
    expect(timesFor({ times: night }, 'reaction')).toEqual(night)
  })

  it('posts at random inside the default window with neither - never as soon as ready', () => {
    for (const place of [{ times: [] }, undefined]) {
      const times = timesFor(place, 'inflow')
      expect(typeof times).toBe('function')
      expect(timesOn(times, '2026-10-09')).toEqual(windowTimes(DEFAULT_WINDOW, 'inflow', '2026-10-09'))
    }
    expect(windowTimes(DEFAULT_WINDOW, 'inflow', '2026-10-09')).toHaveLength(DEFAULT_WINDOW.perDay)
    expect(windowTimes(DEFAULT_WINDOW, 'inflow', '2026-10-09')).not.toEqual(windowTimes(DEFAULT_WINDOW, 'inflow', '2026-10-10'))
  })

  it('gives a video coming in a random time today, not now', () => {
    const tz = 'America/Toronto'
    const now = zoned('2026-10-09', '08:00', tz)
    const times = timesFor({ times: [], window: WINDOW }, 'inflow')
    const choice = pickTime({ times, others: [], now, tz })
    expect(choice?.kind).toBe('fixed')
    const first = windowTimes(WINDOW, 'inflow', '2026-10-09')[0]
    expect(choice && 'at' in choice ? choice.slot : null).toBe(`2026-10-09 ${first}`)
  })

  it('moves on to the next day\'s own random times once today\'s are taken', () => {
    const tz = 'America/Toronto'
    const now = zoned('2026-10-09', '08:00', tz)
    const times = timesFor({ times: [], window: { ...WINDOW, perDay: 1 } }, 'inflow')
    const today = timesOn(times, '2026-10-09')[0]
    const next = nextSlot({ times, taken: new Set([`2026-10-09 ${today}`]), now, tz })
    expect(next?.slot).toBe(`2026-10-10 ${timesOn(times, '2026-10-10')[0]}`)
  })
})

describe('the default window', () => {
  it('is 11 AM to 6 PM, 3 a day', () => {
    expect(DEFAULT_WINDOW).toEqual({ from: '11:00', to: '18:00', perDay: 3 })
  })
})
