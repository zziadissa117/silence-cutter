import { describe, expect, it } from 'vitest'

import { emptyBank, type BankFile, type BatchBank } from './batch'
import { MOST_A_DAY, missingFor, perDayOn, planVideos, runSlots } from './batchRun'
import { blankAngle } from './look'
import {
  BRIGHTNESS,
  NOT_ALLOWED,
  instagramLimit,
  newTrialBank,
  placesFor,
  planTrial,
  trimFor,
  songFor,
  talkRead,
  trialAngle,
  trialDays,
  trialFileName,
  trialMissing,
  sameWords,
  doubledCopy,
  variantsOf,
  viralOf,
  withAccounts,
  withCheckedWords,
  withSource,
  withoutSource,
  wordsOf,
  type TrialRead,
  type TrialSource,
} from './trialLoop'
import { likeness, startOf } from './viralReel'

const read: TrialRead = {
  text: 'POV: you found the hack',
  style: 'outline',
  outlineColor: '#000000',
  size: 'large',
  x: 0.5,
  y: 0.3,
  rewordings: ['POV: you found the trick', 'POV: you just found the hack', 'POV: you finally found the hack'],
}

const file = (id: string, name = `${id}.mov`): BankFile => ({ id, name, type: 'video/quicktime', size: 1000 })

function source(id: string, over: Partial<TrialSource> = {}): TrialSource {
  return { id, name: `${id}-viral.mp4`, clip: `${id}-clip`, sound: `${id}-sound`, read, addedAt: 1, ...over }
}

function bankWith(...sources: TrialSource[]): BatchBank {
  let bank = newTrialBank('trial-campaign', 'angle', 30)
  for (const s of sources) bank = withSource(bank, s, file(s.clip), s.sound ? file(s.sound, `${s.id}.m4a`) : null, new Date('2026-11-05T10:00:00'))
  return bank
}

describe('where the words go', () => {
  it("starts at the viral reel's own place, then moves up and down inside the safe area", () => {
    const places = placesFor({ x: 0.5, y: 0.3 })
    expect(places[0]).toEqual({ x: 0.5, y: 0.3, scale: 1 })
    expect(places.length).toBeGreaterThanOrEqual(5)
    for (const p of places) {
      expect(p.y).toBeGreaterThanOrEqual(0.12)
      expect(p.y).toBeLessThanOrEqual(0.68)
    }
    // No two places on top of each other.
    const ys = places.map((p) => p.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(0.04)
  })

  it('keeps words centred across, moved only up or down inside the frame, never two in the same spot', () => {
    const places = placesFor({ x: 0.02, y: 0.05 })
    expect(places.every((p) => p.x === 0.5 && p.y >= 0.12)).toBe(true)
    expect(placesFor({ x: 0.9, y: 0.4 }).every((p) => p.x === 0.5)).toBe(true)
    expect(new Set(places.map((p) => p.y)).size).toBe(places.length)
  })
})

describe('how each video differs', () => {
  it('never puts his exact words back at their own place - that would be the viral reel itself', () => {
    const exact = variantsOf(source('a'), true)
    expect(exact.length).toBeGreaterThan(0)
    expect(exact.every((v) => v.wording === 0 && v.place > 0)).toBe(true)
    const reworded = variantsOf(source('a'), false)
    expect(reworded.every((v) => v.wording > 0)).toBe(true)
    expect(reworded.some((v) => v.place === 0)).toBe(true)
  })

  it('half his exact words, half a rewording, each combination once before any again', () => {
    const bank = bankWith(source('a'))
    const { plans, made } = planTrial(bank, 40, { seed: 'x' })
    expect(plans).toHaveLength(40)
    const exact = plans.filter((p) => p.variant.wording === 0).length
    expect(exact).toBe(20)
    expect(new Set(made).size).toBe(40)
    for (const p of plans) {
      expect(p.text).toBe(wordsOf(read, p.variant.wording))
      expect(BRIGHTNESS).toContain(p.look.brightness)
      expect(p.clip.id).toBe('a-clip')
      expect(p.sound?.id).toBe('a-sound')
    }
  })

  it('starts over once every way is made - it never runs out', () => {
    const bank = bankWith(source('a', { read: { ...read, rewordings: [] } }))
    const all = variantsOf(bank.trial!.sources[0], true).length
    const { plans } = planTrial(bank, all * 2 + 3, { seed: 'y' })
    expect(plans).toHaveLength(all * 2 + 3)
    expect(plans.every((p) => p.variant.wording === 0)).toBe(true)
  })

  it('takes the viral reels in turn and carries on where the last top-up stopped', () => {
    const bank = bankWith(source('a'), source('b'), source('c', { stopped: true }))
    const first = planTrial(bank, 3, { seed: 'z' })
    expect(first.plans.map((p) => p.source.id)).toEqual(['a', 'b', 'a'])
    const next = planTrial({ ...bank, made: first.made, used: first.used, lastPair: first.lastPair }, 2, { seed: 'z2' })
    expect(next.plans.map((p) => p.source.id)).toEqual(['b', 'a'])
    expect(next.used).toEqual({ a: 3, b: 2 })
  })
})

describe('a Trial loop in the batch machinery', () => {
  it('makes its videos as trials, in the viral look, never running out', () => {
    const bank = { ...bankWith(source('a')), running: true }
    const slots = [
      { date: '2026-11-05', time: '13:07' },
      { date: '2026-11-05', time: '14:31' },
    ]
    const out = planVideos(bank, slots, { id: 'b-1', now: new Date('2026-11-05T10:00:00') })
    expect(out.videos).toHaveLength(2)
    for (const v of out.videos) {
      expect(v.batch.trial).toBe(true)
      expect(v.trial?.style).toBe('outline')
      expect(v.reaction.id).toBe('a-clip')
      expect(v.music?.id).toBe('a-sound')
    }
    expect(out.bank.filled?.['2026-11-05']).toBe(2)
    expect(out.bank.running).toBe(true)
    expect(out.retire).toEqual([])
  })

  it('asks for a viral reel until one is in', () => {
    expect(missingFor(newTrialBank('c', 'a'))).toEqual(['a viral reel'])
    expect(missingFor(bankWith(source('a')))).toEqual([])
    expect(trialMissing({ ...bankWith(source('a')), reactions: [] })).toEqual(['the clean clip'])
  })

  it("is held to Instagram's daily trial limit, whatever his number", () => {
    expect(perDayOn({ perDay: 30, most: 20 }, '2026-11-05')).toBe(20)
    expect(perDayOn({ perDay: 10, most: 20 }, '2026-11-05')).toBe(10)
    expect(perDayOn({ perDay: 60 }, '2026-11-05')).toBe(MOST_A_DAY)
    const place = { accounts: ['ig'], times: [] }
    const slots = runSlots({ bank: { perDay: 30, most: 20 }, place, campaignId: 'c', now: new Date('2026-11-05T00:30:00') })
    expect(slots.filter((s) => s.date === '2026-11-06')).toHaveLength(20)
  })

  it('learns the limit and stops where Instagram takes no trials', () => {
    const bank = bankWith(source('a'))
    const limited = withAccounts(bank, { limits: { ig: { perDay: 20, at: '' } } }, ['ig'])
    expect(limited.most).toBe(20)
    expect(withAccounts(limited, { limits: { ig: { perDay: 20, at: '' } } }, ['ig'])).toBe(limited)
    const blocked = withAccounts(bank, { notAllowed: { ig: { at: '' } } }, ['ig'])
    expect(blocked.runProblem).toBe(NOT_ALLOWED)
    expect(withAccounts(blocked, {}, ['ig']).runProblem).toBeUndefined()
    expect(instagramLimit({ limits: { a: { perDay: 25, at: '' }, b: { perDay: 18, at: '' } } }, ['a', 'b'])).toBe(18)
    expect(instagramLimit(undefined, ['a'])).toBeNull()
  })

  it("draws the viral reel's words at the video's place, with no effects", () => {
    const angle = { ...blankAngle('x', 'General'), effects: { ...blankAngle('x', 'G').effects, hookPush: 'on' as never } }
    const look = { sourceId: 'a', style: 'box' as const, outlineColor: '#ffffff', size: 'small' as const, place: { x: 0.5, y: 0.6, scale: 1 }, brightness: 0.04 }
    const made = trialAngle(angle, look)
    expect(made.headline).toMatchObject({ style: 'box', outlineColor: '#ffffff', size: 'small', place: { x: 0.5, y: 0.6, scale: 1 } })
    expect(made.effects.hookPush).toBe('off')
  })
})

describe('stopping one viral reel', () => {
  it('lets its files go and keeps the others; the loop stops with none left', () => {
    const bank = { ...bankWith(source('a'), source('b')), made: ['t:a:0|1|0', 't:b:1|0|0'] }
    const one = withoutSource(bank, 'a')
    expect(one.retire.sort()).toEqual(['a-clip', 'a-sound'])
    expect(one.bank.reactions.map((f) => f.id)).toEqual(['b-clip'])
    expect(one.bank.made).toEqual(['t:b:1|0|0'])
    expect(one.bank.running).toBe(true)
    const none = withoutSource(one.bank, 'b')
    expect(none.bank.running).toBe(false)
    expect(none.bank.trial?.sources).toEqual([])
  })
})

describe('the screen', () => {
  it('tells the viral reel from the clean clip by its sound', () => {
    expect(viralOf([{ file: 'clean', sound: false }, { file: 'viral', sound: true }])).toEqual({ viral: 'viral', clean: 'clean' })
    expect(viralOf([{ file: 'a', sound: true }, { file: 'b', sound: true }])).toBeNull()
    expect(viralOf([{ file: 'a', sound: true }])).toBeNull()
  })

  it("counts today's trials and says what Instagram turned down", () => {
    const post = (status: string, date: string, error: string | null = null, at = `${date}T12:00:00Z`) => ({
      campaignId: 't',
      status,
      postAt: at,
      error,
      batch: { date, trial: true as const },
    })
    const days = trialDays(
      [
        post('posted', '2026-11-05'),
        post('scheduled', '2026-11-05'),
        post('scheduled', '2026-11-06'),
        post('error', '2026-11-05', 'Instagram takes 20 trial reels a day'),
        post('rejected', '2026-11-05'),
        { ...post('posted', '2026-11-05'), campaignId: 'other' },
      ],
      't',
      '2026-11-05',
    )
    expect(days).toEqual({ outToday: 1, toGoToday: 1, ahead: 1, refused: ['Instagram takes 20 trial reels a day'] })
  })

  it("names a source's videos after its clean clip", () => {
    expect(trialFileName({ name: 'IMG_1234.MOV' })).toBe('IMG_1234 (trial).mp4')
  })
})

describe('where the viral reel starts', () => {
  it('finds the first frame that is clearly the clean clip, or none', () => {
    expect(startOf([{ at: 0, like: 0.1 }, { at: 0.5, like: 0.2 }, { at: 1, like: 0.9 }, { at: 1.1, like: 0.95 }])).toBe(1)
    expect(startOf([{ at: 0, like: 0.2 }, { at: 1, like: 0.3 }])).toBe(0)
    expect(startOf([])).toBe(0)
    // A reel and its clean clip of the same length start together: a match
    // further in (a picture that comes back) is not its start.
    expect(startOf([{ at: 0, like: 0.7 }, { at: 3, like: 0.95 }], 0.25)).toBe(0)
    // A screen recording 2 s longer may start up to 2 s in.
    expect(startOf([{ at: 0, like: 0.1 }, { at: 1.5, like: 0.9 }, { at: 6, like: 0.97 }], 2.25)).toBe(1.5)
  })

  it('tells the same picture from another', () => {
    const w = 4
    const h = 6
    const a = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 255)
    const brighter = a.map((v) => v * 0.8 + 30)
    const other = Float32Array.from({ length: w * h }, (_, i) => (i * 91 + 13) % 255)
    expect(likeness(a, brighter, w, h)).toBeGreaterThan(0.99)
    expect(likeness(a, other, w, h)).toBeLessThan(0.6)
  })
})

describe("a reel's rewordings, checked again", () => {
  it('takes the checked ones and says which old ones went', () => {
    const bank = { ...emptyBank('c', 'a'), layout: 'trial' as const, trial: { sources: [{ ...source('a'), read: { ...source('a').read, rewordings: ['good one', 'the most starving'] } }] } }
    const { bank: next, dropped } = withCheckedWords(bank, 'a', ['good  one', 'a new one'], 1)
    expect(dropped).toEqual(['the most starving'])
    expect(next.trial?.sources[0].read.rewordings).toEqual(['good  one', 'a new one'])
    expect(next.trial?.sources[0].read.checked).toBe(1)
    expect(sameWords("I'm\nhungry", "i'm  hungry")).toBe(true)
  })
})

describe('a copy that played its clip twice', () => {
  it('is told by being much longer than its clip', () => {
    expect(doubledCopy(17.93, 8.97)).toBe(true)
    expect(doubledCopy(9.0, 8.97)).toBe(false)
    expect(doubledCopy(17.93, undefined)).toBe(false)
    expect(doubledCopy(null, 9)).toBe(false)
  })
})

describe('a talking clip (2026-11-11)', () => {
  it('songs come out evenly, a new order each round, never one twice in a row', () => {
    const songs = ['a', 'b', 'c', 'd']
    const picks = Array.from({ length: 40 }, (_, n) => songFor(songs, n, 'src'))
    for (const s of songs) expect(picks.filter((p) => p === s).length).toBe(10)
    for (let round = 0; round < 10; round++) expect(new Set(picks.slice(round * 4, round * 4 + 4)).size).toBe(4)
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1])
    expect(new Set(Array.from({ length: 10 }, (_, r) => picks.slice(r * 4, r * 4 + 4).join(''))).size).toBeGreaterThan(1)
    expect(songFor([], 3, 'x')).toBeNull()
  })

  it('each copy: the next headline, one of the songs, his voice, the same clip', () => {
    const talk = { words: [{ text: 'Hi', start: 0, end: 0.4 }], headlines: ['one', 'two', 'three'], songs: ['s1', 's2'] }
    const src: TrialSource = { id: 't1', name: 'talk.mov', clip: 't1-clip', sound: null, read: talkRead(talk.headlines, 1), addedAt: 1, talk }
    let bank = withSource(newTrialBank('c', 'a', 30), src, file('t1-clip'), [file('s1', 's1.m4a'), file('s2', 's2.m4a')], new Date('2026-11-11T10:00:00'))
    const { plans } = planTrial(bank, 6, { rand: () => 0.5 })
    expect(plans.map((p) => p.text)).toEqual(['one', 'two', 'three', 'one', 'two', 'three'])
    const songs = plans.map((p) => p.sound?.id)
    expect(songs.filter((s) => s === 's1').length).toBe(3)
    expect(songs.filter((s) => s === 's2').length).toBe(3)
    expect(plans.every((p) => p.clip.id === 't1-clip' && p.look.place.y === talkRead([], 1).y)).toBe(true)
    // Taken out: the clip and its songs go.
    const gone = withoutSource(bank, 't1')
    expect(gone.retire.sort()).toEqual(['s1', 's2', 't1-clip'])
    bank = gone.bank
    expect(bank.music).toEqual([])
  })

  it('its videos keep his voice', () => {
    const talk = { words: [], headlines: ['one'], songs: ['s1'] }
    const src: TrialSource = { id: 't1', name: 'talk.mov', clip: 't1-clip', sound: null, read: talkRead(talk.headlines, 1), addedAt: 1, talk }
    const bank = withSource(newTrialBank('c', 'a', 3), src, file('t1-clip'), [file('s1', 's1.m4a')], new Date('2026-11-11T10:00:00'))
    const plan = planVideos(bank, [{ date: '2026-11-12', time: '10:00' }, { date: '2026-11-12', time: '14:00' }], { now: new Date('2026-11-11T10:00:00') })
    expect(plan.videos.length).toBeGreaterThan(0)
    expect(plan.videos.every((v) => v.voice === true && v.music?.id === 's1')).toBe(true)
  })
})

describe('copies of different lengths (his ask, 2026-11-11: "mostly keep it at 8, but sometimes make it 7 or 6")', () => {
  it('mostly whole, sometimes 1 s shorter, now and then 2 s', () => {
    const counts = new Map<number, number>()
    for (let i = 0; i < 1000; i++) {
      const t = trimFor(i / 1000)
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    expect(counts.get(0)).toBe(600)
    expect(counts.get(1)).toBe(250)
    expect(counts.get(2)).toBe(150)
  })

  it('a viral reel copy gets one; a talking clip copy never - it would cut his last words', () => {
    let n = 0
    const rand = () => [0.1, 0.7, 0.92][n++ % 3]
    const { plans } = planTrial(bankWith(source('a')), 6, { rand })
    expect(plans.every((p) => typeof p.look.trimSec === 'number')).toBe(true)
    expect(new Set(plans.map((p) => p.look.trimSec)).size).toBeGreaterThan(1)
    const talk = { words: [], headlines: ['one'], songs: ['s1'] }
    const src: TrialSource = { id: 't1', name: 'talk.mov', clip: 't1-clip', sound: null, read: talkRead(['one'], 1), addedAt: 1, talk }
    const bank = withSource(newTrialBank('c', 'a', 30), src, file('t1-clip'), [file('s1', 's1.m4a')], new Date('2026-11-11T10:00:00'))
    expect(planTrial(bank, 4, { rand }).plans.every((p) => p.look.trimSec === undefined)).toBe(true)
  })
})
