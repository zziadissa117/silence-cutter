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
  /** Every different video its reactions and products could make has been
   *  made, so they were cleared out for new footage: how many videos that
   *  was, and the day the last of them posts. */
  spent?: { videos: number; through: string }
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
 *  or more away, when there is no batch yet for today. */
export function planSlots({
  times,
  perDay,
  days,
  madeThrough,
  now = new Date(),
}: {
  times: string[]
  perDay: number
  days: number
  madeThrough?: string
  now?: Date
}): BatchSlot[] {
  const today = todayHere(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const daily = dayTimes(times, perDay)
  if (daily.length === 0 || days < 1) return []
  let first = madeThrough && madeThrough >= today ? addDays(madeThrough, 1) : today
  const leftToday = (date: string) => daily.filter((t) => date !== today || minutes(t) >= nowMinutes + LEAD_MINUTES)
  if (leftToday(first).length === 0) first = addDays(first, 1)
  const slots: BatchSlot[] = []
  for (let d = 0; d < days; d++) {
    const date = addDays(first, d)
    for (const time of leftToday(date)) slots.push({ date, time })
  }
  return slots
}

/** "Wed Sep 30" - how a day reads on the phone. */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
