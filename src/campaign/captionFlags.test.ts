import { describe, expect, it } from 'vitest'

import { centsLabel, estimateRecheckCents, flaggedPhrases, nearMiss } from './captionFlags'

describe('nearMiss', () => {
  it('spots a campaign term heard slightly wrong', () => {
    expect(nearMiss('I use pump fund every day', ['Pump.fun'])).toBe(true)
    expect(nearMiss('ask inflow pay today', ['Inflowpay'])).toBe(true)
  })
  it('does not flag the term itself or unrelated words', () => {
    expect(nearMiss('I use Pump.fun every day', ['Pump.fun'])).toBe(false)
    expect(nearMiss('the weather is nice', ['Pump.fun'])).toBe(false)
  })
  it('ignores terms that are too short to judge', () => {
    expect(nearMiss('a big cat', ['bat'])).toBe(false)
  })
})

describe('flaggedPhrases', () => {
  const phrases = [
    { text: 'hello there', start: 0, end: 1 },
    { text: 'pump fund is great', start: 1, end: 2 },
    { text: 'next part', start: 5, end: 6 },
    { text: 'last bit', start: 9, end: 10 },
  ]
  it('flags changed, near-miss and phrases beside a risky sound', () => {
    const out = flaggedPhrases(phrases, { vocabulary: ['Pump.fun'], changed: new Set([0]), risky: [{ start: 6.2, end: 6.8 }] })
    expect([...out].sort()).toEqual([0, 1, 2])
  })
})

describe('estimateRecheckCents', () => {
  it('is a few cents for a normal video and grows with length', () => {
    const short = estimateRecheckCents(Array(20).fill('this is a caption phrase'))
    const long = estimateRecheckCents(Array(80).fill('this is a caption phrase'))
    expect(short).toBeGreaterThan(0.5)
    expect(short).toBeLessThan(6)
    expect(long).toBeGreaterThan(short)
  })
})

describe('centsLabel', () => {
  it('reads plainly', () => {
    expect(centsLabel(0.4)).toBe('under 1¢')
    expect(centsLabel(2.4)).toBe('about 2¢')
  })
})
