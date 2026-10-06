import { describe, expect, it } from 'vitest'

import { PULL_OVERLAP_MS, pullFrom, readTo } from './cloud'

describe('pulling the shared setups', () => {
  it('asks from a little before where the last sync read to', () => {
    const since = '2026-10-06T05:55:46.809+00:00'
    expect(Date.parse(pullFrom(since)!)).toBe(Date.parse(since) - PULL_OVERLAP_MS)
  })
  it('asks for everything the first time', () => {
    expect(pullFrom(null)).toBeNull()
  })
  it('never moves back where it has read to', () => {
    const since = '2026-10-06T05:55:46.809+00:00'
    // Nothing new: the server echoes the earlier moment it was asked from.
    expect(readTo(since, pullFrom(since))).toBe(since)
    expect(readTo(since, '2026-10-06T05:56:00.000+00:00')).toBe('2026-10-06T05:56:00.000+00:00')
    expect(readTo(null, since)).toBe(since)
    expect(readTo(since, null)).toBe(since)
  })
})
