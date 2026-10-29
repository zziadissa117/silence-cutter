import { describe, expect, it } from 'vitest'

import { accountName, baseNote, failedRefs, missingAccounts, namesIn, notPostedNote, reconnectedAs, youtubeDayStarts } from './failed'

const accounts = [
  { id: 'yt', name: 'Ilyan Hamdane', platform: 'youtube' },
  { id: 'ig', name: 'Ilyan Hamdane', platform: 'instagram-standalone' },
  { id: 'tt', name: 'glpjake', platform: 'tiktok-business' },
]

describe('accountName', () => {
  it('adds the platform only when two accounts on the post share a name', () => {
    expect(accountName('Ilyan Hamdane', 'youtube', accounts)).toBe('Ilyan Hamdane (YouTube)')
    expect(accountName('Ilyan Hamdane', 'instagram-standalone', accounts)).toBe('Ilyan Hamdane (Instagram)')
    expect(accountName('glpjake', 'tiktok-business', accounts)).toBe('glpjake')
  })
})

describe('failedRefs', () => {
  it('keeps only the Postiz posts in error', () => {
    const ids = [
      { postId: 'a', integration: 'yt' },
      { postId: 'b', integration: 'ig' },
      { postId: 'c', integration: 'tt' },
    ]
    const found = [
      { id: 'a', state: 'PUBLISHED' },
      { id: 'b', state: 'ERROR' },
    ]
    expect(failedRefs(ids, found)).toEqual([{ postId: 'b', integration: 'ig' }])
  })
})

describe('notPostedNote', () => {
  it('names the failed account with its platform when its name is shared', () => {
    expect(notPostedNote([{ id: 'b', state: 'ERROR', integration: { id: 'ig', name: 'Ilyan Hamdane' } }], accounts)).toBe(
      'Not posted to Ilyan Hamdane (Instagram).',
    )
  })
  it('falls back to the name Postiz gives', () => {
    expect(notPostedNote([{ id: 'x', state: 'ERROR', integration: { id: 'gone', name: 'Jake' } }], accounts)).toBe('Not posted to Jake.')
  })
})

describe('missingAccounts', () => {
  const accounts = [
    { id: 'yt', name: 'Vazaziad', platform: 'youtube' },
    { id: 'ig', name: 'ziad', platform: 'instagram-standalone' },
  ]
  const ids = [
    { postId: 'p-yt', integration: 'yt' },
    { postId: 'p-ig', integration: 'ig' },
  ]

  it('is the ones Postiz says failed', () => {
    const found = [
      { id: 'p-yt', state: 'ERROR' },
      { id: 'p-ig', state: 'PUBLISHED' },
    ]
    expect(missingAccounts(accounts, ids, found, 'Not posted to Vazaziad.').map((a) => a.id)).toEqual(['yt'])
  })

  it('is one named in the note whose Postiz post went with its disconnected account', () => {
    const found = [{ id: 'p-ig', state: 'PUBLISHED' }]
    expect(missingAccounts(accounts, ids, found, 'Not posted to Vazaziad.').map((a) => a.id)).toEqual(['yt'])
  })

  it('never one that went out and was only deleted in Postiz', () => {
    expect(missingAccounts(accounts, ids, [{ id: 'p-yt', state: 'ERROR' }], 'Not posted to Vazaziad.').map((a) => a.id)).toEqual(['yt'])
  })
})

describe('reconnectedAs', () => {
  const was = { id: 'old', name: 'Vazaziad', platform: 'youtube', profile: 'vazaziad' }
  const connected = (id: string, extra: Partial<{ name: string; platform: string; profile: string; disabled: boolean }> = {}) => ({
    id,
    name: 'Vazaziad',
    platform: 'youtube',
    profile: 'vazaziad',
    disabled: false,
    ...extra,
  })

  it('is the same account while it is still connected', () => {
    expect(reconnectedAs(was, [connected('old'), connected('new')])?.id).toBe('old')
  })

  it('is the new id Postiz gave it when reconnected: same platform and username', () => {
    expect(reconnectedAs(was, [connected('new'), connected('ig', { platform: 'instagram-standalone' })])?.id).toBe('new')
    expect(reconnectedAs(was, [connected('old', { disabled: true }), connected('new')])?.id).toBe('new')
  })

  it('goes by name when the username was never kept', () => {
    expect(reconnectedAs({ ...was, profile: undefined }, [connected('new', { profile: 'other' })])?.id).toBe('new')
  })

  it('is none when it is not connected, or two could be it', () => {
    expect(reconnectedAs(was, [connected('ig', { platform: 'instagram-standalone' })])).toBeNull()
    expect(reconnectedAs({ ...was, profile: undefined }, [connected('a'), connected('b')])).toBeNull()
  })
})

describe('namesIn', () => {
  it('reads every way a note names its accounts', () => {
    expect([...namesIn('Not posted to Vazaziad.')]).toEqual(['Vazaziad'])
    expect([...namesIn('Not posted to Jake’s (YouTube), Mikey.')]).toEqual(['Jake’s (YouTube)', 'Mikey'])
    expect([...namesIn("Postiz couldn't publish it to steve.ugcx. Open Postiz to see why.")]).toEqual(['steve.ugcx'])
    expect([...namesIn("Buffer couldn't post it to Jake. Open Buffer to see why.")]).toEqual(['Jake'])
    expect([...namesIn("Not posted to Jake (Buffer couldn't).")]).toEqual(['Jake'])
    expect([...namesIn('Something else.')]).toEqual([])
  })
})

describe('youtubeDayStarts', () => {
  it('is ten past midnight in California, the next one', () => {
    // 8 PM Pacific on Oct 28 (03:00 UTC Oct 29): 00:10 Pacific Oct 29 = 07:10 UTC.
    expect(new Date(youtubeDayStarts(Date.parse('2026-10-29T03:00:00Z'))).toISOString()).toBe('2026-10-29T07:10:00.000Z')
    // Just after it: the one a day later.
    expect(new Date(youtubeDayStarts(Date.parse('2026-10-29T07:15:00Z'))).toISOString()).toBe('2026-10-30T07:10:00.000Z')
    // Winter time (from Nov 1): 08:10 UTC.
    expect(new Date(youtubeDayStarts(Date.parse('2026-11-05T03:00:00Z'))).toISOString()).toBe('2026-11-05T08:10:00.000Z')
  })
})

describe('baseNote', () => {
  it('keeps the accounts a note names, without what was added about posting again', () => {
    expect(baseNote("Not posted to Vazaziad. Posting again at 3:10 AM, when YouTube's daily limit starts over.")).toBe('Not posted to Vazaziad.')
    expect(baseNote('Not posted to Vazaziad. Posting again as soon as Postiz has room.')).toBe('Not posted to Vazaziad.')
    expect(baseNote("Postiz couldn't publish it to X. Open Postiz to see why. Still not posted: X needs reconnecting.")).toBe("Postiz couldn't publish it to X. Open Postiz to see why.")
    expect(baseNote('Not posted to Vazaziad.')).toBe('Not posted to Vazaziad.')
    expect([...namesIn("Not posted to Vazaziad. Posting again at 3:10 AM, when YouTube's daily limit starts over.")]).toEqual(['Vazaziad'])
  })
})
