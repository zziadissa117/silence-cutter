import { describe, expect, it } from 'vitest'

import { batchCaptionLook, emptyBank, formatBank, formatSharesFrom, formatsOf, turnsFor, withFormats, type BankFile, type BatchBank, type BatchFormat, type BatchSlot } from './batch'
import { leftToMake, missingFor, planVideos, variationParts } from './batchRun'

const files = (prefix: string, n: number, formats?: string[]): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}.mp4`, type: 'video/mp4', size: 1, ...(formats ? { formats } : {}) }))
const slots = (n: number): BatchSlot[] => Array.from({ length: n }, (_, i) => ({ date: '2026-11-07', time: `${String(i % 24).padStart(2, '0')}:00` }))

const formats: BatchFormat[] = [
  { id: 'r', kind: 'reaction', name: 'Reaction - shocked' },
  { id: 't', kind: 'talking', name: 'Talking - story' },
  { id: 'g', kind: 'greenscreen', name: 'Green screen - app', corner: { side: 'left', sizePct: 30 } },
]
const godari = (fields: Partial<BatchBank> = {}): BatchBank => ({
  ...emptyBank('godari', 'a1'),
  formats,
  reactions: [...files('react', 2, ['r']), ...files('talk', 2, ['t']), ...files('green', 2, ['g'])],
  products: [...files('prod', 2, ['r', 't']), ...files('bg', 2, ['g'])],
  headlines: ['one', 'two'],
  music: files('song', 1),
  ...fields,
})

describe('one batch for the account, made of formats', () => {
  it('takes turns between its formats evenly', () => {
    expect(turnsFor(6, [{ id: 'a', weight: 1, done: 0, room: 99 }, { id: 'b', weight: 1, done: 0, room: 99 }, { id: 'c', weight: 1, done: 0, room: 99 }])).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
    // One with nothing left: the others make the rest.
    expect(turnsFor(4, [{ id: 'a', weight: 1, done: 0, room: 1 }, { id: 'b', weight: 1, done: 0, room: 99 }])).toEqual(['a', 'b', 'b', 'b'])
    // A share of 2: twice as many.
    expect(turnsFor(6, [{ id: 'a', weight: 2, done: 0, room: 99 }, { id: 'b', weight: 1, done: 0, room: 99 }]).filter((x) => x === 'a')).toHaveLength(4)
  })

  it('makes each format from its own clips: silent reactions, his voice, green screen in his corner', () => {
    const plan = planVideos(godari(), slots(9), { id: 'b', rand: () => 0.4 })
    expect(plan.videos).toHaveLength(9)
    for (const v of plan.videos) {
      const f = v.batch.format
      if (f === 'r') expect(v.reaction.id.startsWith('react') && !v.voice && !v.greenScreen && v.product.id.startsWith('prod')).toBe(true)
      if (f === 't') expect(v.reaction.id.startsWith('talk') && v.voice && !v.greenScreen && v.product.id.startsWith('prod')).toBe(true)
      if (f === 'g') expect(v.reaction.id.startsWith('green') && !v.voice && v.greenScreen?.side === 'left' && v.product.id.startsWith('bg')).toBe(true)
    }
    expect(plan.bank.formatDone).toEqual({ r: 3, t: 3, g: 3 })
  })

  it('makes none of a paused format, and no video twice', () => {
    let bank = godari({ formats: formats.map((f) => (f.id === 't' ? { ...f, paused: true } : f)) })
    const seen = new Set<string>()
    for (let round = 0; round < 3; round++) {
      const plan = planVideos(bank, slots(4), { id: `b${round}`, rand: () => 0.5 })
      for (const v of plan.videos) {
        expect(v.batch.format).not.toBe('t')
        const key = `${v.reaction.id}|${v.product.id}|${v.headline}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
      bank = plan.bank
    }
  })

  it('counts what is left across the formats, and goes on with the others while one waits for its clips', () => {
    // 2 clips x 2 products x 2 headlines in each of three formats.
    expect(leftToMake(godari()).total).toBe(24)
    const noBackground = godari({ products: files('prod', 2, ['r', 't']) })
    expect(missingFor(noBackground)).toEqual([])
    expect(planVideos(noBackground, slots(4), { id: 'x' }).videos.every((v) => v.batch.format !== 'g')).toBe(true)
    expect(variationParts(godari())[0]).toMatch(/^Reaction - shocked: 2 reactions × 2 product showcases/)
  })

  it('turns a batch from before into formats, the same way on every phone', () => {
    const old: BatchBank = { ...emptyBank('c', 'a'), reactions: [...files('q', 1), { ...files('t', 1)[0], talks: true }], products: files('p', 1) }
    const made = withFormats(old)
    expect(made.formats?.map((f) => [f.id, f.kind])).toEqual([
      ['f-reaction', 'reaction'],
      ['f-talking', 'talking'],
    ])
    expect(made.products[0].formats).toEqual(['f-reaction', 'f-talking'])
    expect(withFormats(made)).toBe(made)
    const green = withFormats({ ...old, layout: 'greenscreen', corner: { side: 'right', sizePct: 40 } })
    expect(green.formats?.map((f) => f.kind)).toEqual(['greenscreen', 'greenscreen'])
    expect(green.formats?.[1].voice).toBe(true)
    // The engine and Trial loops have none.
    expect(formatsOf({ ...old, layout: 'engine' })).toEqual([])
    // One format's own bank is mixed as it is.
    expect(withFormats(formatBank(made, made.formats![0])).formats).toEqual([])
  })
})

describe('more of the formats whose videos do better', () => {
  const post = (format: string, views: number) => ({ campaignId: 'godari', status: 'posted', batch: { format }, views: { ig: views } })
  const ids = [{ id: 'r' }, { id: 't' }, { id: 'g' }]

  it('stays even until two formats have enough videos out', () => {
    expect(formatSharesFrom([...Array(9)].map(() => post('r', 1000)), 'godari', ids)).toBeUndefined()
    expect(formatSharesFrom([...Array(5)].map(() => post('r', 1000)), 'godari', ids)).toBeUndefined()
  })

  it('gives more of the day to the one getting more views, between half and twice', () => {
    const posts = [...[...Array(5)].map(() => post('r', 4000)), ...[...Array(5)].map(() => post('t', 1000)), ...[...Array(3)].map(() => post('g', 99999))]
    const shares = formatSharesFrom(posts, 'godari', ids)!
    expect(shares.r).toBe(1.6)
    expect(shares.t).toBe(0.5)
    // Too few of its own yet: an even share.
    expect(shares.g).toBeUndefined()
    // And the turns follow.
    const plan = planVideos({ ...godari(), formatShares: shares }, slots(10), { id: 'x', rand: () => 0.3 })
    const count = (f: string) => plan.videos.filter((v) => v.batch.format === f).length
    expect(count('r')).toBeGreaterThan(count('t'))
  })
})

import { talksIn } from './batch'

describe('his voice in a talking head format (his report, 2026-11-08: "all the reaction clips are muted")', () => {
  it('a clip in a Talking head format talks, read from the whole bank too (a remake), whatever its own old mark', () => {
    const bank = godari()
    const talk = { ...bank.reactions.find((r) => r.id === 'talk0')!, talks: false }
    const react = bank.reactions.find((r) => r.id === 'react0')!
    expect(talksIn(bank, talk)).toBe(true)
    expect(talksIn(bank, react)).toBe(false)
    // A green screen only when he turned "You talk in these" on.
    const green = bank.reactions.find((r) => r.id === 'green0')!
    expect(talksIn(bank, green)).toBe(false)
    expect(talksIn({ ...bank, formats: formats.map((f) => (f.id === 'g' ? { ...f, voice: true } : f)) }, green)).toBe(true)
    // An old bank with no formats keeps its own marks.
    expect(talksIn({ voice: true }, { id: 'x', name: 'x', type: 'video/mp4', size: 1 })).toBe(true)
  })
})

describe('a format with no headline (his ask, 2026-11-13: the clip of him is the hook)', () => {
  it('makes its videos with no words over him, the other formats keep theirs', () => {
    const bank = godari({ formats: formats.map((f) => (f.id === 't' ? { ...f, noHeadline: true } : f)) })
    const sub = formatBank(bank, bank.formats![1])
    expect(sub.headlines).toEqual([])
    expect(sub.formula).toBeUndefined()
    const plan = planVideos(bank, slots(9), { id: 'h', rand: () => 0.4 })
    for (const v of plan.videos) {
      if (v.batch.format === 't') expect(v.headline).toBe('')
      if (v.batch.format === 'r') expect(['one', 'two']).toContain(v.headline)
    }
    // Still something to make.
    expect(missingFor(sub)).toEqual([])
  })
})

describe("a batch video's captions look (his report, 2026-11-14: one word at a time on his server)", () => {
  const here = { style: 'word', size: 'large' } as const
  it('a talking head: full phrases unless he picked another, at his Cutter size', () => {
    expect(batchCaptionLook({ kind: 'talking' }, null, here)).toEqual({ style: 'phrase', size: 'large' })
    expect(batchCaptionLook({ kind: 'talking', captionStyle: 'highlight', captionSize: 'small' }, null, here)).toEqual({ style: 'highlight', size: 'small' })
  })
  it('on the Cutter server, the phone that sent the batch decides - not that computer', () => {
    const bank = { cutterCaptions: { style: 'highlight', size: 'small' } } as const
    expect(batchCaptionLook({ kind: 'talking' }, bank, here)).toEqual({ style: 'phrase', size: 'small' })
    expect(batchCaptionLook({ kind: 'reaction' }, bank, here)).toEqual({ style: 'highlight', size: 'small' })
    expect(batchCaptionLook(undefined, null, here)).toEqual(here)
  })
})
