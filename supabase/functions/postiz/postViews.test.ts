import { describe, expect, it } from 'vitest'

import { accountNameFor, postViewCount, postViewsDue } from './postViews.ts'

const HOUR = 3_600_000
const at = Date.parse('2026-10-10T18:00:00Z')

describe("when a video's views are read", () => {
  it('a day, three days and a week after it went out - once each', () => {
    const post = new Date(at).toISOString()
    expect(postViewsDue(post, null, at + 23 * HOUR)).toBe(false)
    expect(postViewsDue(post, null, at + 25 * HOUR)).toBe(true)
    expect(postViewsDue(post, new Date(at + 25 * HOUR).toISOString(), at + 30 * HOUR)).toBe(false)
    expect(postViewsDue(post, new Date(at + 25 * HOUR).toISOString(), at + 73 * HOUR)).toBe(true)
    expect(postViewsDue(post, new Date(at + 73 * HOUR).toISOString(), at + 100 * HOUR)).toBe(false)
    expect(postViewsDue(post, new Date(at + 73 * HOUR).toISOString(), at + 169 * HOUR)).toBe(true)
    expect(postViewsDue(post, new Date(at + 169 * HOUR).toISOString(), at + 190 * HOUR)).toBe(false)
  })
})

describe("reading Postiz's answer for one post", () => {
  it('takes the views metric, a running total by its last day', () => {
    expect(
      postViewCount([
        { label: 'Likes', data: [{ total: 40, date: '2026-10-11' }] },
        { label: 'Views', data: [{ total: '900', date: '2026-10-11' }, { total: '1400', date: '2026-10-12' }] },
      ]),
    ).toBe(1400)
  })

  it('adds a day-by-day series up, and falls back to impressions', () => {
    expect(postViewCount([{ label: 'Views', data: [{ total: 800, date: '2026-10-11' }, { total: 300, date: '2026-10-12' }] }])).toBe(1100)
    expect(postViewCount([{ label: 'Impressions', data: [{ total: 5000, date: '2026-10-12' }] }])).toBe(5000)
  })

  it('reads an object with a views number, and says nothing for nothing', () => {
    expect(postViewCount({ views: 1234, likes: 5 })).toBe(1234)
    expect(postViewCount([])).toBeNull()
    expect(postViewCount({ error: 'no' })).toBeNull()
    expect(postViewCount(null)).toBeNull()
  })

  it("files the views under the account's name", () => {
    const accounts = [
      { id: 'i1', name: 'Karim' },
      { id: 'i2', name: 'lockinwithziad' },
    ]
    expect(accountNameFor(accounts, 'i2')).toBe('lockinwithziad')
    expect(accountNameFor([accounts[0]], 'other')).toBe('Karim')
  })
})
