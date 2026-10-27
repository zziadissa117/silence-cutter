import { describe, expect, it } from 'vitest'

import { emptyBank, addDays, todayHere } from './batch'
import { QUIET_MS, batchState, lastReadyAt, statusDays, type StatusDay } from './batchNow'
import { AHEAD_DAYS } from './batchRun'
import type { Job } from './jobs'
import type { ServerPost } from './posting'

const now = new Date(2026, 9, 25, 9, 0)
const today = todayHere(now)
const day = (d: number) => addDays(today, d)
const post = (id: string, d: number, status: ServerPost['status'], createdAt = '2026-10-25T12:00:00.000Z'): ServerPost =>
  ({ id, key: `k-${id}`, campaignId: 'c1', status, createdAt, batch: { id: 'b', date: day(d), time: '12:00', size: 3 } }) as unknown as ServerPost
const bank = { ...emptyBank('c1', 'a1'), perDay: 3, running: true }

describe('the next days', () => {
  it('counts what is in Posts, what went out, and what is still being made', () => {
    const posts = [post('a', 0, 'posted'), post('b', 0, 'scheduled'), post('c', 1, 'waiting'), post('x', 1, 'rejected'), post('y', 1, 'failed')]
    const days = statusDays({ ...bank, filled: { [day(0)]: 3, [day(1)]: 2 } }, posts, { now })
    expect(days).toHaveLength(AHEAD_DAYS)
    expect(days[0]).toMatchObject({ date: today, target: 3, ready: 2, out: 1, planned: 3 })
    expect(days[1]).toMatchObject({ ready: 1, out: 0, planned: 2 })
    expect(days[2]).toMatchObject({ ready: 0, planned: 0 })
  })

  it("on this phone, a failed video isn't being made, whatever the day's count says", () => {
    const job = (id: string, status: Job['status'], d: number) => ({ id, campaignId: 'c1', status, batch: { id: 'b', date: day(d), time: '15:00', size: 3 } }) as unknown as Job
    const days = statusDays({ ...bank, filled: { [day(0)]: 3 } }, [post('a', 0, 'scheduled')], { jobs: [job('j1', 'queued', 0), job('j2', 'failed', 0), job('k-a', 'done', 0)], now })
    // j1 still to come; j2 failed; k-a is the post already.
    expect(days[0]).toMatchObject({ ready: 1, planned: 2 })
  })

  it('knows when the last video reached Posts', () => {
    expect(lastReadyAt([post('a', 0, 'posted', '2026-10-25T10:00:00Z'), post('b', 1, 'scheduled', '2026-10-25T11:00:00Z'), post('c', 1, 'failed', '2026-10-25T12:00:00Z')], 'c1')).toBe(
      '2026-10-25T11:00:00Z',
    )
    expect(lastReadyAt([], 'c1')).toBeNull()
  })
})

describe('what the card leads with', () => {
  const full: StatusDay[] = [0, 1, 2].map((d) => ({ date: day(d), target: 3, ready: 3, out: 0, planned: 3 }))
  const short: StatusDay[] = [{ date: day(0), target: 3, ready: 1, out: 0, planned: 1 }]
  const base = { running: true, perDay: 3, where: 'server' as const, problem: null, making: false, heardAt: new Date(now.getTime() - 20_000).toISOString(), days: full, now: now.getTime() }

  it('making, up to date, about to make more, paused, stopped', () => {
    expect(batchState({ ...base, making: true })).toMatchObject({ tone: 'ok', title: 'Making videos' })
    expect(batchState(base)).toMatchObject({ tone: 'ok', title: 'Up to date' })
    expect(batchState({ ...base, days: short }).title).toBe('About to make more')
    expect(batchState({ ...base, days: short }).line).toContain('2 still to make')
    expect(batchState({ ...base, perDay: 0 }).title).toBe('Paused')
    const stopped = batchState({ ...base, running: false })
    expect(stopped.title).toBe('Not making new videos')
    // Stopping the making never stops what is made.
    expect(stopped.line).toContain('The 9 already made still go out at their times')
  })

  it('says what is wrong first: a problem, a server gone quiet, videos that failed', () => {
    expect(batchState({ ...base, making: true, problem: "Couldn't reach the server." })).toMatchObject({ tone: 'bad', line: "Couldn't reach the server." })
    const quiet = batchState({ ...base, making: true, heardAt: new Date(now.getTime() - QUIET_MS - 60_000).toISOString() })
    expect(quiet).toMatchObject({ tone: 'bad', title: 'The server went quiet' })
    expect(quiet.line).toContain('11 min')
    // Still making the others: that leads; the failed ones are a line of the card.
    expect(batchState({ ...base, making: true, failed: 2 }).title).toBe('Making videos')
    expect(batchState({ ...base, failed: 2 })).toMatchObject({ tone: 'bad', title: "2 couldn't be made" })
    // The phone busy sending clips hasn't asked for 15 minutes: the server
    // had checked in 20 s before that last question, so it isn't quiet.
    const askedLong = new Date(now.getTime() - 15 * 60_000)
    expect(batchState({ ...base, making: true, askedAt: askedLong.toISOString(), heardAt: new Date(askedLong.getTime() - 20_000).toISOString() }).title).toBe('Making videos')
    // A phone isn't a server: no word from one is nothing.
    expect(batchState({ ...base, where: 'phone', heardAt: null }).title).toBe('Up to date')
  })
})
