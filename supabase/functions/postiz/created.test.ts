import { describe, expect, it } from 'vitest'

import { CREATED_WITHIN_MS, createdAround, isCreatedAround, sentDate } from './created'

const MINUTE = 60_000
/** The run that was stopped marked the post as going in at this moment... */
const creatingAt = '2026-11-10T10:00:00.000Z'
/** ...and the next run looks for it this much later - once the claim on the
 *  post has gone stale, longer than the match allows. */
const retryAt = new Date(Date.parse(creatingAt) + 12 * MINUTE).toISOString()

describe('createdAround', () => {
  it('looks for a post sent now where the stopped run put it, not where this run is', () => {
    const at = createdAround({ type: 'now', date: retryAt }, creatingAt)
    expect(at).toBe(Date.parse(creatingAt))
    // Postiz dated it a few seconds after the mark; around "now" it was out of reach.
    const inPostiz = new Date(Date.parse(creatingAt) + 20_000).toISOString()
    expect(isCreatedAround(inPostiz, at)).toBe(true)
    expect(isCreatedAround(inPostiz, Date.parse(retryAt))).toBe(false)
  })

  it('looks for a scheduled post at its time, whatever the mark says', () => {
    const date = '2026-11-10T18:00:00.000Z'
    expect(createdAround({ type: 'schedule', date }, creatingAt)).toBe(Date.parse(date))
    expect(createdAround({ type: 'schedule', date }, null)).toBe(Date.parse(date))
  })

  it('falls back to the date when the mark is missing or unreadable', () => {
    expect(createdAround({ type: 'now', date: retryAt }, null)).toBe(Date.parse(retryAt))
    expect(createdAround({ type: 'now', date: retryAt }, 'not a date')).toBe(Date.parse(retryAt))
  })
})

describe('sentDate', () => {
  it('dates a post sent now at the mark and a scheduled one at its time', () => {
    expect(sentDate({ type: 'now', date: retryAt }, creatingAt)).toBe(creatingAt)
    expect(sentDate({ type: 'schedule', date: '2026-11-10T18:00:00.000Z' }, creatingAt)).toBe('2026-11-10T18:00:00.000Z')
  })
})

describe('isCreatedAround', () => {
  it('matches within the allowance only, and never a post without a date', () => {
    const at = Date.parse(creatingAt)
    expect(isCreatedAround(new Date(at + CREATED_WITHIN_MS - 1000).toISOString(), at)).toBe(true)
    expect(isCreatedAround(new Date(at - CREATED_WITHIN_MS - 1000).toISOString(), at)).toBe(false)
    expect(isCreatedAround(undefined, at)).toBe(false)
    expect(isCreatedAround('garbage', at)).toBe(false)
  })
})
