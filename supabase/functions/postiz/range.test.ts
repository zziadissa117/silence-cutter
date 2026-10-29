import { describe, expect, it } from 'vitest'

import { byteRange } from './range'

describe('byteRange', () => {
  it('is the whole file without a header', () => {
    expect(byteRange(null, 100)).toBeNull()
    expect(byteRange('bytes=-', 100)).toBeNull()
  })

  it('reads what Safari asks for first, an open end and a last few bytes', () => {
    expect(byteRange('bytes=0-1', 100)).toEqual([0, 1])
    expect(byteRange('bytes=50-', 100)).toEqual([50, 99])
    expect(byteRange('bytes=-10', 100)).toEqual([90, 99])
    expect(byteRange('bytes=90-500', 100)).toEqual([90, 99])
  })

  it('refuses a range outside the file', () => {
    expect(byteRange('bytes=100-', 100)).toBe('bad')
    expect(byteRange('bytes=5-2', 100)).toBe('bad')
  })
})
