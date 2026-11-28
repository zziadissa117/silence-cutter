import { describe, expect, it } from 'vitest'

import { batchCapFor, batchLeftNote, batchRoom, cleanLimits, firstDayWithRoom, heldNote, releasable, ruleFor, split, usedOn, type PostAccount } from './limits'

const tt: PostAccount = { id: 'tt', name: 'TikTok main', platform: 'tiktok' }
const tt2: PostAccount = { id: 'tt2', name: 'TikTok second', platform: 'tiktok' }
const ig: PostAccount = { id: 'ig', name: 'Instagram', platform: 'instagram' }

describe('ruleFor', () => {
  it('has no limit by default', () => {
    expect(ruleFor(undefined, tt)).toEqual({ paused: false, cap: null })
  })
  it('pauses an account when its platform or the account is paused', () => {
    expect(ruleFor({ platforms: { tiktok: { paused: true } } }, tt).paused).toBe(true)
    expect(ruleFor({ accounts: { tt: { paused: true } } }, tt).paused).toBe(true)
    expect(ruleFor({ accounts: { tt: { paused: true } } }, tt2).paused).toBe(false)
  })
  it('takes the smaller cap, and treats 0 as paused', () => {
    expect(ruleFor({ platforms: { tiktok: { perDay: 3 } }, accounts: { tt: { perDay: 1 } } }, tt).cap).toBe(1)
    expect(ruleFor({ platforms: { tiktok: { perDay: 0 } } }, tt).paused).toBe(true)
  })
})

describe('split', () => {
  it('lets pausing one platform leave the others alone', () => {
    const { send, held } = split([tt, ig], { platforms: { tiktok: { paused: true } } }, {})
    expect(send.map((a) => a.id)).toEqual(['ig'])
    expect(held).toEqual([{ ...tt, held: 'paused' }])
  })
  it('holds an account that has reached its day, and only that one', () => {
    const { send, held } = split([tt, tt2, ig], { platforms: { tiktok: { perDay: 2 } } }, { tt: 2, tt2: 1, ig: 9 })
    expect(send.map((a) => a.id)).toEqual(['tt2', 'ig'])
    expect(held.map((a) => [a.id, a.held])).toEqual([['tt', 'cap']])
  })
  it('does not carry an old held mark into the new decision', () => {
    const { send } = split([{ ...tt, held: 'paused' }], undefined, {})
    expect(send).toEqual([tt])
  })
})

describe('usedOn', () => {
  const dateOf = (iso: string) => iso.slice(0, 10)
  it('counts scheduled and posted videos per account on the day, not held ones', () => {
    const posts = [
      { post_at: '2026-10-05T10:00:00Z', status: 'scheduled', accounts: [tt, ig] },
      { post_at: '2026-10-05T18:00:00Z', status: 'posted', accounts: [tt, { ...ig, held: 'cap' as const }] },
      { post_at: '2026-10-06T10:00:00Z', status: 'scheduled', accounts: [tt] },
      { post_at: '2026-10-05T12:00:00Z', status: 'waiting', accounts: [tt] },
    ]
    expect(usedOn(posts, '2026-10-05', dateOf)).toEqual({ tt: 2, ig: 1 })
  })
})

describe('releasing', () => {
  it('releases held accounts that are no longer paused', () => {
    const accounts: PostAccount[] = [{ ...tt, held: 'paused' }, { ...ig, held: 'paused' }, tt2]
    expect(releasable(accounts, { platforms: { instagram: { paused: true } } }).map((a) => a.id)).toEqual(['tt'])
  })
  it('finds the first day with room, skipping full days', () => {
    const add = (d: string, n: number) => `2026-10-${String(Number(d.slice(8)) + n).padStart(2, '0')}`
    const used = (date: string) => (date === '2026-10-05' || date === '2026-10-06' ? 1 : 0)
    expect(firstDayWithRoom(tt, { accounts: { tt: { perDay: 1 } } }, '2026-10-05', add, used)).toBe('2026-10-07')
    expect(firstDayWithRoom(tt, { accounts: { tt: { paused: true } } }, '2026-10-05', add, used)).toBeNull()
    expect(firstDayWithRoom(tt, undefined, '2026-10-05', add, used)).toBe('2026-10-05')
  })
})

describe('heldNote', () => {
  it('says why and that it resumes by itself', () => {
    expect(heldNote([{ ...tt, held: 'paused' }])).toBe('Held back: TikTok main is paused. It goes out by itself once it is free.')
    expect(heldNote([])).toBeNull()
  })
})

describe('cleanLimits', () => {
  it('keeps only whole numbers and true pauses, and drops empties', () => {
    expect(
      cleanLimits({ platforms: { tiktok: { paused: true, perDay: 2.5 }, ig: { perDay: 3 }, x: {} }, accounts: { a: { paused: false } }, junk: 1 }),
    ).toEqual({ platforms: { tiktok: { paused: true }, ig: { perDay: 3 } } })
  })
  it('survives nonsense', () => {
    expect(cleanLimits(null)).toEqual({})
    expect(cleanLimits('x')).toEqual({})
    expect(cleanLimits({ platforms: { a: { perDay: 99 } } })).toEqual({})
  })
})

describe('batch videos a day per account', () => {
  const yt = { id: 'y1', name: 'Jake', platform: 'youtube', profile: 'jake' }
  const tt = { id: 't1', name: 'Jake', platform: 'tiktok', profile: 'jaketok' }
  it('leaves out an account on its own videos only, keeps the rest', () => {
    const limits = cleanLimits({ accounts: { y1: { batch: 0 } } })
    expect(batchRoom([yt, tt], limits, {})).toEqual({ keep: [tt], left: [yt] })
    expect(batchLeftNote([yt], limits)).toBe('Not sent to every account: @jake takes only your own new videos.')
  })
  it('lets an account have its batch videos up to the day\'s number, then leaves it out', () => {
    const limits = cleanLimits({ platforms: { youtube: { batch: 2 } } })
    expect(batchRoom([yt], limits, { y1: 1 }).keep).toEqual([yt])
    expect(batchRoom([yt], limits, { y1: 2 }).left).toEqual([yt])
    expect(batchCapFor(cleanLimits({ platforms: { youtube: { batch: 2 } }, accounts: { y1: { batch: 1 } } }), yt)).toBe(1)
  })
  it('keeps a batch-only limit when cleaning, and no limit means no change', () => {
    expect(cleanLimits({ accounts: { y1: { batch: 0 } } })).toEqual({ accounts: { y1: { batch: 0 } } })
    expect(cleanLimits({ accounts: { y1: { batch: 99 } } })).toEqual({})
    expect(batchRoom([yt, tt], {}, { y1: 9 }).left).toEqual([])
  })
})
