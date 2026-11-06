import { describe, expect, it } from 'vitest'

import { emptyBank, kindsFor, reactionsOfKind, talksIn, talkShareOf, type BankFile, type BatchBank, type BatchSlot } from './batch'
import { planVideos } from './batchRun'

const files = (prefix: string, n: number, extra: Partial<BankFile> = {}): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}.mp4`, type: 'video/mp4', size: 1, ...extra }))

const slots = (n: number): BatchSlot[] => Array.from({ length: n }, (_, i) => ({ date: '2026-11-07', time: `${String(i % 24).padStart(2, '0')}:00` }))

const mixed = (fields: Partial<BatchBank> = {}): BatchBank => ({
  ...emptyBank('c1', 'a1'),
  reactions: [...files('q', 3, { talks: false }), ...files('t', 2, { talks: true })],
  products: files('p', 4),
  headlines: ['one', 'two', 'three'],
  music: files('m', 2),
  ...fields,
})

describe('talking and not-talking reactions in one batch', () => {
  it('an untagged reaction follows the old one-for-all sound setting', () => {
    const f = files('r', 1)[0]
    expect(talksIn({ voice: true }, f)).toBe(true)
    expect(talksIn({}, f)).toBe(false)
    expect(talksIn({ voice: true }, { ...f, talks: false })).toBe(false)
  })

  it('defaults to 35 talking in every 100', () => {
    expect(talkShareOf({})).toBe(35)
    expect(talkShareOf({ talkShare: 120 })).toBe(100)
  })

  it('takes turns at the share', () => {
    const order = kindsFor(20, 35, undefined, { talk: 99, quiet: 99 })
    expect(order.filter((k) => k === 'talk')).toHaveLength(7)
    // Never three talking in a row, never long runs of the same.
    expect(order.join(',')).not.toContain('talk,talk')
    expect(order[0]).toBe('quiet')
  })

  it('keeps the share from one top-up to the next', () => {
    const first = kindsFor(3, 50, undefined, { talk: 99, quiet: 99 })
    const done = { talk: first.filter((k) => k === 'talk').length, quiet: first.filter((k) => k === 'quiet').length }
    const next = kindsFor(3, 50, done, { talk: 99, quiet: 99 })
    const all = [...first, ...next]
    expect(all.filter((k) => k === 'talk')).toHaveLength(3)
  })

  it('makes the rest from the other kind when one runs out', () => {
    const order = kindsFor(6, 50, undefined, { talk: 1, quiet: 99 })
    expect(order.filter((k) => k === 'talk')).toHaveLength(1)
    expect(order).toHaveLength(6)
  })

  it('a batch video keeps his voice only when he talks in its reaction', () => {
    const bank = mixed()
    const plan = planVideos(bank, slots(10), { id: 'b1', rand: () => 0.3 })
    expect(plan.videos).toHaveLength(10)
    for (const v of plan.videos) expect(Boolean(v.voice)).toBe(v.reaction.id.startsWith('t'))
    // A batch from before becomes two formats, taking turns evenly.
    expect(plan.videos.filter((v) => v.voice)).toHaveLength(5)
    expect(plan.bank.formatDone).toEqual({ 'f-reaction': 5, 'f-talking': 5 })
  })

  it('never makes the same video twice across both kinds', () => {
    let bank = mixed({ headlines: ['one'], music: files('m', 1), products: files('p', 2) })
    // 5 reactions x 2 products x 1 headline x 1 song = 10 different videos.
    const seen = new Set<string>()
    for (let round = 0; round < 3; round++) {
      const plan = planVideos(bank, slots(3), { id: `b${round}`, rand: () => 0.5 })
      for (const v of plan.videos) {
        const key = `${v.reaction.id}|${v.product.id}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
      bank = plan.bank
    }
    expect(seen.size).toBe(9)
    expect(reactionsOfKind(bank, true)).toHaveLength(2)
  })

  it('green screen talking videos keep his voice too', () => {
    const plan = planVideos(mixed({ layout: 'greenscreen' }), slots(6), { id: 'g', rand: () => 0.1 })
    expect(plan.videos.some((v) => v.voice && v.greenScreen)).toBe(true)
    expect(plan.videos.some((v) => !v.voice && v.greenScreen)).toBe(true)
  })

  it('green screen plays the product steps behind him, in order', () => {
    const steps = [
      { id: 's1', name: 'Claude', files: files('a', 2) },
      { id: 's2', name: 'The app', files: files('b', 2) },
    ]
    const plan = planVideos(mixed({ layout: 'greenscreen', steps }), slots(4), { id: 'g', rand: () => 0.1 })
    for (const v of plan.videos) expect(v.steps?.map((s) => s.name)).toEqual(['Claude', 'The app'])
  })
})
