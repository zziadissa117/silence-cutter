import { describe, expect, it } from 'vitest'

import { safarisOwn } from './report'

describe("Safari's own errors", () => {
  it('are told apart from the app', () => {
    expect(safarisOwn("ReferenceError: Can't find variable: EmptyRanges", undefined)).toBe(true)
    expect(safarisOwn('Script error.', '')).toBe(true)
    // Safari 26 names the file "undefined".
    expect(safarisOwn("ReferenceError: Can't find variable: EmptyRanges", 'undefined')).toBe(true)
    expect(safarisOwn("ReferenceError: Can't find variable: EmptyRanges", 'https://silence-cutter.netlify.app/assets/campaign.js')).toBe(false)
    expect(safarisOwn("TypeError: undefined is not an object", undefined)).toBe(false)
  })
})
