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
  LEAD_MINUTES,
  addDays,
  combos,
  dayTimes,
  formulaLine,
  formulaText,
  headlinesToMix,
  hookOf,
  mixFrom,
  pickBatch,
  spend,
  todayHere,
  usesSteps,
  type BankFile,
  type BatchBank,
  type BatchSlot,
} from './batch'
import { engineJob, makeOnEngine, saveEngineSeries, sendFootage, stopEngineJob } from './engine'
import { DEFAULT_CORNER } from './greenScreenRender'
import type { Job } from './jobs'
import { NO_POSTING, type Campaign } from './look'
import { BATCH_MAX_PER_DAY, batchTimesOn, listPosts, stackTimesOn, stoppable, stopPostsNow, takenTimes, type CampaignPlace, type ServerPost } from './posting'
import { loadBankFile, type JobBatch } from './store'

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
  batch: JobBatch
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

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
  bank: Pick<BatchBank, 'perDay' | 'filled' | 'madeThrough' | 'lastPerDay'>
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
    const need = bank.perDay - have
    if (need <= 0) continue
    const usable = (times: string[]) => times.filter((t) => date !== today || minutes(t) >= soonest)
    const times = have === 0 ? usable(batchTimesOn(place, campaignId, date, bank.perDay)).slice(0, need) : []
    if (times.length < need) {
      // Every free time first, then an even pick of the ones still ahead.
      const free = usable(stackTimesOn(place, campaignId, date, BATCH_MAX_PER_DAY, [...taken(date), ...times]))
      times.push(...dayTimes(free, need - times.length))
    }
    for (const time of times.sort()) slots.push({ date, time })
  }
  return slots
}

/** What the batch's videos are still missing to be made: a reaction, a
 *  product clip (or one for every step), a headline or both logos. */
export function missingFor(bank: BatchBank): string[] {
  const green = bank.layout === 'greenscreen'
  const onEngine = bank.layout === 'engine'
  const formula = !green && hookOf(bank) === 'formula'
  return [
    bank.reactions.length === 0 ? 'a reaction' : '',
    ...(usesSteps(bank)
      ? bank.steps!.filter((s) => s.files.length === 0).map((s) => `a clip for ${s.name}`)
      : [bank.products.length === 0 ? (green ? 'a background video' : 'a product showcase') : '']),
    green || onEngine ? '' : formula ? (!bank.formula?.left || !bank.formula?.right ? 'both logos' : '') : bank.headlines.length === 0 ? 'a headline' : '',
  ].filter(Boolean)
}

/** How many different videos are left to make, and of how many - Infinity
 *  when there are too many to count. */
export function leftToMake(bank: BatchBank): { total: number; left: number } {
  const green = bank.layout === 'greenscreen'
  return combos(mixFrom(bank, green ? bank.headlines : headlinesToMix(bank)))
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
export function planVideos(
  bank: BatchBank,
  slots: BatchSlot[],
  { id = `b-${Date.now().toString(36)}`, now = new Date(), rand = Math.random }: { id?: string; now?: Date; rand?: () => number } = {},
): { videos: BatchVideo[]; slots: BatchSlot[]; bank: BatchBank; retire: string[] } {
  if (bank.layout === 'engine') return { videos: [], slots, bank: fill(bank, slots, now), retire: [] }
  const green = bank.layout === 'greenscreen'
  const formula = !green && hookOf(bank) === 'formula' ? bank.formula : undefined
  const corner = bank.corner ?? DEFAULT_CORNER
  const mixable = mixFrom(bank, green ? bank.headlines : headlinesToMix(bank))
  const { left } = combos(mixable)
  const taking = Number.isFinite(left) ? slots.slice(0, left) : slots
  if (taking.length === 0) return { videos: [], slots: [], bank, retire: [] }

  const { picks, used, lastPair, made } = pickBatch(mixable, taking.length, rand)
  const byId = (list: BankFile[], fileId: string | null) => list.find((f) => f.id === fileId) ?? null
  const videos: BatchVideo[] = picks.map((pick, i) => {
    const steps = pick.steps && bank.steps ? pick.steps.map((fileId, s) => ({ file: byId(bank.steps![s].files, fileId)!, name: bank.steps![s].name })) : undefined
    const line = formula ? formulaLine(formula, `${id}-${i}`) : ''
    return {
      reaction: byId(bank.reactions, pick.reaction)!,
      product: steps ? steps[0].file : byId(bank.products, pick.product)!,
      ...(steps ? { steps } : {}),
      music: green ? null : byId(bank.music, pick.music),
      ...(green ? { greenScreen: corner } : {}),
      ...(formula
        ? { headline: formulaText(formula, line), formula: { left: formula.left, right: formula.right, line } }
        : { headline: pick.headline }),
      batch: { id, date: taking[i].date, time: taking[i].time, size: taking.length },
    }
  })
  let next = fill({ ...bank, used, lastPair, made }, taking, now)
  let retire: string[] = []
  if (Number.isFinite(left) && taking.length >= left) {
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
export function overfull(bank: Pick<BatchBank, 'perDay' | 'filled' | 'madeThrough' | 'lastPerDay'>, now = new Date()): string[] {
  const today = todayHere(now)
  const dates = new Set(Object.keys(bank.filled ?? {}).filter((d) => d >= today))
  for (let d = 0; d < AHEAD_DAYS; d++) dates.add(addDays(today, d))
  return [...dates].filter((date) => filledOn(bank, date) > bank.perDay).sort()
}

/** Which videos to take out so each day holds no more than his number: the
 *  ones that leave the rest spread evenly through the day, among those that
 *  can still go; and the days' counts after. A day that can't lose enough
 *  (posted already, or being made right now) keeps the rest. */
export function trimPlan(
  bank: Pick<BatchBank, 'perDay' | 'filled' | 'madeThrough' | 'lastPerDay'>,
  videos: readonly DayVideo[],
  now = new Date(),
): { remove: DayVideo[]; filled: Record<string, number> } {
  const today = todayHere(now)
  const filled: Record<string, number> = {}
  for (const [date, n] of Object.entries(bank.filled ?? {})) if (date >= today) filled[date] = n
  const remove: DayVideo[] = []
  for (const date of overfull(bank, now)) {
    const count = filledOn(bank, date)
    const excess = count - bank.perDay
    const day = videos.filter((v) => v.date === date).sort((a, b) => a.time.localeCompare(b.time))
    const keep = new Set<number>()
    for (let i = 0; i < bank.perDay; i++) keep.add(Math.min(day.length - 1, Math.round((i * day.length) / bank.perDay)))
    const going = day.filter((v, i) => v.removable && !keep.has(i)).slice(0, excess)
    // Not enough of those: the latest of the rest that can go.
    for (const v of [...day].reverse()) if (going.length < excess && v.removable && !going.includes(v)) going.push(v)
    remove.push(...going)
    filled[date] = count - going.length
  }
  return { remove, filled }
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
  const posts = await listPosts()
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
