import { describe, expect, it } from 'vitest'

import { emptyBank, type BankFile, type BatchBank, type BatchFormat } from './batch'
import { allVariations, comboKey, everyCombination, variationVideos, variationsToMake } from './variations'

const files = (prefix: string, n: number, formats?: string[]): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}.mp4`, type: 'video/mp4', size: 1, ...(formats ? { formats } : {}) }))

const talking: BatchFormat = { id: 't', kind: 'talking', name: 'Brand hooks' }
const reaction: BatchFormat = { id: 'r', kind: 'reaction', name: 'Reaction' }

/** His brand's ask: 9 hooks, 2 bodies (one product step with 2 clips). */
const brand = (fields: Partial<BatchBank> = {}): BatchBank => ({
  ...emptyBank('brand', 'a1'),
  variations: true,
  formats: [talking],
  reactions: files('hook', 9, ['t']),
  steps: [{ id: 's1', name: 'Body', files: files('body', 2), formats: ['t'] }],
  music: files('song', 3),
  ...fields,
})

describe('variations of a video (his ask, 2026-11-17)', () => {
  it('every hook with every body, each exactly once: 9 hooks x 2 bodies = 18', () => {
    const all = allVariations(brand())
    expect(all).toHaveLength(18)
    expect(new Set(all.map((v) => v.combo)).size).toBe(18)
    for (let h = 0; h < 9; h++) for (let b = 0; b < 2; b++) expect(all.some((v) => v.hook.id === `hook${h}` && v.body[0].id === `body${b}`)).toBe(true)
  })

  it('several product steps: every combination of their clips is a body', () => {
    const bank = brand({
      reactions: files('hook', 2, ['t']),
      steps: [
        { id: 's1', name: 'One', files: files('a', 2), formats: ['t'] },
        { id: 's2', name: 'Two', files: files('b', 3), formats: ['t'] },
      ],
    })
    expect(allVariations(bank)).toHaveLength(2 * 2 * 3)
    expect(everyCombination([['a', 'b'], ['c']])).toEqual([['a', 'c'], ['b', 'c']])
  })

  it('a reaction format without steps: every reaction with every product', () => {
    const bank = brand({ formats: [reaction], reactions: files('react', 3, ['r']), steps: undefined, products: files('prod', 2, ['r']), headlines: ['one', 'two'] })
    expect(allVariations(bank)).toHaveLength(6)
  })

  it('makes only the ones not made yet', () => {
    const bank = brand()
    const made = new Set([comboKey('t', 'hook0', ['body0']), comboKey('t', 'hook0', ['body1'])])
    expect(variationsToMake(bank, made)).toHaveLength(16)
  })

  it('each video: its hook, its body, never scheduled - marked a variation, songs in turn', () => {
    const list = allVariations(brand())
    const videos = variationVideos(brand(), list, { id: 'v', now: new Date('2026-11-17T15:30:00') })
    expect(videos).toHaveLength(18)
    videos.forEach((v, i) => {
      expect(v.reaction.id).toBe(list[i].hook.id)
      expect(v.steps?.map((s) => s.file.id)).toEqual(list[i].body.map((f) => f.id))
      expect(v.batch.variation?.combo).toBe(list[i].combo)
      expect(v.batch.format).toBe('t')
      expect(v.voice).toBe(true)
    })
    expect(new Set(videos.map((v) => v.music?.id)).size).toBe(3)
  })

  it('a paused format, or one missing its body, makes none', () => {
    expect(allVariations(brand({ formats: [{ ...talking, paused: true }] }))).toHaveLength(0)
    expect(allVariations(brand({ steps: [{ id: 's1', name: 'Body', files: [], formats: ['t'] }] }))).toHaveLength(0)
  })
})
