import { describe, expect, it } from 'vitest'

import { dayAndTime } from './PostsView'

const now = new Date(2026, 10, 24, 9, 0)
const at = (d: number, h = 10, m = 27) => new Date(2026, 10, d, h, m).toISOString()

describe('dayAndTime (his ask, 2026-11-24)', () => {
  it('today: the time only', () => expect(dayAndTime(at(24), now)).not.toMatch(/Tomorrow|November/))
  it('tomorrow: Tomorrow', () => expect(dayAndTime(at(25), now)).toMatch(/^Tomorrow · /))
  it('later: the date', () => {
    expect(dayAndTime(at(28), now)).toMatch(/^November 28th · /)
    expect(dayAndTime(at(21 + 10), now)).toMatch(/^December 1st · /)
  })
})
