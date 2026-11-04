import { describe, expect, it } from 'vitest'

import { countBefore } from './dayRoom.ts'

describe("a campaign's day, counted by posts scheduled at the same moment", () => {
  const rows = [
    { id: 'a', status: 'scheduled', created_at: '2026-11-04T10:00:05Z' },
    { id: 'b', status: 'approved', created_at: '2026-11-04T10:00:01Z' },
    { id: 'c', status: 'approved', created_at: '2026-11-04T10:00:09Z' },
  ]

  it('counts what is scheduled, and of the rest only those that came first', () => {
    expect(countBefore(rows, { id: 'x', created_at: '2026-11-04T10:00:03Z' })).toBe(2) // a, b
    expect(countBefore(rows, { id: 'x', created_at: '2026-11-04T10:00:00Z' })).toBe(1) // a only
  })

  it('gives each of five sent together a different count, so only the first few keep the day', () => {
    const five = ['1', '2', '3', '4', '5'].map((id) => ({ id, status: 'approved', created_at: '2026-11-04T10:00:00Z' }))
    const counts = five.map((p) => countBefore(five.filter((r) => r.id !== p.id), p))
    expect(counts).toEqual([0, 1, 2, 3, 4])
    // One a day: only the first stays.
    expect(counts.filter((n) => n < 1)).toHaveLength(1)
  })
})
