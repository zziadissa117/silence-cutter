import { describe, expect, it } from 'vitest'

import { emptyBank, type BankFile, type BatchBank, type BatchSlot, type CopySource } from './batch'
import { copiesToMake, goCopies, handOver, planVideos, stopCopies } from './batchRun'
import { talksFrom } from './copyTalk'
import type { Job } from './jobs'

const file = (id: string): BankFile => ({ id, name: `${id}.mp4`, type: 'video/mp4', size: 1 })
const songs = (n: number) => Array.from({ length: n }, (_, i) => file(`song${i}`))
const slots = (n: number): BatchSlot[] => Array.from({ length: n }, (_, i) => ({ date: '2026-11-10', time: `${String(i).padStart(2, '0')}:00` }))
const source = (fields: Partial<CopySource> = {}): CopySource => ({ id: 's1', clip: file('viral'), count: 5, talks: false, addedAt: 1, ...fields })
const bank = (fields: Partial<BatchBank> = {}): BatchBank => ({ ...emptyBank('c', 'a'), music: songs(8), copies: [source()], ...fields })
const now = new Date('2026-11-09T12:00:00')

describe('one video, new songs', () => {
  it('makes the copies he asked for, each with a song it has not had, with the batch stopped', () => {
    const plan = planVideos(bank(), slots(10), { now, rand: () => 0.5 })
    expect(plan.videos).toHaveLength(5)
    expect(new Set(plan.videos.map((v) => v.music!.id)).size).toBe(5)
    expect(plan.videos.every((v) => v.reaction.id === 'viral' && v.copy?.sourceId === 's1' && v.headline === '')).toBe(true)
    // On the earliest times, counted in the day.
    expect(plan.slots.map((s) => s.time)).toEqual(['00:00', '01:00', '02:00', '03:00', '04:00'])
    expect(plan.bank.filled?.['2026-11-10']).toBe(5)
    expect(copiesToMake(plan.bank)).toBe(0)
  })

  it('never more than the songs there are, and none once stopped', () => {
    expect(planVideos(bank({ music: songs(3) }), slots(10), { now }).videos).toHaveLength(3)
    expect(planVideos(bank({ copies: stopCopies([source()]) }), slots(10), { now }).videos).toHaveLength(0)
    expect(copiesToMake(bank({ copies: goCopies(stopCopies([source()])) }))).toBe(5)
  })

  it('goes on where it was, on fewer times than copies', () => {
    const first = planVideos(bank(), slots(2), { now })
    expect(first.videos).toHaveLength(2)
    const next = planVideos(first.bank, slots(10), { now })
    expect(next.videos).toHaveLength(3)
    const all = [...first.videos, ...next.videos].map((v) => v.music!.id)
    expect(new Set(all).size).toBe(5)
  })

  it('a copy dropped before it was made gets made again', () => {
    const plan = planVideos(bank(), slots(10), { now })
    const job = { id: 'j1', campaignId: 'c', status: 'queued', batch: plan.videos[0].batch, montage: { bank: { reaction: plan.videos[0].reaction, product: plan.videos[0].product, music: plan.videos[0].music, copy: plan.videos[0].copy }, clips: [], music: 'bank' } } as unknown as Job
    const after = handOver({ bank: plan.bank, campaignId: 'c', jobs: [job], posts: [], removeJob: () => {}, now })
    expect(copiesToMake(after)).toBe(1)
  })

  it('hears talking, not a song', () => {
    expect(talksFrom(['[Music]', '♪', 'la'].map((text) => ({ text })))).toBe(false)
    expect(talksFrom('so guys go to this website right now'.split(' ').map((text) => ({ text })))).toBe(true)
  })
})
