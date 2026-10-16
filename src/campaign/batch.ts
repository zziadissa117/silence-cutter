// The Batch tab: a campaign's bank of reactions (they go first, with the
// headline), product showcases, headlines and music, mixed into videos made
// days ahead - so many a day, on the campaign's own posting times - each
// waiting for his approval.
//
// The mixing makes every combination of reaction, product, headline and
// track once before any is made twice, in a different order each time, and
// keeps each of them coming round evenly; the same reaction never follows
// itself. What was made is kept, so the next batch carries on where this
// one left off.

/** A file in the bank, kept on this phone only - his own footage. */
export interface BankFile {
  id: string
  name: string
  type: string
  size: number
  seconds?: number
  /** Content fingerprint (fingerprint.ts), so the same recording is never
   *  kept twice. Absent on files kept before it existed; those are matched on
   *  name and size instead. */
  fp?: string
}

export interface BatchBank {
  campaignId: string
  /** The angle whose headline look the videos take. */
  angleId: string
  reactions: BankFile[]
  products: BankFile[]
  headlines: string[]
  music: BankFile[]
  perDay: number
  days: number
  /** How often each item has gone into a video: files by id, headlines by
   *  their words. */
  used: Record<string, number>
  /** The reaction and product of the last video made, never next to itself. */
  lastPair?: string
  /** Every combination made this round, so none is made twice before all
   *  have been. */
  made?: string[]
  /** The last day a batch has been made for. */
  madeThrough?: string
  /** The next batch goes on top of the ones running, on the same days from
   *  today - to post more a day - rather than after the last one. Absent
   *  means on top. */
  stack?: boolean
  /** How many a day the last batch made posts. */
  lastPerDay?: number
  /** Every different video its reactions and products could make has been
   *  made, so they were cleared out for new footage: how many videos that
   *  was, and the day the last of them posts. */
  spent?: { videos: number; through: string }
  /** The hook over each reaction: one of the headlines (absent), or the
   *  "Claude + X = $ a day" formula. */
  hook?: BatchHook
  formula?: BatchFormula
  /** How each video is put together: the reaction then the product (absent),
   *  or green screen - the product playing behind him, cut out in a corner. */
  layout?: BatchLayout
  /** Green screen: which corner he is in, and how big. */
  corner?: { side: 'left' | 'right'; sizePct: number }
}

export type BatchLayout = 'after' | 'greenscreen'

/** What a bank mixes from: in green screen, no music (the background's sound
 *  is the sound), and headlines are optional - none is the default. */
export function mixFrom<T extends Pick<BatchBank, 'layout' | 'headlines' | 'music' | 'hook'>>(bank: T, headlines: string[]): T {
  if (bank.layout !== 'greenscreen') return { ...bank, headlines }
  return { ...bank, music: [], headlines: bank.headlines.length > 0 ? bank.headlines : [''] }
}

/** The "Claude + X = $ a day" hook: two logos with a plus between them over
 *  the reaction, and a money line under them - one amount per video, from
 *  the range he set. Drawn by formulaOverlay.ts. */
export interface BatchFormula {
  left: BankFile | null
  right: BankFile | null
  /** What the logos are, in words - for the caption and the notification
   *  only. Default: the file names. */
  leftName?: string
  rightName?: string
  /** Dollars a day, the range each video's amount is drawn from. */
  min: number
  max: number
}

export const DEFAULT_FORMULA: BatchFormula = { left: null, right: null, min: 500, max: 1000 }

/** What each batch video's hook is: one of his headlines, or the formula. */
export type BatchHook = 'headline' | 'formula'

/** The hook the bank's videos take - headlines unless he switched. */
export function hookOf(bank: Pick<BatchBank, 'hook'>): BatchHook {
  return bank.hook === 'formula' ? 'formula' : 'headline'
}

/** The headlines the mixing goes through: his own, or - for the formula,
 *  where the hook is drawn rather than written - one blank stand-in, so
 *  reactions, products and tracks still go round evenly. */
export function headlinesToMix(bank: Pick<BatchBank, 'hook' | 'headlines'>): string[] {
  return hookOf(bank) === 'formula' ? [''] : bank.headlines
}

const ENDINGS = ['a day', '/day', 'per day', 'daily'] as const

/** A small seeded generator: the same seed, the same numbers. */
function seeded(seed: string): () => number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  let state = hash >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** "$650 a day", "$800/day", "$1,000 per day": a round amount in the range,
 *  in steps of $50, with the ending varied. The same seed - a video's own
 *  id - always gives the same line, so a remake says the same thing. */
export function formulaLine(formula: Pick<BatchFormula, 'min' | 'max'>, seed: string): string {
  const step = 50
  const low = Math.ceil(Math.max(0, Math.min(formula.min, formula.max)) / step) * step
  const high = Math.max(low, Math.floor(Math.max(formula.min, formula.max) / step) * step)
  const random = seeded(seed)
  const amount = low + Math.floor(random() * ((high - low) / step + 1)) * step
  const ending = ENDINGS[Math.floor(random() * ENDINGS.length)]
  return `$${amount.toLocaleString('en-US')}${ending.startsWith('/') ? '' : ' '}${ending}`
}

/** "Claude", from "claude-logo.png". */
export function logoName(file: Pick<BankFile, 'name'> | null, given?: string): string {
  if (given?.trim()) return given.trim()
  if (!file) return ''
  const base = file.name.replace(/\.[^./]+$/, '').replace(/[-_]+/g, ' ').replace(/\blogo\b/gi, '').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : ''
}

/** What the hook says in words, for the caption Claude writes and the
 *  notification: "Claude + OpenArt = $650 a day". */
export function formulaText(formula: BatchFormula, line: string): string {
  const left = logoName(formula.left, formula.leftName) || 'Claude'
  const right = logoName(formula.right, formula.rightName) || 'it'
  return `${left} + ${right} = ${line}`
}

export interface BatchPick {
  reaction: string
  product: string
  headline: string
  music: string | null
}

export function emptyBank(campaignId: string, angleId: string): BatchBank {
  return { campaignId, angleId, reactions: [], products: [], headlines: [], music: [], perDay: 3, days: 7, used: {} }
}

/** The headlines as he pasted them: one a line, blanks and repeats out. */
export function headlinesFrom(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split('\n')) {
    const headline = line.trim()
    const key = headline.toLowerCase()
    if (!headline || seen.has(key)) continue
    seen.add(key)
    out.push(headline)
  }
  return out
}

const headlineKey = (headline: string) => `h:${headline.trim().toLowerCase()}`

/** More combinations than this and they are not all listed - a bank that
 *  big never runs out before its items are balanced anyway. */
const MAX_COMBOS = 200_000

/** `count` videos' worth of picks, and what has been used after them.
 *
 *  Every combination of reaction, product, headline and track is made once
 *  before any is made again: each video is the unmade combination whose
 *  items have been used least, ties broken at random - so the order is
 *  different every time and each reaction, headline and track still comes
 *  round evenly. Only when every combination has been made does the round
 *  start again. The same reaction is never used twice in a row while there
 *  is another. */
export function pickBatch(
  bank: Pick<BatchBank, 'reactions' | 'products' | 'headlines' | 'music' | 'used' | 'lastPair' | 'made'>,
  count: number,
  rand: () => number = Math.random,
): { picks: BatchPick[]; used: Record<string, number>; lastPair?: string; made: string[] } {
  const used = { ...bank.used }
  let lastPair = bank.lastPair
  const picks: BatchPick[] = []
  const made = new Set(bank.made ?? [])
  if (bank.reactions.length === 0 || bank.products.length === 0 || bank.headlines.length === 0) {
    return { picks, used, lastPair, made: [...made] }
  }
  const reactions = bank.reactions.map((r) => r.id)
  const products = bank.products.map((p) => p.id)
  const headlines = bank.headlines.map((h) => ({ text: h, key: headlineKey(h) }))
  const tracks: (string | null)[] = bank.music.length > 0 ? bank.music.map((m) => m.id) : [null]
  const total = reactions.length * products.length * headlines.length * tracks.length
  const comboKey = (r: string, p: string, h: string, m: string | null) => `${r}|${p}|${h}|${m ?? ''}`
  // Combinations made before, with items since taken out of the bank, no
  // longer count against this round.
  const live = new Set<string>()
  if (total <= MAX_COMBOS) {
    for (const r of reactions) for (const p of products) for (const h of headlines) for (const m of tracks) live.add(comboKey(r, p, h.key, m))
    for (const key of made) if (!live.has(key)) made.delete(key)
  }

  for (let i = 0; i < count; i++) {
    if (total <= MAX_COMBOS && made.size >= total) made.clear()
    const lastReaction = lastPair?.split('|')[0]
    let best: { r: string; p: string; h: (typeof headlines)[number]; m: string | null; score: number }[] = []
    let bestScore = Infinity
    const consider = (avoidLast: boolean) => {
      for (const r of reactions) {
        if (avoidLast && reactions.length > 1 && r === lastReaction) continue
        for (const p of products)
          for (const h of headlines)
            for (const m of tracks) {
              if (total <= MAX_COMBOS && made.has(comboKey(r, p, h.key, m))) continue
              const score = (used[r] ?? 0) + (used[p] ?? 0) + (used[h.key] ?? 0) + (m ? (used[m] ?? 0) : 0)
              if (score < bestScore) {
                bestScore = score
                best = [{ r, p, h, m, score }]
              } else if (score === bestScore) best.push({ r, p, h, m, score })
            }
      }
    }
    if (total > MAX_COMBOS) {
      // Too many to list: each part on its own, least used first.
      const least = (keys: string[], avoid?: string) => {
        const pool = keys.filter((k) => k !== avoid).length > 0 ? keys.filter((k) => k !== avoid) : keys
        const low = Math.min(...pool.map((k) => used[k] ?? 0))
        const ties = pool.filter((k) => (used[k] ?? 0) === low)
        return ties[Math.min(ties.length - 1, Math.floor(rand() * ties.length))]
      }
      const hKey = least(headlines.map((h) => h.key))
      best = [{ r: least(reactions, lastReaction), p: least(products), h: headlines.find((h) => h.key === hKey)!, m: tracks[0] === null ? null : least(tracks as string[]), score: 0 }]
    } else {
      consider(true)
      // Only combinations with the last reaction are left unmade.
      if (best.length === 0) consider(false)
    }
    const choice = best[Math.min(best.length - 1, Math.floor(rand() * best.length))]
    for (const key of [choice.r, choice.p, choice.h.key, choice.m]) if (key) used[key] = (used[key] ?? 0) + 1
    made.add(comboKey(choice.r, choice.p, choice.h.key, choice.m))
    lastPair = `${choice.r}|${choice.p}`
    picks.push({ reaction: choice.r, product: choice.p, headline: choice.h.text, music: choice.m })
  }
  return { picks, used, lastPair, made: [...made] }
}

/** How many different videos the bank can make, and how many of those are
 *  still to be made. Infinity for a bank too big to count. */
export function combos(bank: Pick<BatchBank, 'reactions' | 'products' | 'headlines' | 'music' | 'made'>): { total: number; left: number } {
  const tracks: (string | null)[] = bank.music.length > 0 ? bank.music.map((m) => m.id) : [null]
  const total = bank.reactions.length * bank.products.length * bank.headlines.length * tracks.length
  if (total === 0) return { total: 0, left: 0 }
  if (total > MAX_COMBOS) return { total: Infinity, left: Infinity }
  const live = new Set<string>()
  for (const r of bank.reactions)
    for (const p of bank.products)
      for (const h of bank.headlines) for (const m of tracks) live.add(`${r.id}|${p.id}|${headlineKey(h)}|${m ?? ''}`)
  const made = (bank.made ?? []).filter((key) => live.has(key)).length
  return { total, left: total - made }
}

/** Once every different video has been made: the reactions and product
 *  showcases go - he films new ones - and the headlines and music stay. The
 *  files are only deleted once the videos made from them are finished. */
export function spend(bank: BatchBank, through: string): { bank: BatchBank; retired: string[] } {
  const { total } = combos(bank)
  return {
    bank: { ...bank, reactions: [], products: [], made: [], lastPair: undefined, spent: { videos: total, through } },
    retired: [...bank.reactions, ...bank.products].map((f) => f.id),
  }
}

/** "18:00" in minutes since midnight. */
const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** The campaign's times as a sorted list, bad ones out. */
export function cleanTimes(times: string[]): string[] {
  return [...new Set(times.map((t) => t.trim()).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort()
}

/** `perDay` of the campaign's times, spread through the day: 3 of 8, 11,
 *  2, 5, 8 and 11 o'clock are 8 AM, 2 PM and 8 PM. */
export function dayTimes(times: string[], perDay: number): string[] {
  const all = cleanTimes(times)
  if (perDay >= all.length) return all
  const picked = new Set<number>()
  for (let i = 0; i < perDay; i++) picked.add(Math.min(all.length - 1, Math.round((i * all.length) / perDay)))
  return [...picked].sort((a, b) => a - b).map((i) => all[i])
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Today on this phone, as "2026-09-30". */
export function todayHere(now = new Date()): string {
  return now.toLocaleDateString('en-CA')
}

/** Time enough to make a video, send it up and approve it. */
export const LEAD_MINUTES = 60

export interface BatchSlot {
  date: string
  time: string
}

/** Where a batch goes: `days` days of `perDay` times each, from the day
 *  after the last batch - or from today, with only the times still an hour
 *  or more away, when there is no batch yet for today. `times` is his own
 *  list, or a rule giving each day its own (a campaign's random window). */
export function planSlots({
  times,
  perDay,
  days,
  madeThrough,
  now = new Date(),
}: {
  times: string[] | ((date: string) => string[])
  perDay: number
  days: number
  madeThrough?: string
  now?: Date
}): BatchSlot[] {
  const today = todayHere(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const daily = (date: string) => dayTimes(typeof times === 'function' ? times(date) : times, perDay)
  if ((Array.isArray(times) && daily(today).length === 0) || days < 1) return []
  let first = madeThrough && madeThrough >= today ? addDays(madeThrough, 1) : today
  const leftOn = (date: string) => daily(date).filter((t) => date !== today || minutes(t) >= nowMinutes + LEAD_MINUTES)
  if (leftOn(first).length === 0) first = addDays(first, 1)
  const slots: BatchSlot[] = []
  for (let d = 0; d < days; d++) {
    const date = addDays(first, d)
    for (const time of leftOn(date)) slots.push({ date, time })
  }
  return slots
}

/** "Wed Sep 30" - how a day reads on the phone. */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
