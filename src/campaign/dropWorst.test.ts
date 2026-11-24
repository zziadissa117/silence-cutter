import { describe, expect, it } from 'vitest'

import type { CampaignHooks, HookRow } from '../../supabase/functions/postiz/hookInsights.ts'
import type { BankFile, BatchBank } from './batch'
import { DROP_AFTER, anyToDrop, withoutWorst, worstToDrop } from './dropWorst'

const row = (key: string, mark?: 'best' | 'worst', videos = DROP_AFTER): HookRow => ({ key, label: key, videos, views: 500, score: 500, ...(mark ? { mark } : {}) })
const song = (name: string) => ({ id: name, name: `${name}.mp3` }) as BankFile
const bank = {
  headlines: ['Best one', 'Worst one'],
  music: [song('Good song'), song('Bad song')],
  looks: [
    { look: 'outline', parts: 1 },
    { look: 'snap', parts: 1 },
  ],
} as unknown as BatchBank
const hooks = (rows: Partial<CampaignHooks['rows']>): CampaignHooks => ({ id: 'c', name: 'C', videos: 40, views: 1000, rows: { headline: [], song: [], look: [], reaction: [], ...rows } })

describe('worstToDrop', () => {
  it('asks to drop the worst headline, song and look still in the batch (his ask, 2026-11-24)', () => {
    const d = worstToDrop(hooks({ headline: [row('best one', 'best'), row('worst one', 'worst')], song: [row('Bad song', 'worst')], look: [row('snap', 'worst')] }), bank)
    expect([d.headlines, d.songs, d.looks].map((r) => r.map((x) => x.key))).toEqual([['worst one'], ['Bad song'], ['snap']])
    const next = withoutWorst(bank, d)
    expect(next.headlines).toEqual(['Best one'])
    expect(next.music.map((m) => m.name)).toEqual(['Good song.mp3'])
    expect(next.looks).toEqual([{ look: 'outline', parts: 1 }])
  })
  it('waits for enough videos', () => {
    expect(anyToDrop(worstToDrop(hooks({ song: [row('Bad song', 'worst', DROP_AFTER - 1)] }), bank))).toBe(false)
  })
  it('never drops the last of a kind', () => {
    const d = worstToDrop(hooks({ song: [row('Good song', 'worst'), row('Bad song', 'worst')] }), bank)
    expect(d.songs).toHaveLength(1)
  })
  it('only what is still in the batch', () => {
    expect(anyToDrop(worstToDrop(hooks({ headline: [row('gone already', 'worst')] }), bank))).toBe(false)
  })
})
