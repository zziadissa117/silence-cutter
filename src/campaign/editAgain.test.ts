import { describe, expect, it } from 'vitest'
import { goingOutJobs, stillToGoOut } from './posting'
import { EDIT_WINDOW_MS, GOING_OUT_KEEP_MS, jobOfPostKey, postKeyOf, stillKept } from './store'

describe('post keys for an edited video', () => {
  it('first go is the job id, each later go its own key', () => {
    expect(postKeyOf('abc')).toBe('abc')
    expect(postKeyOf('abc', 1)).toBe('abc')
    expect(postKeyOf('abc', 2)).toBe('abc~2')
    expect(postKeyOf('abc', 3)).toBe('abc~3')
  })
  it('finds the job from any of its post keys', () => {
    expect(jobOfPostKey('abc')).toBe('abc')
    expect(jobOfPostKey('abc~3')).toBe('abc')
  })
  it('keeps the recording two hours', () => {
    expect(EDIT_WINDOW_MS).toBe(7_200_000)
  })
})

describe('a video can be edited again until its post goes out (his ask, 2026-11-13)', () => {
  const now = Date.parse('2026-11-13T12:00:00Z')
  const hours = (h: number) => now - h * 3_600_000

  it('knows which posts have not gone out', () => {
    expect(stillToGoOut({ status: 'waiting', postAt: null }, now)).toBe(true)
    expect(stillToGoOut({ status: 'approved', postAt: null }, now)).toBe(true)
    expect(stillToGoOut({ status: 'scheduled', postAt: '2026-11-14T10:00:00Z' }, now)).toBe(true)
    expect(stillToGoOut({ status: 'scheduled', postAt: '2026-11-13T10:00:00Z' }, now)).toBe(false)
    expect(stillToGoOut({ status: 'posted', postAt: null }, now)).toBe(false)
    expect(stillToGoOut({ status: 'rejected', postAt: null }, now)).toBe(false)
    expect([...goingOutJobs([{ key: 'a~2', status: 'waiting', postAt: null }, { key: 'b', status: 'posted', postAt: null }], now)]).toEqual(['a'])
  })

  it('keeps the recording past two hours while its post waits, and lets it go once it is out', () => {
    const job = { id: 'a', madeAt: hours(30) }
    expect(stillKept(job, new Set(['a']), EDIT_WINDOW_MS, now)).toBe(true)
    expect(stillKept(job, new Set(), EDIT_WINDOW_MS, now)).toBe(false)
    // Inside the two hours, either way.
    expect(stillKept({ id: 'b', madeAt: hours(1) }, new Set(), EDIT_WINDOW_MS, now)).toBe(true)
    // Not for ever on a phone's disk.
    expect(stillKept({ id: 'a', madeAt: now - GOING_OUT_KEEP_MS - 1 }, new Set(['a']), EDIT_WINDOW_MS, now)).toBe(false)
  })
})
