import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addApproved,
  advanceDay,
  allTimeBoard,
  approve,
  claimMessage,
  dayBoard,
  getPayout,
  hasHistory,
  initState,
  markPending,
  reject,
  totalFor,
  type Db,
} from './db.ts'
import { memoryDb } from './testDb.ts'

const NY = 'America/New_York'
const G = 'guild'

let db: Db
let pg: PGlite
beforeEach(async () => {
  ;({ db, pg } = await memoryDb())
})

async function pendingPayout(userId: string, messageId: string, readCents = 50_000): Promise<number> {
  const id = (await claimMessage(db, { guildId: G, userId, messageId, channelId: 'c' }))!
  await markPending(db, id, {
    readCents,
    readCurrency: 'USD',
    readNote: 'note',
    cardChannelId: 'cards',
    cardMessageId: `card-${messageId}`,
  })
  return id
}

/** Approves a payout as though a mod pressed the button at `at`. */
async function approvedAt(userId: string, cents: number, at: string): Promise<void> {
  const id = await pendingPayout(userId, `m-${userId}-${at}`, cents)
  await approve(db, id, cents, 'mod')
  await pg.query(`update payouts set decided_at = $2 where id = $1`, [id, at])
}

describe('handling each screenshot once', () => {
  it('lets only the first claim through', async () => {
    const m = { guildId: G, userId: 's', messageId: 'm1', channelId: 'c' }
    const id = await claimMessage(db, m)
    expect(id).toBeTypeOf('number')
    expect(await claimMessage(db, m)).toBeNull()
  })

  it('picks a screenshot up again if the bot stopped half way through reading it', async () => {
    const m = { guildId: G, userId: 's', messageId: 'm1', channelId: 'c' }
    const id = await claimMessage(db, m)
    await pg.query(`update payouts set claimed_at = now() - interval '5 minutes' where id = $1`, [id])
    expect(await claimMessage(db, m)).toBe(id)
  })

  it('never picks up one that already has a card', async () => {
    await pendingPayout('s', 'm1')
    await pg.query(`update payouts set claimed_at = now() - interval '1 hour'`)
    expect(await claimMessage(db, { guildId: G, userId: 's', messageId: 'm1', channelId: 'c' })).toBeNull()
  })
})

describe('approving', () => {
  it('counts a payout once even if two mods press at the same time', async () => {
    const id = await pendingPayout('s', 'm1')
    const [a, b] = await Promise.all([approve(db, id, 50_000, 'mod1'), approve(db, id, 50_000, 'mod2')])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(await totalFor(db, G, 's')).toBe(50_000)
  })

  it('cannot reject what is already approved', async () => {
    const id = await pendingPayout('s', 'm1')
    await approve(db, id, 50_000, 'mod')
    expect(await reject(db, id, 'mod')).toBeNull()
    expect((await getPayout(db, id))?.status).toBe('approved')
  })

  it('stacks approved payouts into the total and ignores the rest', async () => {
    const a = await pendingPayout('s', 'm1', 30_000)
    const b = await pendingPayout('s', 'm2', 50_000)
    const c = await pendingPayout('s', 'm3', 99_999_00)
    await approve(db, a, 30_000, 'mod')
    await approve(db, b, 50_000, 'mod')
    await reject(db, c, 'mod')
    await pendingPayout('s', 'm4') // still waiting
    expect(await totalFor(db, G, 's')).toBe(80_000)
  })

  it('counts the amount the mod approved, not the one the bot read', async () => {
    const id = await pendingPayout('s', 'm1', 50_000)
    const approved = await approve(db, id, 45_000, 'mod')
    expect(approved?.amountCents).toBe(45_000)
    expect(approved?.readCents).toBe(50_000)
    expect(await totalFor(db, G, 's')).toBe(45_000)
  })

  it('keeps servers apart', async () => {
    await addApproved(db, { guildId: 'other', userId: 's', cents: 100, kind: 'payout', by: 'mod' })
    expect(await totalFor(db, G, 's')).toBe(0)
    expect(await hasHistory(db, G, 's')).toBe(false)
  })
})

describe('leaderboards', () => {
  it("puts a payout on the New York day it was approved", async () => {
    await approvedAt('late', 10_000, '2026-11-18T04:30:00Z') // 11:30pm Nov 17 in New York
    await approvedAt('early', 20_000, '2026-11-18T05:30:00Z') // 12:30am Nov 18 in New York
    expect(await dayBoard(db, G, '2026-11-17', NY, 10)).toEqual([{ userId: 'late', cents: 10_000 }])
    expect(await dayBoard(db, G, '2026-11-18', NY, 10)).toEqual([{ userId: 'early', cents: 20_000 }])
  })

  it('gets the day right on the day the clocks change', async () => {
    // Clocks go forward on 2026-03-08, so that day ends at 04:00Z, not 05:00Z.
    await approvedAt('a', 10_000, '2026-03-09T03:30:00Z') // 11:30pm Mar 8 EDT
    await approvedAt('b', 20_000, '2026-03-09T04:30:00Z') // 12:30am Mar 9 EDT
    expect(await dayBoard(db, G, '2026-03-08', NY, 10)).toEqual([{ userId: 'a', cents: 10_000 }])
  })

  it('ranks by what was made that day, adding up several payouts', async () => {
    await approvedAt('a', 30_000, '2026-11-17T15:00:00Z')
    await approvedAt('a', 30_000, '2026-11-17T16:00:00Z')
    await approvedAt('b', 50_000, '2026-11-17T17:00:00Z')
    await approvedAt('c', 900_000, '2026-11-16T17:00:00Z') // the day before
    expect(await dayBoard(db, G, '2026-11-17', NY, 10)).toEqual([
      { userId: 'a', cents: 60_000 },
      { userId: 'b', cents: 50_000 },
    ])
  })

  it('ranks all-time totals, including corrections, and leaves out zero totals', async () => {
    await approvedAt('a', 30_000, '2026-11-17T15:00:00Z')
    await approvedAt('b', 50_000, '2026-11-16T15:00:00Z')
    await approvedAt('c', 10_000, '2026-11-15T15:00:00Z')
    await addApproved(db, { guildId: G, userId: 'a', cents: 100_000, kind: 'adjustment', by: 'mod' })
    await addApproved(db, { guildId: G, userId: 'c', cents: -10_000, kind: 'adjustment', by: 'mod' })
    expect(await allTimeBoard(db, G, 10)).toEqual([
      { userId: 'a', cents: 130_000 },
      { userId: 'b', cents: 50_000 },
    ])
  })

  it('leaves corrections off the day board', async () => {
    await addApproved(db, { guildId: G, userId: 'a', cents: 100_000, kind: 'adjustment', by: 'mod' })
    await addApproved(db, { guildId: G, userId: 'b', cents: 20_000, kind: 'payout', by: 'mod' })
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(new Date())
    expect(await dayBoard(db, G, today, NY, 10)).toEqual([{ userId: 'b', cents: 20_000 }])
  })

  it('stops at the limit', async () => {
    for (let i = 0; i < 15; i++) await approvedAt(`s${i}`, (i + 1) * 1000, '2026-11-17T15:00:00Z')
    const top = await allTimeBoard(db, G, 10)
    expect(top).toHaveLength(10)
    expect(top[0]).toEqual({ userId: 's14', cents: 15_000 })
  })
})

describe('posting once a day', () => {
  it('starts from the first value and only moves forward', async () => {
    expect(await initState(db, 'last', '2026-11-16')).toBe('2026-11-16')
    expect(await initState(db, 'last', '2026-11-20')).toBe('2026-11-16')
    expect(await advanceDay(db, 'last', '2026-11-17')).toBe(true)
    expect(await advanceDay(db, 'last', '2026-11-17')).toBe(false)
    expect(await advanceDay(db, 'last', '2026-11-15')).toBe(false)
  })
})
