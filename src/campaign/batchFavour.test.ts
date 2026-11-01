import { describe, expect, it } from 'vitest'

import type { CampaignHooks, HookRow } from '../../supabase/functions/postiz/hookInsights.ts'
import { emptyBank, pickBatch, type BankFile, type BatchBank } from './batch'
import { anyFavour, favourFrom, followFavour } from './batchFavour'

const files = (prefix: string, n: number): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}.mov`, type: 'video/quicktime', size: 1 }))

function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

const bank = (fields: Partial<BatchBank> = {}): BatchBank => ({
  ...emptyBank('c1', 'a1'),
  reactions: files('r', 6),
  products: files('p', 8),
  headlines: ['I made $800 a day', 'wait for it', 'no way this works', 'stop scrolling'],
  music: files('m', 4),
  ...fields,
})

const row = (key: string, mark?: 'best' | 'worst'): HookRow => ({ key, label: key, videos: 5, views: 100, score: 100, ...(mark ? { mark } : {}) })
const hooks: CampaignHooks = {
  id: 'c1',
  name: 'C',
  videos: 40,
  views: 100,
  rows: {
    headline: [row('i made $800 a day', 'best'), row('wait for it'), row('stop scrolling', 'worst')],
    reaction: [row('r2', 'best'), row('r1')],
    song: [row('m3', 'best')],
    look: [row('box', 'best'), row('nonsense', 'best')],
  },
}

describe('Use the best hooks', () => {
  it('takes the best of each kind', () => {
    const favour = favourFrom(hooks)
    expect(favour).toEqual({ headlines: ['i made $800 a day'], looks: ['box'], reactions: ['r2'], songs: ['m3'] })
    expect(anyFavour(favour)).toBe(true)
    expect(anyFavour({ headlines: [], looks: [], reactions: [], songs: [] })).toBe(false)
  })

  it('the best come round about twice as often - only while it is on', () => {
    const favour = favourFrom(hooks)
    const count = (b: BatchBank) => {
      const { picks } = pickBatch(b, 120, seeded(7))
      return {
        headline: picks.filter((p) => p.headline === 'I made $800 a day').length,
        reaction: picks.filter((p) => p.reaction === 'r2').length,
        song: picks.filter((p) => p.music === 'm3').length,
      }
    }
    const even = count(bank())
    const best = count(bank({ useBest: true, favour }))
    const off = count(bank({ useBest: false, favour }))
    expect(even).toEqual(off)
    expect(best.headline).toBeGreaterThan(even.headline * 1.5)
    expect(best.reaction).toBeGreaterThan(even.reaction * 1.5)
    expect(best.song).toBeGreaterThan(even.song * 1.5)
  })

  it('never the same video twice, favoured or not', () => {
    const { picks } = pickBatch(bank({ useBest: true, favour: favourFrom(hooks) }), 300, seeded(3))
    const keys = picks.map((p) => `${p.reaction}|${p.product}|${p.headline}|${p.music}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('follows the numbers while on, and leaves the bank alone otherwise', () => {
    expect(followFavour(bank(), hooks)).toBeNull()
    const on = followFavour(bank({ useBest: true }), hooks)!
    expect(on.favour!.reactions).toEqual(['r2'])
    expect(followFavour(on, hooks)).toBeNull()
  })
})
