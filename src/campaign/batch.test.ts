import { describe, expect, it } from 'vitest'

import {
  clipKey,
  combos,
  dayTimes,
  stepTitle,
  emptyBank,
  filesOf,
  formulaAmounts,
  formulaLine,
  headlinesFrom,
  looksOf,
  pickBatch,
  rememberUsed,
  spend,
  spreadPick,
  styleFor,
  stylesOf,
  usesSteps,
  type BankFile,
  type BatchBank,
} from './batch'

const files = (prefix: string, n: number): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}.mov`, type: 'video/quicktime', size: 1 }))

/** The same "random" every run. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

const bank = (): BatchBank => ({
  ...emptyBank('polsia', 'polsia-a1'),
  reactions: files('r', 6),
  products: files('p', 3),
  headlines: ['POV: your nails', 'wait for it', 'no way this works', 'I was today years old'],
  music: files('m', 2),
})

const count = (values: (string | null)[]) => values.reduce<Record<string, number>>((n, v) => (v ? { ...n, [v]: (n[v] ?? 0) + 1 } : n), {})

describe('mixing a batch', () => {
  it('uses everything evenly: nothing comes round again before everything has', () => {
    const { picks } = pickBatch(bank(), 21, seeded(1))
    expect(picks).toHaveLength(21)
    const reactions = Object.values(count(picks.map((p) => p.reaction)))
    expect(reactions).toHaveLength(6)
    expect(Math.max(...reactions) - Math.min(...reactions)).toBeLessThanOrEqual(1)
    expect(Object.values(count(picks.map((p) => p.product)))).toEqual([7, 7, 7])
    const headlines = Object.values(count(picks.map((p) => p.headline)))
    expect(Math.max(...headlines) - Math.min(...headlines)).toBeLessThanOrEqual(1)
    const music = Object.values(count(picks.map((p) => p.music)))
    expect(Math.max(...music) - Math.min(...music)).toBeLessThanOrEqual(1)
  })

  it('never puts the same reaction, or the same pair, twice in a row', () => {
    const { picks } = pickBatch(bank(), 40, seeded(7))
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].reaction).not.toBe(picks[i - 1].reaction)
    }
  })

  it('is in a different order each time', () => {
    const a = pickBatch(bank(), 6, seeded(1)).picks.map((p) => p.reaction).join()
    const b = pickBatch(bank(), 6, seeded(2)).picks.map((p) => p.reaction).join()
    expect(a).not.toBe(b)
  })

  it('carries on where the last batch left off', () => {
    const first = pickBatch(bank(), 4, seeded(3))
    const next = pickBatch({ ...bank(), used: first.used, lastPair: first.lastPair, made: first.made }, 2, seeded(4))
    const all = [...first.picks, ...next.picks].map((p) => p.reaction)
    // Six reactions, six videos: each once.
    expect(new Set(all).size).toBe(6)
  })

  it('works with one of everything, and with no music', () => {
    const { picks } = pickBatch({ ...bank(), reactions: files('r', 1), products: files('p', 1), headlines: ['one'], music: [] }, 3, seeded(5))
    expect(picks).toEqual(Array(3).fill({ reaction: 'r1', product: 'p1', headline: 'one', music: null }))
  })

  it('makes nothing from an empty bank', () => {
    expect(pickBatch({ ...bank(), products: [] }, 3).picks).toEqual([])
  })
})

describe('his bank: 6 reactions, 1 product, 4 headlines, 2 tracks, 4 a day', () => {
  const his = (): BatchBank => ({
    ...emptyBank('polsia', 'polsia-a1'),
    reactions: files('r', 6),
    products: files('p', 1),
    headlines: ['h1', 'h2', 'h3', 'h4'],
    music: files('m', 2),
  })
  const key = (p: { reaction: string; product: string; headline: string; music: string | null }) => `${p.reaction}|${p.headline}|${p.music}`

  it('makes all 48 different videos before any comes twice - a week at a time', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rand = seeded(seed)
      const week1 = pickBatch(his(), 28, rand)
      const week2 = pickBatch({ ...his(), used: week1.used, lastPair: week1.lastPair, made: week1.made }, 28, rand)
      const all = [...week1.picks, ...week2.picks]
      expect(new Set(all.slice(0, 48).map(key)).size).toBe(48)
      // Then a new round: the next 8 are different from each other too.
      expect(new Set(all.slice(48).map(key)).size).toBe(8)
      // Everything evenly: over the 48, each reaction 8 times, each headline
      // 12, each track 24; within the first week, never more than one apart.
      expect(Object.values(count(all.slice(0, 48).map((p) => p.reaction)))).toEqual([8, 8, 8, 8, 8, 8])
      for (const part of ['reaction', 'headline', 'music'] as const) {
        const week = Object.values(count(week1.picks.map((p) => p[part])))
        expect(Math.max(...week) - Math.min(...week)).toBeLessThanOrEqual(1)
      }
      for (let i = 1; i < all.length; i++) expect(all[i].reaction).not.toBe(all[i - 1].reaction)
    }
  })

  it('forgets combinations with an item that was taken out of the bank', () => {
    const first = pickBatch(his(), 40, seeded(9))
    const fewer = { ...his(), reactions: files('r', 5), used: first.used, lastPair: first.lastPair, made: first.made }
    // 5 x 4 x 2 = 40 combinations; the ones made with r1-r5 still count.
    const next = pickBatch(fewer, 10, seeded(10))
    const before = new Set(first.picks.filter((p) => p.reaction !== 'r6').map(key))
    const fresh = next.picks.filter((p) => !before.has(key(p)))
    expect(fresh.length).toBe(Math.min(10, 40 - before.size))
  })
})

describe('a bank that has made every video it can', () => {
  const his = (): BatchBank => ({
    ...emptyBank('polsia', 'polsia-a1'),
    reactions: files('r', 6),
    products: files('p', 1),
    headlines: ['h1', 'h2', 'h3', 'h4'],
    music: files('m', 2),
  })

  it('counts down: 48, then 20 left after a week', () => {
    expect(combos(his())).toEqual({ total: 48, left: 48 })
    const week = pickBatch(his(), 28, seeded(1))
    expect(combos({ ...his(), made: week.made })).toEqual({ total: 48, left: 20 })
    const rest = pickBatch({ ...his(), used: week.used, lastPair: week.lastPair, made: week.made }, 20, seeded(2))
    expect(combos({ ...his(), made: rest.made })).toEqual({ total: 48, left: 0 })
  })

  it('then lets the footage go and keeps the headlines and music', () => {
    const full = { ...his(), made: pickBatch(his(), 48, seeded(3)).made }
    const { bank, retired } = spend(full, '2026-10-10')
    expect(bank.reactions).toEqual([])
    expect(bank.products).toEqual([])
    expect(bank.headlines).toEqual(['h1', 'h2', 'h3', 'h4'])
    expect(bank.music.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(bank.spent).toEqual({ videos: 48, through: '2026-10-10' })
    expect(retired.sort()).toEqual(['p1', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    expect(combos(bank)).toEqual({ total: 0, left: 0 })
  })

  it('has nothing to count with no footage', () => {
    expect(combos({ ...his(), reactions: [] })).toEqual({ total: 0, left: 0 })
  })
})

describe('headlines pasted in', () => {
  it('are one a line, with blanks and repeats taken out', () => {
    expect(headlinesFrom('POV: your nails\n\n  wait for it \nPOV: YOUR NAILS\n')).toEqual(['POV: your nails', 'wait for it'])
  })
})

describe('when a batch posts', () => {
  const polsia = ['08:00', '11:00', '14:00', '17:00', '20:00', '23:00']

  it('spreads the day\'s videos over the campaign\'s times', () => {
    expect(dayTimes(polsia, 3)).toEqual(['08:00', '14:00', '20:00'])
    expect(dayTimes(polsia, 4)).toEqual(['08:00', '14:00', '17:00', '23:00'])
    expect(dayTimes(polsia, 6)).toEqual(polsia)
    expect(dayTimes(polsia, 9)).toEqual(polsia)
    expect(dayTimes(['20:00', '08:00', 'nope'], 1)).toEqual(['08:00'])
  })
})

describe('a product showcase in steps (Set order)', () => {
  const stepped = (): BatchBank => ({
    ...emptyBank('lovable', 'lovable-a1'),
    reactions: files('r', 3),
    products: files('old', 2),
    headlines: ['h1', 'h2'],
    music: files('m', 2),
    steps: [
      { id: 's1', name: 'Claude', files: files('claude', 2) },
      { id: 's2', name: 'The app', files: files('app', 3) },
      { id: 's3', name: 'The prompt', files: files('prompt', 2) },
    ],
  })

  it('multiplies the videos: every step is its own choice', () => {
    // 3 reactions x (2 x 3 x 2 clips) x 2 headlines x 2 tracks.
    expect(combos(stepped()).total).toBe(3 * 12 * 2 * 2)
    // The old list of product showcases isn't used while there are steps.
    expect(usesSteps(stepped())).toBe(true)
    // ...and is again in green screen, which has no steps.
    expect(usesSteps({ ...stepped(), layout: 'greenscreen' })).toBe(false)
  })

  it('puts one clip of every step in each video, in order, and none twice before all are made', () => {
    const { picks } = pickBatch(stepped(), 144, seeded(3))
    for (const pick of picks) {
      expect(pick.steps).toHaveLength(3)
      expect(pick.steps![0]).toMatch(/^claude/)
      expect(pick.steps![1]).toMatch(/^app/)
      expect(pick.steps![2]).toMatch(/^prompt/)
      expect(pick.product).toBe(pick.steps![0])
    }
    const keys = picks.map((p) => `${p.reaction}|${p.steps!.join('+')}|${p.headline}|${p.music}`)
    expect(new Set(keys).size).toBe(144)
    // Each clip of a step comes round evenly.
    expect(Object.values(count(picks.map((p) => p.steps![1])))).toEqual([48, 48, 48])
  })

  it('still mixes evenly and without repeats when there are too many to list', () => {
    const big: BatchBank = {
      ...stepped(),
      reactions: files('r', 10),
      headlines: Array.from({ length: 20 }, (_, i) => `h${i}`),
      steps: stepped().steps!.map((step) => ({ ...step, files: files(step.id, 8) })),
    }
    expect(combos(big).total).toBe(Infinity)
    const { picks, made } = pickBatch(big, 350, seeded(9))
    const keys = picks.map((p) => `${p.reaction}|${p.steps!.join('+')}|${p.headline}|${p.music}`)
    expect(new Set(keys).size).toBe(350)
    const reactionUse = Object.values(count(picks.map((p) => p.reaction)))
    expect(Math.max(...reactionUse) - Math.min(...reactionUse)).toBeLessThanOrEqual(1)
    expect(made.length).toBeLessThanOrEqual(5000)
  })

  it('lets the clips go, but keeps the step names, once every video is made', () => {
    const { bank: after, retired } = spend(stepped(), '2026-11-01')
    expect(after.steps!.map((s) => [s.name, s.files.length])).toEqual([['Claude', 0], ['The app', 0], ['The prompt', 0]])
    expect(retired).toContain('app3')
  })

  it('knows every file a video needs', () => {
    const f = files('x', 3)
    expect(filesOf({ reaction: f[0], product: f[1], steps: [{ file: f[1] }, { file: f[2] }] })).toEqual(['x1', 'x2', 'x2', 'x3'])
  })
})

describe("a step's words over its clip", () => {
  it('is its name exactly as he typed it', () => {
    expect(stepTitle('DRAW SOMETHING')).toBe('DRAW SOMETHING')
    expect(stepTitle('  the app ')).toBe('the app')
  })
  it('is nothing while it still has the name it was given', () => {
    expect(stepTitle('Step 2')).toBe('')
    expect(stepTitle('step 10')).toBe('')
    expect(stepTitle('')).toBe('')
    expect(stepTitle(undefined)).toBe('')
  })
})

describe('headlines in several looks', () => {
  const looks = (fields: Partial<BatchBank> = {}): BatchBank => ({
    ...emptyBank('polsia', 'polsia-a1'),
    reactions: files('r', 5),
    products: files('p', 1),
    headlines: ['wait for it'],
    headlineStyles: ['outline', 'snap', 'box'],
    ...fields,
  })

  it('takes turns evenly: 15 videos are 5 of each, all with the same words', () => {
    const { picks } = pickBatch(looks(), 15, seeded(3))
    expect(count(picks.map((p) => p.look ?? null))).toEqual({ outline: 5, snap: 5, box: 5 })
    expect(new Set(picks.map((p) => p.headline))).toEqual(new Set(['wait for it']))
    // Each reaction in each look once.
    expect(new Set(picks.map((p) => `${p.reaction}|${p.look}`)).size).toBe(15)
  })

  it('counts each look as different videos', () => {
    expect(combos(looks()).total).toBe(15)
    expect(combos(looks({ headlineStyles: ['snap'] })).total).toBe(5)
  })

  it('with one look, mixes and remembers exactly as before', () => {
    const one = looks({ headlineStyles: ['snap'] })
    const { picks, made } = pickBatch(one, 2, seeded(3))
    expect(picks.every((p) => p.look === undefined)).toBe(true)
    expect(made.every((key) => key.split('|').length === 4)).toBe(true)
  })

  it('never takes turns where no headline is written', () => {
    expect(combos(looks({ headlines: [''] })).total).toBe(5)
    expect(combos(looks({ layout: 'engine' })).total).toBe(5)
  })

  it('reads the one look picked before several could be', () => {
    expect(stylesOf({ headlineStyle: 'snap' })).toEqual(['snap'])
    expect(stylesOf({ headlineStyles: ['box', 'snap'], headlineStyle: 'outline' })).toEqual(['box', 'snap'])
    expect(stylesOf({})).toEqual([])
  })

  it("makes a video in the look it was mixed with, or one he still has picked, or the angle's", () => {
    expect(styleFor('snap', ['outline', 'snap'], 'job1')).toBe('snap')
    expect(['outline', 'box']).toContain(styleFor('snap', ['outline', 'box'], 'job1'))
    expect(styleFor(undefined, ['outline', 'box'], 'job1')).toBe(styleFor(undefined, ['outline', 'box'], 'job1'))
    expect(styleFor('snap', [], 'job1')).toBeUndefined()
  })
})

describe('hooks in shares, Claude + X among them', () => {
  const mixed = (fields: Partial<BatchBank> = {}): BatchBank => ({
    ...emptyBank('openart', 'a1'),
    reactions: files('r', 10),
    products: files('p', 1),
    headlines: ['wait for it'],
    ...fields,
  })

  it('gives each look its share: 2 parts and 1 are two thirds and a third', () => {
    const { picks } = pickBatch(mixed({ looks: [{ look: 'snap', parts: 2 }, { look: 'box', parts: 1 }] }), 9, seeded(5))
    const n = count(picks.map((p) => p.look ?? null))
    expect(Math.abs(n.snap - 6)).toBeLessThanOrEqual(1)
    expect(n.snap + n.box).toBe(9)
  })

  it('takes Claude + X in turn, each amount its own video, never one twice', () => {
    const bank = mixed({
      reactions: files('r', 4),
      headlines: ['one', 'two'],
      looks: [{ look: 'box', parts: 1 }, { look: 'formula', parts: 1 }],
      formula: { left: null, right: null, min: 500, max: 600 },
    })
    // 4 reactions x (2 headlines + 3 amounts).
    expect(combos(bank).total).toBe(20)
    const { picks, made } = pickBatch(bank, 8, seeded(2))
    const formula = picks.filter((p) => p.look === 'formula')
    expect(formula.length).toBe(4)
    for (const p of formula) {
      expect([500, 550, 600]).toContain(p.amount)
      expect(p.headline).toBe('')
    }
    for (const p of picks.filter((p) => p.look === 'box')) expect(['one', 'two']).toContain(p.headline)
    expect(new Set(made).size).toBe(8)
  })

  it('reads the banks saved before: Claude + X alone, or the headline looks then', () => {
    expect(looksOf({ hook: 'formula', headlineStyles: ['snap'] })).toEqual([{ look: 'formula', parts: 1 }])
    expect(looksOf({ headlineStyles: ['box', 'snap'] })).toEqual([
      { look: 'box', parts: 1 },
      { look: 'snap', parts: 1 },
    ])
    expect(looksOf({ hook: 'formula', looks: [{ look: 'snap', parts: 2 }] })).toEqual([{ look: 'snap', parts: 2 }])
    expect(stylesOf({ looks: [{ look: 'snap', parts: 2 }, { look: 'formula', parts: 1 }] })).toEqual(['snap'])
  })

  it('keeps a Claude + X batch on its own exactly as it was', () => {
    const alone = mixed({ reactions: files('r', 3), headlines: [''], hook: 'formula', formula: { left: null, right: null, min: 500, max: 1000 } })
    expect(combos(alone).total).toBe(3)
    expect(pickBatch(alone, 2, seeded(1)).picks.every((p) => p.look === undefined && p.amount === undefined)).toBe(true)
  })

  it('goes through every amount in the range, at most 100 of them', () => {
    expect(formulaAmounts({ min: 500, max: 1000 })).toEqual([500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000])
    const wide = formulaAmounts({ min: 0, max: 100_000 })
    expect(wide).toHaveLength(100)
    expect(wide[0]).toBe(0)
    expect(wide.at(-1)).toBe(100_000)
    expect(wide.every((a) => a % 50 === 0)).toBe(true)
  })

  it('says the amount it was mixed with, keeping its own ending', () => {
    const f = { min: 500, max: 1000 }
    expect(formulaLine(f, 'v1', 650)).toMatch(/^\$650/)
    expect(formulaLine(f, 'v1', 650).replace(/^\$[\d,]+/, '')).toBe(formulaLine(f, 'v1').replace(/^\$[\d,]+/, ''))
  })
})

describe('random times picked from a window', () => {
  const twelve = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30']

  it('takes the middle of the day for one, never just the first', () => {
    expect(spreadPick(twelve, 1)).toEqual(['14:00'])
    expect(spreadPick(twelve, 3)).toEqual(['12:00', '14:00', '16:00'])
  })

  it('takes one from each stretch, a different one each day', () => {
    const a = spreadPick(twelve, 3, 'c|2026-10-12')
    expect(a).toHaveLength(3)
    expect(a[0] < '13:00' && a[1] >= '13:00' && a[1] < '15:00' && a[2] >= '15:00').toBe(true)
    const days = ['10', '11', '12', '13', '14', '15'].map((d) => spreadPick(twelve, 1, `c|2026-10-${d}`)[0])
    expect(new Set(days).size).toBeGreaterThan(2)
  })
})

describe('no video made twice, even after the clips left the bank', () => {
  const clip = (id: string, fp?: string): BankFile => ({ id, name: `${id}.mov`, type: 'video/quicktime', size: 7, ...(fp ? { fp } : {}) })

  it('remembers a clip taken out after videos were made from it - and not one never used', () => {
    const b = { ...emptyBank('c', 'a'), used: { r1: 3 } }
    expect(rememberUsed(b, [clip('r1', 'fp-r1')]).usedClips).toEqual(['fp-r1'])
    expect(rememberUsed(b, [clip('r2', 'fp-r2')])).toBe(b)
  })

  it('knows an old clip with no fingerprint by its name and size', () => {
    expect(clipKey(clip('r1'))).toBe('r1.mov|7')
    expect(clipKey(clip('r1', 'abc'))).toBe('abc')
  })

  it('remembers every clip of a bank that made all its videos', () => {
    const b: BatchBank = { ...emptyBank('c', 'a'), reactions: [clip('r1', 'a1')], products: [clip('p1', 'b1')], headlines: ['h'], used: { r1: 1, p1: 1 }, usedClips: ['old'] }
    const { bank } = spend(b, '2026-10-30')
    expect(bank.usedClips).toEqual(['old', 'a1', 'b1'])
    expect(bank.reactions).toEqual([])
  })
})
