import { describe, expect, it } from 'vitest'

import { forwardOnly } from './forwardOnly'

describe('forwardOnly', () => {
  it('leaves well-ordered timestamps untouched', () => {
    const next = forwardOnly()
    expect([0, 0.033, 0.066, 1.5].map(next)).toEqual([0, 0.033, 0.066, 1.5])
  })

  it('never lets a timestamp go backwards or repeat', () => {
    const next = forwardOnly()
    const out = [1.5789569, 1.5704081, 1.5704081, 1.6].map(next)
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1])
    expect(out[0]).toBe(1.5789569)
    expect(out[3]).toBe(1.6)
  })
})
