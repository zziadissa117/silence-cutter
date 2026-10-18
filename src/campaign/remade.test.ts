import { describe, expect, it } from 'vitest'

import { isBeingRemade, type ServerPost } from './posting'

const NOW = Date.parse('2026-10-18T15:00:00Z')
const post = (over: Partial<ServerPost>): ServerPost => ({ key: 'job-1', status: 'waiting', postAt: null, ...over }) as ServerPost

describe('a post he is making again (Edit again)', () => {
  const remaking = new Set(['job-1'])

  it('leaves Posts while it is waiting, ready to post, or scheduled ahead', () => {
    expect(isBeingRemade(post({ status: 'waiting' }), remaking, NOW)).toBe(true)
    expect(isBeingRemade(post({ status: 'waiting', ready: true }), remaking, NOW)).toBe(true)
    expect(isBeingRemade(post({ status: 'scheduled', postAt: '2026-10-18T18:00:00Z' }), remaking, NOW)).toBe(true)
  })

  it('stays when it already went out, or was stopped', () => {
    expect(isBeingRemade(post({ status: 'posted' }), remaking, NOW)).toBe(false)
    expect(isBeingRemade(post({ status: 'scheduled', postAt: '2026-10-18T14:00:00Z' }), remaking, NOW)).toBe(false)
    expect(isBeingRemade(post({ status: 'rejected' }), remaking, NOW)).toBe(false)
  })

  it('leaves every other post alone', () => {
    expect(isBeingRemade(post({ key: 'job-2' }), remaking, NOW)).toBe(false)
  })
})
