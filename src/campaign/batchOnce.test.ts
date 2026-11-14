// Each clip in one video only (his ask, 2026-11-14: "they don't want me to
// repurpose my reaction videos ... If I have 2 videos, there are only going
// to be 2 different variations of videos that are going to be able to be
// made"): per format for its reactions and its products, per product step.

import { describe, expect, it } from 'vitest'

import { combos, formatBank, pickBatch, unmake, type BankFile, type BatchBank, type BatchStep } from './batch'
import { leftToMake, planVideos } from './batchRun'

const files = (prefix: string, n: number, extra: Partial<BankFile> = {}): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}.mov`, type: 'video/quicktime', size: 1, ...extra }))

function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

const mix = (over: Partial<BatchBank> = {}): BatchBank =>
  ({
    campaignId: 'c',
    angleId: 'a',
    layout: 'after',
    reactions: files('r', 3),
    products: files('p', 2),
    headlines: ['One', 'Two'],
    music: [],
    used: {},
    made: [],
    perDay: 3,
    days: 1,
    ...over,
  }) as unknown as BatchBank

describe('each clip in one video only', () => {
  it('reactions once: as many different videos as there are reactions, each in one', () => {
    const bank = mix({ reactionsOnce: true })
    expect(combos(bank)).toEqual({ total: 3, left: 3 })
    const out = pickBatch(bank, 10, seeded(1))
    expect(out.picks).toHaveLength(3)
    expect(new Set(out.picks.map((p) => p.reaction)).size).toBe(3)
    // Products and headlines still go round.
    expect(combos({ ...bank, made: out.made }).left).toBe(0)
    // Without it, every combination as always.
    expect(combos(mix())).toEqual({ total: 12, left: 12 })
  })

  it('reactions and products once: the shorter of the two', () => {
    const bank = mix({ reactionsOnce: true, productsOnce: true })
    expect(combos(bank).total).toBe(2)
    const { picks } = pickBatch(bank, 5, seeded(3))
    expect(picks).toHaveLength(2)
    expect(new Set(picks.map((p) => p.product)).size).toBe(2)
    expect(new Set(picks.map((p) => p.reaction)).size).toBe(2)
  })

  it('a product step once: each of its clips in one video, the other steps as always', () => {
    const steps: BatchStep[] = [
      { id: 's1', name: 'Open it', files: files('a', 2), once: true },
      { id: 's2', name: 'Tap create', files: files('b', 3) },
    ]
    const bank = mix({ reactions: files('r', 4), products: [], steps })
    expect(combos(bank).total).toBe(2)
    const { picks, made } = pickBatch(bank, 6, seeded(5))
    expect(picks).toHaveLength(2)
    expect(new Set(picks.map((p) => p.steps![0])).size).toBe(2)
    expect(combos({ ...bank, made }).left).toBe(0)
  })

  it('a video taken out again (Start over) gives its clips back', () => {
    const bank = mix({ reactionsOnce: true })
    const first = pickBatch(bank, 3, seeded(1))
    expect(combos({ ...bank, made: first.made }).left).toBe(0)
    const one = first.made[0]
    const freed = unmake(first.made, [one.split('|').slice(0, 3).join('|') + '|'], [])
    expect(combos({ ...bank, made: freed }).left).toBe(1)
  })

  it("a format's pick reaches its own bank, and the batch stops once they are used up", () => {
    const bank = {
      ...mix({ reactions: files('r', 2, { formats: ['f'] }), products: files('p', 3, { formats: ['f'] }) }),
      formats: [{ id: 'f', kind: 'reaction', name: 'Shocked', reactionsOnce: true }],
      running: true,
    } as unknown as BatchBank
    expect(formatBank(bank, bank.formats![0]).reactionsOnce).toBe(true)
    expect(leftToMake(bank)).toEqual({ total: 2, left: 2 })
    const slots = Array.from({ length: 5 }, (_, i) => ({ date: '2026-11-15', time: `${String(10 + i)}:00` }))
    const plan = planVideos(bank, slots, { id: 'x', now: new Date('2026-11-15T08:00:00'), rand: seeded(2) })
    expect(plan.videos).toHaveLength(2)
    expect(new Set(plan.videos.map((v) => v.reaction.id)).size).toBe(2)
    expect(plan.bank.running).toBe(false)
  })
})
