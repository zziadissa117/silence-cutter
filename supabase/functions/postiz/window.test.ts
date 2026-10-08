import { describe, expect, it } from 'vitest'

import { cleanWindow, fits, windowTimes } from './window'
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

  it('gives fewer times, still spaced, when the window is too short for how many he asked', () => {
    const tight = { from: '18:00', to: '19:10', perDay: 6 }
    expect(fits(tight)).toBe(3)
    const times = windowTimes(tight, 'inflow', '2026-10-09')
    expect(times).toHaveLength(3)
    for (let i = 1; i < times.length; i++) expect(minutes(times[i]) - minutes(times[i - 1])).toBeGreaterThanOrEqual(30)
  })

  it('refuses a window that ends before it starts, or a silly count', () => {
    expect(cleanWindow({ from: '22:00', to: '10:00', perDay: 2 })).toBeNull()
    expect(cleanWindow({ from: '10:00', to: '10:05', perDay: 1 })).toBeNull()
    expect(cleanWindow({ from: '10:00', to: '22:00', perDay: 0 })).toBeNull()
    expect(cleanWindow({ from: '10:00', to: '22:00', perDay: 13 })).toBeNull()
    expect(cleanWindow({ from: '10:00', to: '22:00', perDay: 2 })).toEqual({ from: '10:00', to: '22:00', perDay: 2 })
  })
})

describe('which times a campaign posts at', () => {
  it('uses his own times when he has any, even with a window saved', () => {
    expect(timesFor({ times: ['18:00'], window: WINDOW }, 'inflow')).toEqual(['18:00'])
  })

  it('uses the window when he has none of his own', () => {
    const times = timesFor({ times: [], window: WINDOW }, 'inflow')
    expect(timesOn(times, '2026-10-09')).toEqual(windowTimes(WINDOW, 'inflow', '2026-10-09'))
  })

  it('has none at all - posts as soon as ready - with neither', () => {
    expect(timesFor({ times: [] }, 'inflow')).toEqual([])
    expect(timesFor(undefined, 'inflow')).toEqual([])
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
