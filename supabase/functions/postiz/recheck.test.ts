import { describe, expect, it } from 'vitest'

import { acceptFix, costCents, distance } from './recheck.ts'

describe('acceptFix', () => {
  it('takes a misheard brand fixed', () => {
    expect(acceptFix('I love pump fund', 'I love Pump.fun')).toBe('I love Pump.fun')
  })
  it('takes a capital letter fix', () => {
    expect(acceptFix('ask inflow pay', 'ask Inflowpay')).toBe('ask Inflowpay')
  })
  it('refuses a rewrite', () => {
    expect(acceptFix('so yeah this is great', 'This product is absolutely wonderful for everyone')).toBe('so yeah this is great')
  })
  it('refuses added or removed words beyond one', () => {
    expect(acceptFix('buy it now', 'buy it now before it is gone forever')).toBe('buy it now')
  })
  it('keeps the original for anything that is not a string', () => {
    expect(acceptFix('hello', 5)).toBe('hello')
    expect(acceptFix('hello', '')).toBe('hello')
  })
})

describe('distance', () => {
  it('counts changed letters', () => {
    expect(distance('kitten', 'sitting')).toBe(3)
    expect(distance('same', 'same')).toBe(0)
  })
})

describe('costCents', () => {
  it('prices tokens at the published rate', () => {
    // 1M input at $5 is 500 cents.
    expect(costCents(1_000_000, 0)).toBe(500)
    expect(costCents(0, 1_000_000)).toBe(2500)
    expect(costCents(1000, 1000)).toBeCloseTo(3, 5)
  })
})
