// How each of a batch's hooks is doing - a headline in a look, or Claude + X
// - counted from the campaign's posts and the videos still to be made, and
// what to do about one that does badly: stop using it (its videos not out
// yet come out and the batch makes others instead), or change its words.
//
// A hook is known by its look and its words. A post carries its look since
// 2026-10-23 (`batch.look`); older posts count by their words alone, in
// "the angle's look", and a Claude + X post is told by its headline
// ("Claude + Lovable = $800 a day").

import { DEFAULT_FORMULA, formulaText, headlinesFrom, looksOf, type BatchBank, type BatchLook, type LookShare } from './batch'
import type { Job } from './jobs'
import type { ServerPost } from './posting'

export interface HookKey {
  /** The look, or null for the angle's own (a post from before looks were
   *  carried, or a batch with one look). */
  look: BatchLook | null
  /** The headline's words, as typed; '' for Claude + X. */
  words: string
}

/** The same hook, whatever the case and spacing of its words. */
export const wordsKey = (words: string) => words.trim().toLowerCase().replace(/\s+/g, ' ')

/** "$800 a day" or "Claude + X = $800 a day": a Claude + X headline. */
const FORMULA = /(?:^|=)\s*\$[\d,]+/

function hookOf(headline: string | null, look: string | null | undefined): HookKey | null {
  const words = headline?.trim() ?? ''
  if (look === 'formula' || (!look && FORMULA.test(words))) return { look: 'formula', words: '' }
  if (!words) return null
  return { look: look === 'box' || look === 'outline' || look === 'snap' ? look : null, words }
}

/** A headline video made before its look was kept: in the batch's one
 *  headline look, when it has just one picked now - or, with none picked,
 *  in the angle's own (`angleLook`) - every headline video of it was then
 *  made in that look (unless he changed it since). With several picked it
 *  can't be told. */
export function assumedLook(bank: Parameters<typeof looksOf>[0], angleLook?: BatchLook | null): BatchLook | null {
  const headlineLooks = looksOf(bank).filter((l) => l.look !== 'formula')
  if (headlineLooks.length === 0) return angleLook ?? null
  return headlineLooks.length === 1 ? headlineLooks[0].look : null
}

const withAssumed = (hook: HookKey | null, assumed: BatchLook | null | undefined): HookKey | null =>
  hook && hook.look === null && assumed ? { ...hook, look: assumed } : hook

export function hookOfPost(post: Pick<ServerPost, 'headline' | 'batch'>, assumed?: BatchLook | null): HookKey | null {
  return withAssumed(hookOf(post.headline, post.batch?.look), assumed)
}

export function hookOfJob(job: Pick<Job, 'headlineText' | 'batch' | 'montage'>, assumed?: BatchLook | null): HookKey | null {
  const bank = job.montage?.bank
  return withAssumed(hookOf(job.headlineText, job.batch?.look ?? (bank?.formula ? 'formula' : bank?.headlineStyle)), assumed)
}

/** Whether a video's hook is the one meant: Claude + X as a whole; a
 *  headline by its words, and by its look when both sides know it. */
export function sameHook(a: HookKey | null, b: HookKey): boolean {
  if (!a) return false
  if (b.look === 'formula' || a.look === 'formula') return a.look === b.look
  if (wordsKey(a.words) !== wordsKey(b.words)) return false
  return a.look === null || b.look === null || a.look === b.look
}

/** A video's views over every account it went to. */
export function postViews(post: Pick<ServerPost, 'views'>): number | null {
  const counts = Object.values(post.views ?? {})
  return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null
}

export interface HookStat extends HookKey {
  /** Gone out. */
  posted: number
  /** Of those, how many have their views read, and their average. */
  read: number
  views: number | null
  /** Scheduled, approved, waiting on the server, or still to be made here. */
  waiting: number
  /** Still in the batch's mix (its words in the headlines, its look picked). */
  inMix: boolean
}

const LIVE = new Set(['uploading', 'writing', 'waiting', 'approved', 'scheduled'])

/** Every hook the campaign's batch videos have, with how each is doing:
 *  one line per headline in each look it was made in (or just the words,
 *  for a batch with one look), and one for Claude + X. Most views first. */
export function hookStats(
  posts: readonly ServerPost[],
  jobs: readonly Job[],
  bank: Pick<BatchBank, 'headlines' | 'looks' | 'hook' | 'headlineStyles' | 'headlineStyle'> & { campaignId: string },
  mixed: readonly LookShare[],
  /** The angle's own headline look: a batch with no look picked is in it. */
  angleLook?: BatchLook | null,
): HookStat[] {
  const rows = new Map<string, HookStat>()
  const keyOf = (h: HookKey) => `${h.look ?? 'angle'}|${h.look === 'formula' ? '' : wordsKey(h.words)}`
  const row = (h: HookKey) => {
    const key = keyOf(h)
    let r = rows.get(key)
    if (!r) {
      const inMix =
        h.look === 'formula'
          ? mixed.some((l) => l.look === 'formula')
          : bank.headlines.some((w) => wordsKey(w) === wordsKey(h.words)) && (h.look === null || mixed.length === 0 || mixed.some((l) => l.look === h.look))
      r = { ...h, posted: 0, read: 0, views: null, waiting: 0, inMix }
      rows.set(key, r)
    }
    return r
  }
  const sums = new Map<string, number>()
  const assumed = assumedLook(bank, angleLook)
  for (const post of posts) {
    if (post.campaignId !== bank.campaignId || !post.batch) continue
    const hook = hookOfPost(post, assumed)
    if (!hook) continue
    const r = row(hook)
    if (post.status === 'posted') {
      r.posted++
      const views = postViews(post)
      if (views !== null) {
        r.read++
        sums.set(keyOf(hook), (sums.get(keyOf(hook)) ?? 0) + views)
      }
    } else if (LIVE.has(post.status)) r.waiting++
  }
  const sent = new Set(posts.map((p) => p.key))
  for (const job of jobs) {
    if (job.campaignId !== bank.campaignId || !job.batch || sent.has(job.id) || job.status === 'done') continue
    const hook = hookOfJob(job, assumed)
    if (hook) row(hook).waiting++
  }
  for (const [key, r] of rows) {
    const sum = sums.get(key)
    r.views = r.read > 0 && sum !== undefined ? Math.round(sum / r.read) : null
  }
  return [...rows.values()].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.posted - a.posted)
}

/** How many of a hook's videos must have their views read, on each side,
 *  before it can be called weak - a day-old video has few views yet. */
export const WEAK_AFTER = 5
/** Weak: under this share of what the batch's other hooks average. */
export const WEAK_SHARE = 0.5

/** The hooks doing badly enough to drop by themselves: at least WEAK_AFTER
 *  videos read, averaging under half of what the others average (over at
 *  least WEAK_AFTER read videos of theirs). Only hooks still in the mix. */
export function weakHooks(stats: readonly HookStat[]): HookStat[] {
  const read = stats.filter((s) => s.read >= WEAK_AFTER && s.views !== null)
  return read.filter((s) => {
    if (!s.inMix) return false
    const others = read.filter((o) => o !== s)
    const theirRead = others.reduce((n, o) => n + o.read, 0)
    if (theirRead < WEAK_AFTER) return false
    const theirAverage = others.reduce((n, o) => n + o.views! * o.read, 0) / theirRead
    return theirAverage > 0 && s.views! < theirAverage * WEAK_SHARE
  })
}

/** The bank without this hook: Claude + X or a look taken out of the mix
 *  (never the last look), a headline's words taken out of the headlines. */
export function dropHook(bank: BatchBank, hook: HookKey, mixed: readonly LookShare[]): BatchBank {
  if (hook.look === 'formula') {
    const looks = mixed.filter((l) => l.look !== 'formula')
    return looks.length > 0 ? { ...bank, looks, hook: 'headline' } : bank
  }
  const headlines = bank.headlines.filter((w) => wordsKey(w) !== wordsKey(hook.words))
  const used = { ...bank.used }
  for (const w of bank.headlines) if (wordsKey(w) === wordsKey(hook.words)) delete used[w]
  return { ...bank, headlines, used }
}

/** The bank with a look alone taken out of the mix (its headlines stay in
 *  the other looks). */
export function dropLook(bank: BatchBank, look: BatchLook, mixed: readonly LookShare[]): BatchBank {
  const looks = mixed.filter((l) => l.look !== look)
  return looks.length > 0 ? { ...bank, looks } : bank
}

/** The bank with one look changed for another: `from` leaves the mix and
 *  its share goes to `to` (added, or with its own share grown). Claude + X
 *  brings the logos he last set, if this bank has none yet. */
export function swapLook(bank: BatchBank, from: BatchLook, to: BatchLook): BatchBank {
  const picked = looksOf(bank)
  const parts = picked.find((l) => l.look === from)?.parts ?? 1
  const rest = picked.filter((l) => l.look !== from)
  const looks = rest.some((l) => l.look === to) ? rest.map((l) => (l.look === to ? { ...l, parts: l.parts + parts } : l)) : [...rest, { look: to, parts }]
  return {
    ...bank,
    looks,
    hook: undefined,
    headlineStyles: undefined,
    headlineStyle: undefined,
    ...(to === 'formula' && !bank.formula ? { formula: DEFAULT_FORMULA } : {}),
  }
}

/** The looks a look's videos can be changed to: the others - a headline look
 *  only with headlines written, Claude + X only with both logos and never in
 *  green screen. */
export function lookChoices(bank: Pick<BatchBank, 'headlines' | 'formula' | 'layout'>, from: BatchLook, all: readonly BatchLook[]): BatchLook[] {
  return all.filter((look) => {
    if (look === from) return false
    if (look === 'formula') return bank.layout !== 'greenscreen' && Boolean(bank.formula?.left && bank.formula?.right)
    return bank.headlines.some((h) => h.trim())
  })
}

/** The bank with a headline's words changed: the new words in its place,
 *  starting fresh (used once nothing, made nothing). */
export function changeHeadline(bank: BatchBank, from: string, to: string): BatchBank {
  const [next] = headlinesFrom(to)
  if (!next) return dropHook(bank, { look: null, words: from }, [])
  const headlines = bank.headlines.flatMap((w) => (wordsKey(w) === wordsKey(from) ? [next] : [w]))
  const used = { ...bank.used }
  for (const w of bank.headlines) if (wordsKey(w) === wordsKey(from)) delete used[w]
  return { ...bank, headlines: [...new Set(headlines)], used }
}

/** What to call a hook on screen. */
export function hookLabel(hook: HookKey, bank: Pick<BatchBank, 'formula'>): string {
  if (hook.look === 'formula') return bank.formula ? formulaText(bank.formula, '$ a day') : 'Claude + X'
  return `"${hook.words}"`
}

/** The lines as the Batch tab shows them: by words (each headline whatever
 *  its look, Claude + X as one) or by look (White box, Outline, Snapchat,
 *  Claude + X, with "the angle's" for videos from before looks were carried). */
export function groupHooks(stats: readonly HookStat[], by: 'words' | 'look'): HookStat[] {
  const groups = new Map<string, HookStat>()
  for (const s of stats) {
    const formula = s.look === 'formula'
    const key = by === 'words' ? (formula ? 'formula' : wordsKey(s.words)) : (s.look ?? 'angle')
    const g = groups.get(key) ?? {
      look: by === 'words' ? (formula ? 'formula' : null) : s.look,
      words: by === 'words' && !formula ? s.words : '',
      posted: 0,
      read: 0,
      views: null,
      waiting: 0,
      inMix: false,
    }
    g.posted += s.posted
    g.waiting += s.waiting
    g.inMix = g.inMix || s.inMix
    if (s.views !== null && s.read > 0) {
      g.views = Math.round(((g.views ?? 0) * g.read + s.views * s.read) / (g.read + s.read))
      g.read += s.read
    }
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.posted - a.posted)
}

/** Whether a video was made in this look (a video from before looks were
 *  carried is nobody's). */
export function sameLook(a: HookKey | null, look: BatchLook): boolean {
  return a !== null && a.look === look
}
