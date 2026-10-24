// A batch that keeps going: he picks how many videos a day and taps Start
// once ("remove the days, just keep videos a day and it will keep going until
// there aren't any more"). The next AHEAD_DAYS days are made straight away;
// every time the Cutter is opened after that, the days still missing are made
// - each day filled up to his number, one already holding some topped up -
// until every different video his footage can make has been made, or he
// stops it. Changing the number works at once, both ways: raising it tops up
// the days already made, lowering it takes the extra videos back out of them
// (never one already posted), and 0 pauses it.
//
// Each day counts what this batch has put on it (BatchBank.filled), kept on
// this phone with the bank: a top-up never waits on the server, and a day is
// never made twice. Batch banks stay on the phone that has the footage, so
// his friend's phone never tops up the same campaign.

import {
  DEFAULT_FORMULA,
  LEAD_MINUTES,
  addDays,
  dayLabel,
  combos,
  formulaLine,
  formulaText,
  headlinesToMix,
  hookOf,
  mixFrom,
  pickBatch,
  spend,
  looksToMix,
  formulaAmounts,
  hasFormula,
  mixPrefixes,
  todayHere,
  unmake,
  usesSteps,
  recastPicks,
  recipeOf,
  stylesOf,
  type BankFile,
  type BatchBank,
  type BatchLook,
  type BatchPick,
  type BatchSlot,
  type RecastFrom,
} from './batch'
import { engineJob, makeOnEngine, saveEngineSeries, sendFootage, stopEngineJob } from './engine'
import { DEFAULT_CORNER } from './greenScreenRender'
import type { Job } from './jobs'
import { NO_POSTING, type Campaign, type HeadlineStyle } from './look'
import { batchTimesOn, listPosts, stackTimesOn, stoppable, stopPostsNow, takenTimes, type CampaignPlace, type ServerPost } from './posting'
import { loadBankFile, type JobBatch } from './store'
import { SERVER_MODE, serverConnected } from './serverFlag'

/** How many days are kept made ahead: a week of posts waiting, so a few days
 *  without opening the app never leave a day empty. */
export const AHEAD_DAYS = 7

/** One batch video, as BatchView and the top-ups hand it to be made. */
export interface BatchVideo {
  reaction: BankFile
  product: BankFile
  music: BankFile | null
  headline: string
  /** The "Claude + X" hook, when the bank uses it: the headline above is then
   *  what it says in words, for the caption. */
  formula?: { left: BankFile | null; right: BankFile | null; line: string }
  /** Green screen: the product behind him, him cut out in this corner. */
  greenScreen?: { side: 'left' | 'right'; sizePct: number }
  /** The product showcase in steps: one clip each, in order, with the
   *  step's name (its words over the clip, batch.stepTitle). */
  steps?: { file: BankFile; name?: string }[]
  /** The headline look it was mixed with, when the batch takes turns
   *  between several (batch.styleFor has the last word when it is made). */
  headlineStyle?: HeadlineStyle
  batch: JobBatch
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** Whole days from `from` to `to` (dates, YYYY-MM-DD). */
function daysFrom(from: string, to: string): number {
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000
  return Math.round(day(to) - day(from))
}

/** How many videos a day the batch makes on `date`: his number, or - while it
 *  grows - his number for `growthFrom` and `growth` more on each day after,
 *  with no most a day ("it's just +1, +1, +1 - there's no limit"). */
export function perDayOn(bank: Pick<BatchBank, 'perDay' | 'growth' | 'growthFrom'>, date: string): number {
  // 0 is paused, growing or not.
  if (!bank.growth || !bank.growthFrom || bank.perDay === 0) return bank.perDay
  return Math.max(0, bank.perDay + bank.growth * Math.max(0, daysFrom(bank.growthFrom, date)))
}

/** The bank with `n` a day from `today` on - his number now, the growth (if
 *  any) going on from it. */
export function withPerDay<T extends Pick<BatchBank, 'perDay' | 'growth' | 'growthFrom'>>(bank: T, n: number, today: string): T {
  return { ...bank, perDay: n, ...(bank.growth ? { growthFrom: today } : {}) }
}

/** The bank growing by `growth` a day from today's number (0: the same every day). */
export function withGrowth<T extends Pick<BatchBank, 'perDay' | 'growth' | 'growthFrom'>>(bank: T, growth: number, today: string): T {
  const now = perDayOn(bank, today)
  return growth > 0 ? { ...bank, perDay: now, growth, growthFrom: today } : { ...bank, perDay: now, growth: undefined, growthFrom: undefined }
}

/** How many days `left` videos last from `today` at the batch's numbers. */
export function daysToMake(bank: Pick<BatchBank, 'perDay' | 'growth' | 'growthFrom'>, left: number, today: string): number {
  let still = left
  let days = 0
  while (still > 0) {
    const n = perDayOn(bank, addDays(today, days))
    if (n <= 0 || days > 3650) return Infinity
    still -= n
    days++
  }
  return days
}

/** While a batch grows each day, in words: today, tomorrow and a week on,
 *  and the first day (in the next two months) the posting window (`fits`:
 *  how many a day it holds) is too small for it. */
export function growthSummary(
  bank: Pick<BatchBank, 'perDay' | 'growth' | 'growthFrom'>,
  today: string,
  fits: (date: string, wanted: number) => number,
): { text: string; tight: boolean } {
  const on = (d: number) => perDayOn(bank, addDays(today, d))
  let tight: { day: number; holds: number } | null = null
  for (let d = 0; d <= 60 && tight === null; d++) {
    const holds = fits(addDays(today, d), on(d))
    if (holds < on(d)) tight = { day: d, holds }
  }
  const text = [
    `Today ${on(0)}, tomorrow ${on(1)}, in a week ${on(7)}.`,
    tight ? ` From ${tight.day === 0 ? 'today' : dayLabel(addDays(today, tight.day))} the posting window only fits ${tight.holds} a day - widen it in the campaign's Posting.` : '',
  ].join('')
  return { text, tight: tight !== null }
}

/** How many videos the batch has put on `date`. A day made before days were
 *  counted holds what the batch that made it made a day. */
export function filledOn(bank: Pick<BatchBank, 'filled' | 'madeThrough' | 'lastPerDay' | 'perDay'>, date: string): number {
  const counted = bank.filled?.[date]
  if (counted !== undefined) return counted
  return bank.madeThrough && date <= bank.madeThrough ? (bank.lastPerDay ?? bank.perDay) : 0
}

/** Where the batch's next videos go: every day from today through
 *  AHEAD_DAYS, up to his number a day - today only at times an hour or more
 *  away. An empty day takes the campaign's own batch times; one already
 *  holding some - or today, its first times gone by - takes more, clear of
 *  the times it has (`taken`). */
export function runSlots({
  bank,
  place,
  campaignId,
  taken = () => [],
  now = new Date(),
}: {
  bank: Pick<BatchBank, 'perDay' | 'filled' | 'madeThrough' | 'lastPerDay' | 'growth' | 'growthFrom'>
  place: CampaignPlace
  campaignId: string
  taken?: (date: string) => readonly string[]
  now?: Date
}): BatchSlot[] {
  const today = todayHere(now)
  const soonest = now.getHours() * 60 + now.getMinutes() + LEAD_MINUTES
  const slots: BatchSlot[] = []
  for (let d = 0; d < AHEAD_DAYS; d++) {
    const date = addDays(today, d)
    const have = filledOn(bank, date)
    const wanted = perDayOn(bank, date)
    const need = wanted - have
    if (need <= 0) continue
    const ahead = (t: string) => date !== today || minutes(t) >= soonest
    const times = have === 0 ? batchTimesOn(place, campaignId, date, wanted).filter(ahead).slice(0, need) : []
    // The rest clear of the times the day holds, spread over what is left of it.
    if (times.length < need) times.push(...stackTimesOn(place, campaignId, date, need - times.length, [...taken(date), ...times], ahead))
    for (const time of times.sort()) slots.push({ date, time })
  }
  return slots
}

/** What the batch's videos are still missing to be made: a reaction, a
 *  product clip (or one for every step), a headline or both logos. */
export function missingFor(bank: BatchBank): string[] {
  const green = bank.layout === 'greenscreen'
  const onEngine = bank.layout === 'engine'
  const formulaOnly = !green && hookOf(bank) === 'formula'
  const formula = !green && !onEngine && hasFormula(bank)
  return [
    bank.reactions.length === 0 ? 'a reaction' : '',
    ...(usesSteps(bank)
      ? bank.steps!.filter((s) => s.files.length === 0).map((s) => `a clip for ${s.name}`)
      : [bank.products.length === 0 ? (green ? 'a background video' : 'a product showcase') : '']),
    green || onEngine || formulaOnly || bank.headlines.length > 0 ? '' : 'a headline',
    formula && (!bank.formula?.left || !bank.formula?.right) ? 'both logos' : '',
  ].filter(Boolean)
}

/** How many different videos are left to make, and of how many - Infinity
 *  when there are too many to count. */
export function leftToMake(bank: BatchBank): { total: number; left: number } {
  const green = bank.layout === 'greenscreen'
  return combos(mixFrom(bank, green ? bank.headlines : headlinesToMix(bank)))
}

/** What the bank's different videos multiply out of, the way leftToMake
 *  counts them: "3 reactions × 4 product showcases × 5 headlines × 3
 *  headline looks". Songs and looks only when there is more than one. */
export function variationParts(bank: BatchBank): string[] {
  const green = bank.layout === 'greenscreen'
  const headlines = green || hookOf(bank) !== 'formula' ? bank.headlines : []
  const looks = looksToMix(mixFrom(bank, headlines))
  const styles = looks.filter((l) => l.look !== 'formula').length
  const amounts = looks.some((l) => l.look === 'formula') ? formulaAmounts(bank.formula ?? DEFAULT_FORMULA).length : 0
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`
  // Claude + X taking turns: its amounts are hooks next to the headlines.
  const hooks = amounts
    ? [
        `${n(styles * headlines.length + amounts, 'hook')} (${[
          styles ? `${n(headlines.length, 'headline')}${styles > 1 ? ` in ${styles} looks` : ''}` : '',
          `${n(amounts, 'Claude + X amount')}`,
        ]
          .filter(Boolean)
          .join(' + ')})`,
      ]
    : [...(headlines.length > 0 ? [n(headlines.length, 'headline')] : []), ...(styles > 1 ? [n(styles, 'headline look')] : [])]
  return [
    n(bank.reactions.length, 'reaction'),
    ...(usesSteps(bank)
      ? bank.steps!.map((step) => `${n(step.files.length, 'clip')} for ${step.name}`)
      : [n(bank.products.length, green ? 'background video' : 'product showcase')]),
    ...(!green && bank.music.length > 1 ? [n(bank.music.length, 'song')] : []),
    ...hooks,
  ]
}

/** Counts `slots` into the bank's days, forgetting days gone by. Days made
 *  before days were counted keep their count from `lastPerDay`, left as it
 *  was. */
function fill(bank: BatchBank, slots: readonly BatchSlot[], now: Date): BatchBank {
  const today = todayHere(now)
  const filled: Record<string, number> = {}
  for (const [date, n] of Object.entries(bank.filled ?? {})) if (date >= today) filled[date] = n
  for (const slot of slots) filled[slot.date] = filledOn({ ...bank, filled }, slot.date) + 1
  const last = slots.reduce((max, s) => (s.date > max ? s.date : max), bank.madeThrough ?? '')
  return { ...bank, filled, madeThrough: last || undefined }
}

/** The batch's next videos, for `slots` (runSlots), mixed from the bank, and
 *  the bank after them. Never more than the different videos left; when that
 *  was the last of them, the footage goes (batch.spend) and the batch stops.
 *  On the engine it only counts the days - the engine does its own mixing. */
/** One batch video from a pick, for its day and time. */
function videoOf(bank: BatchBank, pick: BatchPick, slot: BatchSlot, { id, seed, size, ending }: { id: string; seed: string; size: number; ending: boolean }): BatchVideo {
  const green = bank.layout === 'greenscreen'
  const formulaOnly = !green && hookOf(bank) === 'formula'
  const formula = !green && hasFormula(bank) ? (bank.formula ?? DEFAULT_FORMULA) : undefined
  const byId = (list: BankFile[], fileId: string | null) => list.find((f) => f.id === fileId) ?? null
  const steps = pick.steps && bank.steps ? pick.steps.map((fileId, s) => ({ file: byId(bank.steps![s].files, fileId)!, name: bank.steps![s].name })) : undefined
  // Claude + X: every video, or those it takes turns on - at their amount.
  const onFormula = formula && (formulaOnly || pick.look === 'formula') ? formula : undefined
  const line = onFormula ? formulaLine(onFormula, seed, pick.amount) : ''
  // Its look, always - the one it was mixed with, or the bank's one look -
  // so how each look does can be told, and its videos changed later.
  const style = pick.look && pick.look !== 'formula' ? pick.look : onFormula ? undefined : stylesOf(bank)[0]
  return {
    reaction: byId(bank.reactions, pick.reaction)!,
    product: steps ? steps[0].file : byId(bank.products, pick.product)!,
    ...(steps ? { steps } : {}),
    music: green ? null : byId(bank.music, pick.music),
    ...(green ? { greenScreen: bank.corner ?? DEFAULT_CORNER } : {}),
    ...(onFormula
      ? { headline: formulaText(onFormula, line), formula: { left: onFormula.left, right: onFormula.right, line } }
      : { headline: pick.headline }),
    ...(style ? { headlineStyle: style } : {}),
    batch: { id, date: slot.date, time: slot.time, size, ...(ending ? { last: true as const } : {}) },
  }
}

export function planVideos(
  bank: BatchBank,
  slots: BatchSlot[],
  { id = `b-${Date.now().toString(36)}`, now = new Date(), rand = Math.random }: { id?: string; now?: Date; rand?: () => number } = {},
): { videos: BatchVideo[]; slots: BatchSlot[]; bank: BatchBank; retire: string[] } {
  if (bank.layout === 'engine') return { videos: [], slots, bank: fill(bank, slots, now), retire: [] }
  const green = bank.layout === 'greenscreen'
  const mixable = mixFrom(bank, green ? bank.headlines : headlinesToMix(bank))
  const { left } = combos(mixable)
  const taking = Number.isFinite(left) ? slots.slice(0, left) : slots
  if (taking.length === 0) return { videos: [], slots: [], bank, retire: [] }

  const { picks, used, lastPair, made } = pickBatch(mixable, taking.length, rand)
  // That is every different video left: the footage goes after these.
  const ending = Number.isFinite(left) && taking.length >= left
  const videos = picks.map((pick, i) => videoOf(bank, pick, taking[i], { id, seed: `${id}-${i}`, size: taking.length, ending }))
  let next = fill({ ...bank, used, lastPair, made }, taking, now)
  let retire: string[] = []
  if (ending) {
    // That was every different video: the footage goes, for new filming.
    ;({ bank: next, retired: retire } = spend(next, next.madeThrough ?? todayHere(now)))
    next = { ...next, running: false }
  }
  return { videos, slots: taking, bank: next, retire }
}

/** Top-ups running now, by campaign: the Batch tab and the app's own
 *  top-up never make the same days at once. */
const busy = new Map<string, Promise<unknown>>()

/** Runs `work` for the campaign unless a top-up for it is running already;
 *  resolves once it is done. */
export function oneAtATime<T>(campaignId: string, work: () => Promise<T>): Promise<T | null> {
  if (busy.has(campaignId)) return Promise.resolve(null)
  const running = work().finally(() => busy.delete(campaignId))
  busy.set(campaignId, running)
  return running
}

/** Runs `work` for the campaign after any top-up of it that is running -
 *  never instead of it, never dropped: a change he taps while the batch is
 *  making waits its turn (a top-up only plans, so the wait is short). */
export async function nextInLine<T>(campaignId: string, work: () => Promise<T>): Promise<T> {
  while (busy.has(campaignId)) await settled(campaignId)
  const running = work().finally(() => busy.delete(campaignId))
  busy.set(campaignId, running)
  return running
}

/** Waits for a top-up of the campaign that is running, if any. */
export async function settled(campaignId: string): Promise<void> {
  await busy.get(campaignId)?.catch(() => {})
}

export function isToppingUp(campaignId: string): boolean {
  return busy.has(campaignId)
}

/** The times a campaign's days already hold: its posts on the server, and
 *  its batch videos still being made on this phone. */
export function takenBy(posts: readonly ServerPost[], jobs: readonly Job[], campaignId: string): (date: string) => string[] {
  const taken = takenTimes(posts, campaignId)
  for (const job of jobs) {
    if (job.campaignId !== campaignId || !job.batch) continue
    const day = taken.get(job.batch.date) ?? []
    if (!day.includes(job.batch.time)) taken.set(job.batch.date, [...day, job.batch.time])
  }
  return (date) => taken.get(date) ?? []
}

/** Makes the days the batch is missing, if it is running and has what its
 *  videos need: on this phone (`make` queues them) or handed to the engine.
 *  The bank is saved before the videos are queued, so a day is never made
 *  twice; a top-up that fails says why in the bank (runProblem) and is tried
 *  again next time. Returns the bank after, or null when nothing was due.
 *  `latest` gives the bank as it is now, for an engine hand-over he may have
 *  edited the bank during. */
export async function topUp({
  bank,
  campaign,
  place,
  profileId,
  taken,
  save,
  make,
  say = () => {},
  latest = () => bank,
  now = new Date(),
}: {
  bank: BatchBank
  campaign: Pick<Campaign, 'id' | 'name' | 'posting'>
  place: CampaignPlace
  profileId: string
  taken?: (date: string) => readonly string[]
  save: (bank: BatchBank) => Promise<void>
  make: (videos: BatchVideo[], retire: string[]) => void
  say?: (line: string | null) => void
  latest?: () => BatchBank
  now?: Date
}): Promise<BatchBank | null> {
  // Moved to the Cutter server, or about to be: made there (serverLink.ts,
  // serverMode.ts), never here too.
  if (!SERVER_MODE && (bank.where === 'server' || (serverConnected() && bank.layout !== 'engine'))) return null
  if (!bank.running || missingFor(bank).length > 0) return null
  const slots = runSlots({ bank, place, campaignId: campaign.id, taken, now })
  if (slots.length === 0) return null
  const id = `b-${now.getTime().toString(36)}`
  const plan = planVideos(bank, slots, { id, now })

  if (bank.layout !== 'engine') {
    if (plan.slots.length === 0) return null
    const next = { ...plan.bank, runProblem: undefined }
    await save(next)
    make(plan.videos, plan.retire)
    return next
  }

  try {
    await saveEngineSeries(campaign.id, { name: campaign.name, hooks: bank.headlines })
    await sendFootage(campaign.id, bank, (file) => loadBankFile(file as BankFile), say)
    say('Handing the next days to the engine…')
    const job = await makeOnEngine({
      campaign: { id: campaign.id, name: campaign.name, posting: campaign.posting ?? NO_POSTING },
      profile: profileId,
      batchId: id,
      slots: plan.slots,
    })
    const next = { ...latest(), filled: plan.bank.filled, madeThrough: plan.bank.madeThrough, engineJob: job.id, runProblem: undefined }
    await save(next)
    return next
  } catch (error) {
    const next = { ...latest(), runProblem: error instanceof Error ? error.message : String(error) }
    await save(next)
    return next
  } finally {
    say(null)
  }
}

/** One of the batch's videos on a day still to come: being made on this
 *  phone (a job) or on the server (a post), and whether it can still be
 *  taken out - not once it is posted, nor while this phone is making it. */
export interface DayVideo {
  kind: 'job' | 'post'
  id: string
  date: string
  time: string
  removable: boolean
  post?: ServerPost
}

/** Jobs that can go without stopping anything: not started, or stuck. */
const UNSTARTED = new Set(['queued', 'held', 'failed'])

/** The campaign's batch videos from today on: its posts on the server, and
 *  the jobs on this phone not sent yet. */
export function dayVideos(posts: readonly ServerPost[], jobs: readonly Job[], campaignId: string, now = new Date()): DayVideo[] {
  const today = todayHere(now)
  const out: DayVideo[] = []
  const sent = new Set<string>()
  for (const post of posts) {
    if (post.campaignId !== campaignId || !post.batch || post.batch.date < today) continue
    if (post.status === 'rejected' || post.status === 'failed') continue
    sent.add(post.key)
    const removable = stoppable([post], now.getTime()).length > 0
    out.push({ kind: 'post', id: post.id, date: post.batch.date, time: post.batch.time, removable, post })
  }
  for (const job of jobs) {
    if (job.campaignId !== campaignId || !job.batch || job.batch.date < today || sent.has(job.id)) continue
    out.push({ kind: 'job', id: job.id, date: job.batch.date, time: job.batch.time, removable: UNSTARTED.has(job.status) })
  }
  return out
}

/** The days holding more than his number, from today on. */
export function overfull(bank: Pick<BatchBank, 'perDay' | 'filled' | 'madeThrough' | 'lastPerDay' | 'growth' | 'growthFrom'>, now = new Date()): string[] {
  const today = todayHere(now)
  const dates = new Set(Object.keys(bank.filled ?? {}).filter((d) => d >= today))
  for (let d = 0; d < AHEAD_DAYS; d++) dates.add(addDays(today, d))
  return [...dates].filter((date) => filledOn(bank, date) > perDayOn(bank, date)).sort()
}

/** Which videos to take out so each day holds no more than his number: the
 *  ones that leave the rest spread evenly through the day, among those that
 *  can still go; and the days' counts after. A day that can't lose enough
 *  (posted already, or being made right now) keeps the rest. */
export function trimPlan(
  bank: Pick<BatchBank, 'perDay' | 'filled' | 'madeThrough' | 'lastPerDay' | 'growth' | 'growthFrom'>,
  videos: readonly DayVideo[],
  now = new Date(),
): { remove: DayVideo[]; filled: Record<string, number> } {
  const today = todayHere(now)
  const filled: Record<string, number> = {}
  for (const [date, n] of Object.entries(bank.filled ?? {})) if (date >= today) filled[date] = n
  const remove: DayVideo[] = []
  for (const date of overfull(bank, now)) {
    const count = filledOn(bank, date)
    const wanted = perDayOn(bank, date)
    const excess = count - wanted
    const day = videos.filter((v) => v.date === date).sort((a, b) => a.time.localeCompare(b.time))
    const keep = new Set<number>()
    for (let i = 0; i < wanted; i++) keep.add(Math.min(day.length - 1, Math.round((i * day.length) / wanted)))
    const going = day.filter((v, i) => v.removable && !keep.has(i)).slice(0, excess)
    // Not enough of those: the latest of the rest that can go.
    for (const v of [...day].reverse()) if (going.length < excess && v.removable && !going.includes(v)) going.push(v)
    remove.push(...going)
    filled[date] = count - going.length
  }
  return { remove, filled }
}

/** Starting the batch over (after he changed how its videos look): every
 *  video of it not out yet comes out - jobs not started dropped, posts not
 *  out stopped, the way Posts stops them - and their mixes can be made again,
 *  with whatever he has set now. A mix that matches a video posted or still
 *  going out is never made again. The days are counted again from what is
 *  left and the batch stops, his clips, headlines and songs kept, for him to
 *  tap Start. */
export async function startOver({
  bank,
  campaignId,
  jobs,
  removeJob,
  save,
  latest = () => bank,
}: {
  bank: BatchBank
  campaignId: string
  jobs: readonly Job[]
  removeJob: (id: string) => void
  save: (bank: BatchBank) => Promise<void>
  latest?: () => BatchBank
}): Promise<{ bank: BatchBank; taken: number; failed: number; reason?: string; posts: ServerPost[] }> {
  if (bank.layout === 'engine' && bank.engineJob) {
    const job = await engineJob(bank.engineJob).catch(() => null)
    if (job && (job.status === 'waiting' || job.status === 'making')) await stopEngineJob(bank.engineJob)
  }
  const posts = await listPosts(true)
  const videos = dayVideos(posts, jobs, campaignId)
  const going = videos.filter((v) => v.removable)
  for (const v of going) if (v.kind === 'job') removeJob(v.id)
  const outcome = await stopPostsNow(going.flatMap((v) => (v.post ? [v.post] : [])))
  const stuck = new Set(outcome.failed.map((f) => f.post.id))
  const gone = going.filter((v) => !(v.post && stuck.has(v.post.id)))
  const goneIds = new Set(gone.map((v) => v.id))
  const current = latest()
  const prefixes = (fileName: string | null, headline: string | null) => (fileName ? mixPrefixes(current, fileName, headline ?? '') : [])
  const ofVideo = (v: DayVideo) => {
    const job = v.kind === 'job' ? jobs.find((j) => j.id === v.id) : undefined
    return v.post ? prefixes(v.post.fileName, v.post.headline) : job ? prefixes(job.name, job.headlineText) : []
  }
  // Out there still: posted, going out, or couldn't be stopped.
  const kept = [
    ...posts
      .filter((p) => p.campaignId === campaignId && p.batch && p.status !== 'rejected' && p.status !== 'failed' && !goneIds.has(p.id))
      .flatMap((p) => prefixes(p.fileName, p.headline)),
    ...videos.filter((v) => !goneIds.has(v.id) && v.kind === 'job').flatMap(ofVideo),
  ]
  const next: BatchBank = {
    ...current,
    made: unmake(current.made ?? [], gone.flatMap(ofVideo), kept),
    filled: countedDays(videos.filter((v) => !goneIds.has(v.id))),
    madeThrough: undefined,
    lastPerDay: undefined,
    running: false,
    runProblem: undefined,
  }
  await save(next)
  return { bank: next, taken: gone.length, failed: outcome.failed.length, reason: outcome.failed[0]?.reason, posts }
}

/** Taking one hook's videos out - a headline that does badly, or Claude + X
 *  - while the batch keeps going: its videos not out yet come out (jobs
 *  not started dropped, posts not out stopped), their mixes can be made
 *  again, the days are counted again from what is left, and the bank is
 *  changed as asked (`change`: the hook dropped, or its words changed) so
 *  the next top-up fills those days with the other hooks. Posted videos
 *  and ones being made stay. */
export async function takeOutHook({
  bank,
  campaignId,
  jobs,
  matches,
  change,
  removeJob,
  save,
  latest = () => bank,
}: {
  bank: BatchBank
  campaignId: string
  jobs: readonly Job[]
  /** Whether a video (a post, or a job here) has the hook. */
  matches: (video: { post?: ServerPost; job?: Job }) => boolean
  /** The bank as it should be once they are out. */
  change: (bank: BatchBank) => BatchBank
  removeJob: (id: string) => void
  save: (bank: BatchBank) => Promise<void>
  latest?: () => BatchBank
}): Promise<{
  bank: BatchBank
  taken: number
  failed: number
  reason?: string
  posts: ServerPost[]
  gone: { date: string; time: string; post?: ServerPost; job?: Job }[]
  /** Videos with the hook being made right now: they are finished as they are. */
  making: number
}> {
  const posts = await listPosts(true)
  const videos = dayVideos(posts, jobs, campaignId)
  const jobOf = (v: DayVideo) => (v.kind === 'job' ? jobs.find((j) => j.id === v.id) : undefined)
  const withHook = videos.filter((v) => matches({ post: v.post, job: jobOf(v) }))
  const going = withHook.filter((v) => v.removable)
  const making = withHook.filter((v) => v.kind === 'job' && !v.removable).length
  for (const v of going) if (v.kind === 'job') removeJob(v.id)
  const outcome = await stopPostsNow(going.flatMap((v) => (v.post ? [v.post] : [])))
  const stuck = new Set(outcome.failed.map((f) => f.post.id))
  const gone = going.filter((v) => !(v.post && stuck.has(v.post.id)))
  const goneIds = new Set(gone.map((v) => v.id))
  const current = latest()
  const prefixes = (fileName: string | null, headline: string | null) => (fileName ? mixPrefixes(current, fileName, headline ?? '') : [])
  const ofVideo = (v: DayVideo) => {
    const job = jobOf(v)
    return v.post ? prefixes(v.post.fileName, v.post.headline) : job ? prefixes(job.name, job.headlineText) : []
  }
  const kept = [
    ...posts
      .filter((p) => p.campaignId === campaignId && p.batch && p.status !== 'rejected' && p.status !== 'failed' && !goneIds.has(p.id))
      .flatMap((p) => prefixes(p.fileName, p.headline)),
    ...videos.filter((v) => !goneIds.has(v.id) && v.kind === 'job').flatMap(ofVideo),
  ]
  const next = change({
    ...current,
    made: unmake(current.made ?? [], gone.flatMap(ofVideo), kept),
    filled: countedDays(videos.filter((v) => !goneIds.has(v.id))),
  })
  await save(next)
  return {
    bank: next,
    taken: gone.length,
    failed: outcome.failed.length,
    reason: outcome.failed[0]?.reason,
    posts,
    gone: gone.map((v) => ({ date: v.date, time: v.time, post: v.post, job: jobOf(v) })),
    making,
  }
}

/** What a video taken out was made of, to make it again (changeLook): a job
 *  here knows its clips and song; a post is read off its file name. */
function recipeOfGone(bank: BatchBank, video: { post?: ServerPost; job?: Job }, formula: boolean): RecastFrom | null {
  const made = video.job?.montage?.bank
  if (made) {
    return {
      reaction: made.reaction.id,
      products: made.steps ? made.steps.map((s) => s.file.id) : [made.product.id],
      music: made.music?.id ?? null,
      headline: formula ? '' : (video.job?.headlineText ?? ''),
    }
  }
  const post = video.post
  return post?.fileName ? recipeOf(bank, post.fileName, formula ? '' : (post.headline ?? '')) : null
}

/**
 * One look's videos not out yet made again in another look ("Claude + X
 * doesn't work - change those to Snapchat"): they come out the way Stop
 * using it takes them out (takeOutHook), the look leaves the mix with its
 * share going to the new one (`change`), and each is made again at once at
 * its own day and time - the same reaction and clips, in the new look
 * (batch.recastPicks). Every other video stays as it is. A time too soon to
 * make it for, or one whose clips have left the bank, is left to the
 * batch's top-up. Returns what takeOutHook does, and how many were made again.
 */
export async function changeLook({
  bank,
  campaignId,
  jobs,
  matches,
  from,
  to,
  change,
  removeJob,
  save,
  make,
  latest = () => bank,
  now = new Date(),
  rand = Math.random,
}: {
  bank: BatchBank
  campaignId: string
  jobs: readonly Job[]
  matches: (video: { post?: ServerPost; job?: Job }) => boolean
  from: BatchLook
  to: BatchLook
  change: (bank: BatchBank) => BatchBank
  removeJob: (id: string) => void
  save: (bank: BatchBank) => Promise<void>
  make: (videos: BatchVideo[]) => void
  latest?: () => BatchBank
  now?: Date
  rand?: () => number
}): Promise<Awaited<ReturnType<typeof takeOutHook>> & { remade: number }> {
  const out = await takeOutHook({ bank, campaignId, jobs, matches, change, removeJob, save, latest })
  const today = todayHere(now)
  const soonest = now.getHours() * 60 + now.getMinutes() + LEAD_MINUTES
  const later = out.gone
    .filter((v) => v.date > today || (v.date === today && minutes(v.time) >= soonest))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  const current = out.bank
  const recipes = later.map((v) => recipeOfGone(current, v, from === 'formula'))
  const asked = recipes.flatMap((r, i) => (r ? [{ recipe: r, slot: { date: later[i].date, time: later[i].time } }] : []))
  const { picks, used, made } = recastPicks(
    current,
    asked.map((a) => a.recipe),
    to,
    rand,
  )
  const id = `b-${now.getTime().toString(36)}`
  const ready = asked.flatMap((a, i) => (picks[i] ? [{ pick: picks[i]!, slot: a.slot }] : []))
  const videos = ready.map(({ pick, slot }, i) => videoOf(current, pick, slot, { id, seed: `${id}-${i}`, size: ready.length, ending: false }))
  if (videos.length === 0) return { ...out, remade: 0 }
  const filled = { ...current.filled }
  for (const { slot } of ready) filled[slot.date] = (filled[slot.date] ?? 0) + 1
  const next = { ...current, used, made, filled }
  await save(next)
  make(videos)
  return { ...out, bank: next, remade: videos.length }
}

/** A batch changing hands between this phone and the Cutter server
 *  (serverLink.ts, serverMode.ts): the videos this side has queued and not
 *  started are dropped - the other side makes them, their mixes freed for it
 *  - and the days are counted from what is really there: the posts, and the
 *  videos this side is still making. */
export function handOver({
  bank,
  campaignId,
  jobs,
  posts,
  removeJob,
  now = new Date(),
}: {
  bank: BatchBank
  campaignId: string
  jobs: readonly Job[]
  posts: readonly ServerPost[]
  removeJob: (id: string) => void
  now?: Date
}): BatchBank {
  const videos = dayVideos(posts, jobs, campaignId, now)
  const gone = videos.filter((v) => v.kind === 'job' && v.removable)
  for (const v of gone) removeJob(v.id)
  const goneIds = new Set(gone.map((v) => v.id))
  const prefixes = (fileName: string | null, headline: string | null) => (fileName ? mixPrefixes(bank, fileName, headline ?? '') : [])
  const ofJob = (id: string) => {
    const job = jobs.find((j) => j.id === id)
    return job ? prefixes(job.name, job.headlineText) : []
  }
  const kept = [
    ...posts
      .filter((p) => p.campaignId === campaignId && p.batch && p.status !== 'rejected' && p.status !== 'failed')
      .flatMap((p) => prefixes(p.fileName, p.headline)),
    ...videos.filter((v) => v.kind === 'job' && !goneIds.has(v.id)).flatMap((v) => ofJob(v.id)),
  ]
  return {
    ...bank,
    made: unmake(bank.made ?? [], gone.flatMap((v) => ofJob(v.id)), kept),
    filled: countedDays(videos.filter((v) => !goneIds.has(v.id)), now),
    madeThrough: undefined,
    lastPerDay: undefined,
  }
}

/** Stop: nothing more of the batch is made on this phone - no more top-ups,
 *  and its videos waiting to be made (queued, not started) are dropped, their
 *  mixes freed and the days counted again from what is left, the way a
 *  hand-over does it. What is made stays: the posts in Posts keep their
 *  times, and a video being made right now is finished. Before this, Stop
 *  only stopped the next top-up, and the days already queued - dozens of
 *  videos - went on being made one after another. */
export function stopBatch(args: Parameters<typeof handOver>[0]): BatchBank {
  return { ...handOver(args), running: false }
}

/** The days from today on as they really are: how many of the batch's
 *  videos each holds now - for after the engine was stopped partway, when
 *  the days it hadn't reached hold fewer than were handed to it. */
export function countedDays(videos: readonly DayVideo[], now = new Date()): Record<string, number> {
  const today = todayHere(now)
  const filled: Record<string, number> = {}
  for (let d = 0; d < AHEAD_DAYS; d++) filled[addDays(today, d)] = 0
  for (const v of videos) if (v.date >= today) filled[v.date] = (filled[v.date] ?? 0) + 1
  return filled
}

/** Takes the extra videos back out of the days ahead after the number was
 *  lowered (trimPlan): jobs not started are dropped (`removeJob`), posts not
 *  out yet are stopped, the way Posts stops them. On the engine, a batch it
 *  is still making for those days is stopped first - it would put them back
 *  - and the days count what it has really sent. Saves the bank's days and
 *  returns it, with how many couldn't be taken out and why, and the posts as
 *  the server had them. */
export async function trimDown({
  bank,
  campaignId,
  jobs,
  removeJob,
  save,
  latest = () => bank,
}: {
  bank: BatchBank
  campaignId: string
  jobs: readonly Job[]
  removeJob: (id: string) => void
  save: (bank: BatchBank) => Promise<void>
  latest?: () => BatchBank
}): Promise<{ bank: BatchBank; failed: number; reason?: string; posts: ServerPost[] }> {
  let stoppedEngine = false
  if (bank.layout === 'engine' && bank.engineJob) {
    const job = await engineJob(bank.engineJob).catch(() => null)
    if (job && (job.status === 'waiting' || job.status === 'making')) {
      await stopEngineJob(bank.engineJob)
      stoppedEngine = true
    }
  }
  const posts = await listPosts(true)
  const videos = dayVideos(posts, jobs, campaignId)
  const plan = trimPlan(stoppedEngine ? { ...bank, filled: countedDays(videos) } : bank, videos)
  for (const v of plan.remove) if (v.kind === 'job') removeJob(v.id)
  const outcome = await stopPostsNow(plan.remove.flatMap((v) => (v.post ? [v.post] : [])))
  const filled = { ...plan.filled }
  for (const { post } of outcome.failed) if (post.batch) filled[post.batch.date] = (filled[post.batch.date] ?? 0) + 1
  const next = { ...latest(), filled }
  await save(next)
  return { bank: next, failed: outcome.failed.length, reason: outcome.failed[0]?.reason, posts }
}
