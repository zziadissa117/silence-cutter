import { describe, expect, it } from 'vitest'

import { emptyBank, fromPhone, rememberUsed, usedKey, type BankFile, type BatchBank } from './batch'
import { handOver } from './batchRun'
import type { Job } from './jobs'
import type { ServerPost } from './posting'
import { bankFiles, settingsKey } from './serverLink'

const file = (id: string, fp = `fp-${id}`): BankFile => ({ id, name: `${id}.mov`, type: 'video/quicktime', size: 10, fp })

function bank(over: Partial<BatchBank> = {}): BatchBank {
  return { ...emptyBank('c1', 'a1'), reactions: [file('r1'), file('r2')], products: [file('p1')], ...over }
}

describe('fromPhone (the server and the phone sharing a batch)', () => {
  it('takes the phone bank whole the first time, and on a new hand-over', () => {
    const phone = bank({ movedAt: 't2', perDay: 10, made: ['x'] })
    expect(fromPhone(null, phone)).toBe(phone)
    expect(fromPhone(bank({ movedAt: 't1', made: ['old'] }), phone)).toBe(phone)
  })

  it("keeps his settings from the phone and what was made from the server", () => {
    const server = bank({ movedAt: 't', perDay: 3, made: ['a', 'b'], filled: { '2026-10-20': 3 }, used: { r1: 2 }, running: true })
    const phone = bank({ movedAt: 't', perDay: 10, made: ['a'], headlines: ['new'], running: true })
    const next = fromPhone(server, phone)
    expect(next.perDay).toBe(10)
    expect(next.headlines).toEqual(['new'])
    expect(next.made).toEqual(['a', 'b'])
    expect(next.filled).toEqual({ '2026-10-20': 3 })
    expect(next.used).toEqual({ r1: 2 })
  })

  it('never brings back a clip the server used up', () => {
    const server = bank({ movedAt: 't', reactions: [], usedClips: ['fp-r1'] })
    const phone = bank({ movedAt: 't', usedClips: ['fp-old'] })
    const next = fromPhone(server, phone)
    expect(next.reactions.map((f) => f.id)).toEqual(['r2'])
    expect(new Set(next.usedClips)).toEqual(new Set(['fp-r1', 'fp-old']))
  })

  it('stops on the phone when the server stopped it, every video made', () => {
    const spent = { videos: 12, through: '2026-10-27' }
    const server = bank({ movedAt: 't', startedAt: 's1', running: false, spent })
    const phone = bank({ movedAt: 't', startedAt: 's1', running: true })
    const next = fromPhone(server, phone)
    expect(next.running).toBe(false)
    expect(next.spent).toEqual(spent)
  })

  it('a Start tapped since puts that behind it', () => {
    const server = bank({ movedAt: 't', startedAt: 's1', running: false, spent: { videos: 12, through: '2026-10-27' }, runProblem: 'x' })
    const phone = bank({ movedAt: 't', startedAt: 's2', running: true })
    const next = fromPhone(server, phone)
    expect(next.running).toBe(true)
    expect(next.spent).toBeUndefined()
    expect(next.runProblem).toBeUndefined()
  })

  it('a Start anyway tapped since forgets the mixes made before, there too', () => {
    const server = bank({ movedAt: 't', startedAt: 's1', running: false, made: ['a', 'b', 'c'] })
    const phone = bank({ movedAt: 't', startedAt: 's2', anyway: 's2', running: true, made: [] })
    expect(fromPhone(server, phone).made).toEqual([])
    // Once the server has that Start, what it makes from then on is its own.
    const after = bank({ movedAt: 't', startedAt: 's2', anyway: 's2', running: true, made: ['d'] })
    expect(fromPhone(after, phone).made).toEqual(['d'])
    // A plain Start keeps what was made.
    expect(fromPhone(server, bank({ movedAt: 't', startedAt: 's3', anyway: 's2', running: true, made: [] })).made).toEqual(['a', 'b', 'c'])
  })

  it('keeps a clip taken in again on purpose, until its own videos use it up', () => {
    const again: BankFile = { ...file('r3', 'fp-r1'), again: 5 }
    const server = bank({ movedAt: 't', reactions: [], usedClips: ['fp-r1'] })
    const phone = bank({ movedAt: 't', reactions: [again] })
    expect(fromPhone(server, phone).reactions).toEqual([again])
    // Its own videos made: remembered both ways, and it doesn't come back.
    const usedUp = rememberUsed(bank({ reactions: [again], used: { r3: 1 } }), [again])
    expect(usedUp.usedClips).toEqual(['fp-r1', usedKey(again)])
    expect(fromPhone(bank({ movedAt: 't', reactions: [], usedClips: usedUp.usedClips }), phone).reactions).toEqual([])
  })

  it('Stop on the phone stops the server', () => {
    const server = bank({ movedAt: 't', running: true })
    expect(fromPhone(server, bank({ movedAt: 't', running: false })).running).toBe(false)
  })
})

describe('handOver', () => {
  const now = new Date(2026, 9, 20, 9, 0)
  const job = (id: string, status: Job['status'], date: string, name = 'r1 + p1.mp4'): Job =>
    ({ id, campaignId: 'c1', status, name, headlineText: 'Hook', batch: { id: 'b', date, time: '12:00', size: 3 } }) as unknown as Job
  const post = (id: string, date: string): ServerPost =>
    ({ id, key: id, campaignId: 'c1', status: 'scheduled', fileName: 'r2 + p1.mp4', headline: 'Hook', batch: { id: 'b', date, time: '10:00', size: 3 } }) as unknown as ServerPost

  it('drops the queued videos, frees their mixes and counts the days from what is there', () => {
    const removed: string[] = []
    const made = ['r1|p1|h:hook|', 'r2|p1|h:hook|']
    const next = handOver({
      bank: bank({ made, madeThrough: '2026-10-26', lastPerDay: 3, filled: { '2026-10-20': 3 } }),
      campaignId: 'c1',
      jobs: [job('j1', 'queued', '2026-10-20'), job('j2', 'working', '2026-10-21', 'r2 + p1.mp4')],
      posts: [post('p', '2026-10-20')],
      removeJob: (id) => removed.push(id),
      now,
    })
    expect(removed).toEqual(['j1'])
    expect(next.filled?.['2026-10-20']).toBe(1)
    expect(next.filled?.['2026-10-21']).toBe(1)
    expect(next.filled?.['2026-10-22']).toBe(0)
    expect(next.madeThrough).toBeUndefined()
    // r1's mix was only in the dropped job; r2's is still out there.
    expect(next.made).toEqual(['r2|p1|h:hook|'])
  })
})

describe('what goes to the server', () => {
  it("lists every file once, the steps' and the logos' too", () => {
    const b = bank({
      music: [file('m1')],
      steps: [{ id: 's', name: 'Step 1', files: [file('s1'), file('r1')] }],
      formula: { left: file('l'), right: null, min: 1, max: 2 },
    })
    expect(bankFiles(b).map((f) => f.id).sort()).toEqual(['l', 'm1', 'p1', 'r1', 'r2', 's1'])
  })

  it('sends again when a setting changes, not when only the progress does', () => {
    const b = bank()
    expect(settingsKey({ ...b, made: ['x'], filled: { d: 1 } })).toBe(settingsKey(b))
    expect(settingsKey({ ...b, perDay: 9 })).not.toBe(settingsKey(b))
  })
})
