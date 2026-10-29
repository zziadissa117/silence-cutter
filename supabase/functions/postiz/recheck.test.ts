import { describe, expect, it } from 'vitest'

import { acceptFix, cleanContext, costCents, distance, recheckMessage } from './recheck.ts'

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

describe('fixes by meaning', () => {
  it('takes a misheard word put back by the sense of the video', () => {
    expect(acceptFix('I made twenty case with this', 'I made 20K with this')).toBe('I made 20K with this')
    expect(acceptFix('go by it now', 'go buy it now')).toBe('go buy it now')
    expect(acceptFix('I use virtues every day', 'I use Vertus every day')).toBe('I use Vertus every day')
  })

  it('still turns down a rewrite of what he said', () => {
    expect(acceptFix('this app is kind of crazy honestly', 'this app is honestly incredible')).toBe('this app is kind of crazy honestly')
    expect(acceptFix('so yeah', 'so yeah, you should definitely download it today')).toBe('so yeah')
  })
})

describe('recheckMessage', () => {
  it('gives Claude what the video is for, then the whole video', () => {
    const context = cleanContext({ campaign: 'Vertus', brand: ['Vertus'], about: 'An AI money app.', angle: 'Story', headline: 'I tried Vertus', junk: 1 })
    const message = recheckMessage(context, ['Vertus'], ['Vertus pays you to save.'], ['I use virtues', 'every day'])
    expect(message).toContain('Campaign: Vertus')
    expect(message).toContain('An AI money app.')
    expect(message).toContain('Headline on screen: I tried Vertus')
    expect(message).toContain('- Vertus pays you to save.')
    expect(message).toMatch(/Captions:\n1\. I use virtues\n2\. every day$/)
  })

  it('takes nothing but text from the phone', () => {
    expect(cleanContext({ campaign: 5, brand: 'x', about: null })).toEqual({ campaign: '', brand: [], about: '', angle: '', headline: '' })
  })
})
