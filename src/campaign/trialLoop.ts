// Trial reels (his ask, 2026-11-04): "take our videos that have performed
// really well ... change the place of the text or change the wording by one
// word ... post 30 Trial Reels a day". A Trial loop is a batch (batch.ts,
// layout 'trial') of its own campaign: each viral reel he adds is a source -
// the clean clip (no text, no sound), the viral reel's sound and its words as
// Claude read them (postiz/trial.ts) with a dozen rewordings of a word or two.
// Every video is that clip with that sound, the words in the viral reel's
// look, moved somewhere else or a word changed, sometimes a touch brighter or
// darker. The batch machinery (batchRun.ts) does the rest: so many a day,
// spread over the day, kept topped up, Stop, a new number at once. Each goes
// to Instagram as a Trial Reel - non-followers only, never his followers
// (postiz settingsFor, graduation MANUAL).
//
// Half the videos carry his exact words (in another place), half a
// rewording (anywhere, the viral reel's own place too) - his pick. Every
// combination of words, place and brightness is made once before any is
// made again; then it starts over ("if it has been proven to work once, then
// it can work twice").

import type { BankFile, BatchBank } from './batch'
import { NO_EFFECTS, randomFrom } from './effects'
import type { Angle, HeadlinePlace, HeadlineSize, HeadlineStyle } from './look'
import type { TrialAccounts, TrialRead } from '../../supabase/functions/postiz/trial.ts'

export type { TrialAccounts, TrialRead }
import type { JobBatch } from './store'

/** One viral reel in the loop. */
export interface TrialSource {
  id: string
  /** The viral reel's file name, to tell them apart. */
  name: string
  /** The clean clip (no text, no sound): one of the bank's `reactions`. */
  clip: string
  /** The viral reel's sound, from its first frame: one of the bank's
   *  `music`; null when it had none. */
  sound: string | null
  read: TrialRead
  addedAt: number
  /** Stopped: no more videos of it (the ones made stay, Stop takes them out). */
  stopped?: boolean
}

export interface TrialBank {
  sources: TrialSource[]
}

/** How one video differs from the viral reel. */
export interface TrialVariant {
  sourceId: string
  /** The words: 0 his exact words, n the nth rewording. */
  wording: number
  /** Where the words go: 0 the viral reel's own place, n another. */
  place: number
  /** -2..2: a touch darker or brighter (BRIGHTNESS). */
  light: number
}

/** What the render needs of a trial video (montageRender `brightness`, the
 *  headline in the viral reel's look at `place`). */
export interface TrialLook {
  sourceId: string
  style: HeadlineStyle
  outlineColor: string
  size: HeadlineSize
  place: HeadlinePlace
  /** -1..1: how much white (above 0) or black (below 0) goes over the frame. */
  brightness: number
}

/** The brightness steps: light changes only (his pick: "light, as I said"). */
export const BRIGHTNESS = [-0.08, -0.04, 0, 0.04, 0.08] as const

/** How far up or down the words move from where the viral reel had them, as
 *  a share of the height. */
const MOVES = [0, -0.07, 0.07, -0.14, 0.14, 0.21, -0.21] as const
/** Never higher than this or lower than that: clear of Instagram's top bar
 *  and of the caption and buttons at the bottom. */
const TOP = 0.12
const BOTTOM = 0.68
/** Two places closer than this are the same place. */
const APART = 0.04

/** The places the words can go: the viral reel's own height first, then
 *  moved up and down from it, inside the safe area - always centred across
 *  (his rule, 2026-11-06: to one side they run into the profile picture and
 *  the caption; "make sure it changes on the y-axis only"). */
export function placesFor(read: Pick<TrialRead, 'x' | 'y'>): HeadlinePlace[] {
  const x = 0.5
  const out: HeadlinePlace[] = []
  for (const move of MOVES) {
    const y = Math.min(BOTTOM, Math.max(TOP, read.y + move))
    if (out.some((p) => Math.abs(p.y - y) < APART)) continue
    out.push({ x, y, scale: 1 })
  }
  return out
}

/** The words of a wording: his exact words, or a rewording. */
export function wordsOf(read: TrialRead, wording: number): string {
  return wording === 0 ? read.text : (read.rewordings[wording - 1] ?? read.text)
}

const keyOf = (v: TrialVariant) => `t:${v.sourceId}:${v.wording}|${v.place}|${v.light}`

/** Every way a source's video can differ, exact words or reworded: the
 *  exact words never at the viral reel's own place - that would be the
 *  viral reel itself. */
export function variantsOf(source: TrialSource, exact: boolean): TrialVariant[] {
  const places = placesFor(source.read).length
  const out: TrialVariant[] = []
  const wordings = exact ? [0] : source.read.rewordings.map((_, i) => i + 1)
  for (const wording of wordings) {
    for (let place = exact ? 1 : 0; place < places; place++) {
      for (let light = -2; light <= 2; light++) out.push({ sourceId: source.id, wording, place, light })
    }
  }
  // Only one place (a viral reel whose words fill the frame): the exact
  // words still change, by brightness alone.
  if (exact && out.length === 0) for (const light of [-2, -1, 1, 2]) out.push({ sourceId: source.id, wording: 0, place: 0, light })
  return out
}

/** The rewordings are checked by Claude under this version (the server's
 *  trial.ts REWORD_CHECK): a reel read before is checked again. */
export const REWORD_CHECK = 1

/** The same words, however their spaces and line breaks fall. */
export const sameWords = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').toLowerCase().replace(/\s+/g, ' ').trim() === (b ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** The reel with its checked rewordings, and the wordings that went: those
 *  of the old ones not kept. */
export function withCheckedWords(bank: BatchBank, sourceId: string, rewordings: string[], checked: number): { bank: BatchBank; dropped: string[] } {
  const source = bank.trial?.sources.find((s) => s.id === sourceId)
  if (!source) return { bank, dropped: [] }
  const dropped = source.read.rewordings.filter((old) => !rewordings.some((r) => sameWords(r, old)))
  const sources = bank.trial!.sources.map((s) => (s.id === sourceId ? { ...s, read: { ...s.read, rewordings, checked } } : s))
  return { bank: { ...bank, trial: { ...bank.trial!, sources } }, dropped }
}

/** A trial copy made before 2026-11-06 played its clean clip twice: one much
 *  longer than its clip (half again, give or take a frame) is one of them. */
export function doubledCopy(duration: number | null | undefined, clipSeconds: number | undefined): boolean {
  return Boolean(duration && clipSeconds && duration > clipSeconds * 1.5)
}

/** The sources still making videos, in the order they were added. */
export function activeSources(bank: Pick<BatchBank, 'trial'>): TrialSource[] {
  return (bank.trial?.sources ?? []).filter((s) => !s.stopped)
}

/** What the loop is missing to make videos. */
export function trialMissing(bank: Pick<BatchBank, 'trial' | 'reactions'>): string[] {
  const active = activeSources(bank)
  if (active.length === 0) return ['a viral reel']
  const clips = new Set(bank.reactions.map((f) => f.id))
  return active.some((s) => clips.has(s.clip)) ? [] : ['the clean clip']
}

/** The next video of one source: exact words and reworded take turns (his
 *  pick: half and half), each kind the least-made way first, picked at random
 *  among those; once every way of a kind is made it starts over. */
function nextVariant(source: TrialSource, count: number, made: Set<string>, rand: () => number): TrialVariant {
  const wantExact = count % 2 === 0 || source.read.rewordings.length === 0
  for (const exact of wantExact ? [true, false] : [false, true]) {
    const all = variantsOf(source, exact)
    if (all.length === 0) continue
    let fresh = all.filter((v) => !made.has(keyOf(v)))
    if (fresh.length === 0) {
      // Every one made: a new round of this kind.
      for (const v of all) made.delete(keyOf(v))
      fresh = all
    }
    return fresh[Math.floor(rand() * fresh.length) % fresh.length]
  }
  return { sourceId: source.id, wording: 0, place: 0, light: 0 }
}

export interface TrialVideoPlan {
  source: TrialSource
  clip: BankFile
  sound: BankFile | null
  text: string
  look: TrialLook
  variant: TrialVariant
}

/** The loop's next videos, one per slot: the sources take turns (the one
 *  after the last made first), each its next variant. The bank after them
 *  keeps what was made (`made`, `used` per source, `lastPair` the last
 *  source), so the next top-up carries on. */
export function planTrial(
  bank: BatchBank,
  count: number,
  { seed = String(Date.now()), rand = randomFrom(seed) }: { seed?: string; rand?: () => number } = {},
): { plans: TrialVideoPlan[]; made: string[]; used: Record<string, number>; lastPair?: string } {
  const sources = activeSources(bank).filter((s) => bank.reactions.some((f) => f.id === s.clip))
  const made = new Set(bank.made ?? [])
  const used = { ...bank.used }
  let last = bank.lastPair
  const plans: TrialVideoPlan[] = []
  if (sources.length === 0) return { plans, made: [...made], used, lastPair: last }
  for (let n = 0; n < count; n++) {
    const after = sources.findIndex((s) => s.id === last)
    const source = sources[(after + 1) % sources.length]
    const variant = nextVariant(source, used[source.id] ?? 0, made, rand)
    made.add(keyOf(variant))
    used[source.id] = (used[source.id] ?? 0) + 1
    last = source.id
    const place = placesFor(source.read)[variant.place] ?? placesFor(source.read)[0]
    plans.push({
      source,
      clip: bank.reactions.find((f) => f.id === source.clip)!,
      sound: source.sound ? (bank.music.find((f) => f.id === source.sound) ?? null) : null,
      text: wordsOf(source.read, variant.wording),
      variant,
      look: {
        sourceId: source.id,
        style: source.read.style,
        outlineColor: source.read.outlineColor,
        size: source.read.size,
        place,
        brightness: BRIGHTNESS[variant.light + 2],
      },
    })
  }
  return { plans, made: [...made], used, lastPair: last }
}

/** The angle a trial video is made with: its words in the viral reel's look
 *  at the video's place, and no effects - the viral reel had none. */
export function trialAngle(angle: Angle, look: TrialLook): Angle {
  return {
    ...angle,
    headline: {
      ...angle.headline,
      style: look.style,
      outlineColor: look.outlineColor,
      size: look.size,
      place: look.place,
    },
    effects: NO_EFFECTS,
  }
}

/** A trial video's batch line: its day and time, marked a trial. */
export function trialBatch(batch: Omit<JobBatch, 'trial' | 'source'>, source: string): JobBatch {
  return { ...batch, trial: true, source }
}

/** The loop's bank as the accounts allow it: no more a day than Instagram
 *  takes trials (`most`), and stopped with the reason when it takes none on
 *  any of them. The same bank when nothing changed. */
export function withAccounts(bank: BatchBank, trial: TrialAccounts | undefined, accounts: readonly string[]): BatchBank {
  const most = instagramLimit(trial, accounts) ?? undefined
  const blocked = accounts.length > 0 && notAllowedOn(trial, accounts).length === accounts.length
  const problem = blocked ? NOT_ALLOWED : bank.runProblem === NOT_ALLOWED ? undefined : bank.runProblem
  if (bank.most === most && bank.runProblem === problem) return bank
  return { ...bank, most, runProblem: problem }
}

/** Why a loop makes nothing: Instagram won't take trials on its account. */
export const NOT_ALLOWED =
  "Instagram doesn't let this account post Trial Reels yet: it needs to be a public professional account with enough followers, allowed in recommendations (Instagram, Settings, Account status). Nothing is made until a trial goes through."

/** The fewest a day Instagram takes on any of the loop's accounts, as the
 *  posting function learned it (postiz/trial.ts), or null when none was
 *  learned yet. */
export function instagramLimit(
  trial: TrialAccounts | undefined,
  accounts: readonly string[],
): number | null {
  const known = accounts.map((id) => trial?.limits?.[id]?.perDay).filter((n): n is number => typeof n === 'number' && n > 0)
  return known.length > 0 ? Math.min(...known) : null
}

/** The loop's accounts Instagram won't take trials on. */
export function notAllowedOn(trial: TrialAccounts | undefined, accounts: readonly string[]): string[] {
  return accounts.filter((id) => Boolean(trial?.notAllowed?.[id]))
}

/** A new source's id. */
export function sourceId(now = Date.now()): string {
  return `t-${now.toString(36)}`
}

// --- For the Trial reels screen ------------------------------------------------

/** The day a new loop starts at when he hasn't set one: his number
 *  (2026-11-04: "let's say the max is 30 posts a day"). */
export const FIRST_PER_DAY = 30

/** A Trial loop's bank, new: the campaign's, running at `perDay`. */
export function newTrialBank(campaignId: string, angleId: string, perDay = FIRST_PER_DAY): BatchBank {
  return {
    campaignId,
    angleId,
    layout: 'trial',
    reactions: [],
    products: [],
    headlines: [],
    music: [],
    perDay,
    days: 0,
    used: {},
    trial: { sources: [] },
  }
}

/** The bank with a viral reel added (its clean clip and sound kept in the
 *  bank's lists) and running - started now. */
export function withSource(bank: BatchBank, source: TrialSource, clip: BankFile, sound: BankFile | null, now = new Date()): BatchBank {
  return {
    ...bank,
    layout: 'trial',
    reactions: [...bank.reactions.filter((f) => f.id !== clip.id), clip],
    music: sound ? [...bank.music.filter((f) => f.id !== sound.id), sound] : bank.music,
    trial: { sources: [...(bank.trial?.sources ?? []).filter((s) => s.id !== source.id), source] },
    running: true,
    runProblem: undefined,
    startedAt: now.toISOString(),
  }
}

/** The bank with one viral reel stopped, its files let go (`retire`); the
 *  loop stops when none is left. */
export function withoutSource(bank: BatchBank, id: string): { bank: BatchBank; retire: string[] } {
  const sources = bank.trial?.sources ?? []
  const gone = sources.find((s) => s.id === id)
  if (!gone) return { bank, retire: [] }
  const kept = sources.filter((s) => s.id !== id)
  const files = new Set([gone.clip, ...(gone.sound ? [gone.sound] : [])])
  const stillUsed = new Set(kept.flatMap((s) => [s.clip, ...(s.sound ? [s.sound] : [])]))
  const retire = [...files].filter((f) => !stillUsed.has(f))
  const next: BatchBank = {
    ...bank,
    reactions: bank.reactions.filter((f) => !retire.includes(f.id)),
    music: bank.music.filter((f) => !retire.includes(f.id)),
    trial: { sources: kept },
    made: (bank.made ?? []).filter((k) => !k.startsWith(`t:${id}:`)),
    ...(kept.length === 0 ? { running: false } : {}),
  }
  return { bank: next, retire }
}

/** The file name a source's videos go out with (CampaignApp.addBatch), to
 *  tell its posts from the others'. */
export function trialFileName(clip: Pick<BankFile, 'name'>): string {
  return `${clip.name.replace(/\.[^./]+$/, '')} (trial).mp4`
}

/** Which of two picked videos went viral: the one with sound - the clean
 *  clip has none. Null when that can't tell them apart (he is asked). */
export function viralOf<T>(files: readonly { file: T; sound: boolean }[]): { viral: T; clean: T } | null {
  if (files.length !== 2) return null
  const [a, b] = files
  if (a.sound === b.sound) return null
  return a.sound ? { viral: a.file, clean: b.file } : { viral: b.file, clean: a.file }
}

/** How the loop's days look, from its posts: today's out and still to go,
 *  and the trial posts Instagram turned down lately, newest first. */
export function trialDays(
  posts: readonly { campaignId: string; status: string; postAt: string | null; error: string | null; batch?: { date: string; trial?: boolean } | null }[],
  campaignId: string,
  today: string,
): { outToday: number; toGoToday: number; ahead: number; refused: string[] } {
  let outToday = 0
  let toGoToday = 0
  let ahead = 0
  const refused: { at: string; error: string }[] = []
  for (const p of posts) {
    if (p.campaignId !== campaignId || !p.batch?.trial) continue
    if (p.status === 'rejected' || p.status === 'failed') continue
    if (p.status === 'error' && p.error) refused.push({ at: p.postAt ?? '', error: p.error })
    if (p.batch.date === today) {
      if (p.status === 'posted') outToday++
      else if (p.status !== 'error') toGoToday++
    } else if (p.batch.date > today && p.status !== 'error') ahead++
  }
  refused.sort((a, b) => b.at.localeCompare(a.at))
  return { outToday, toGoToday, ahead, refused: [...new Set(refused.map((r) => r.error))].slice(0, 3) }
}
