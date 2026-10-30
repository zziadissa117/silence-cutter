// A video that went out to some of its accounts and not others: which ones
// failed, how each account is named on the post (two accounts can share a
// name - "Ilyan Hamdane" on YouTube and on Instagram), and what the post says.

import { addDays, localDate, localTime, zoned } from './slots.ts'

export interface FailedAccount {
  id: string
  name: string
  platform: string
}

export interface PostizRef {
  postId: string
  integration: string
  /** When this one goes, when not at the post's own time (a YouTube copy
   *  moved to YouTube's new day, youtubeTime). */
  at?: string
}

export interface PostizState {
  id: string
  state?: string
  integration?: { id?: string; providerIdentifier?: string; name?: string }
}

const PLATFORMS: Record<string, string> = {
  'instagram-standalone': 'Instagram',
  instagram: 'Instagram',
  'tiktok-business': 'TikTok',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
}

/** "Instagram" for "instagram-standalone"; an unknown one as it is. */
export function platformWord(platform: string | undefined): string {
  if (!platform) return ''
  return PLATFORMS[platform] ?? platform
}

/** How an account is named on its post: its name, with the platform added
 *  when another account on the same post has that name too. */
export function accountName(name: string, platform: string | undefined, accounts: FailedAccount[]): string {
  const twins = accounts.filter((a) => a.name === name).length
  return twins > 1 && platform ? `${name} (${platformWord(platform)})` : name
}

/** The post's Postiz posts that Postiz says failed. */
export function failedRefs(ids: PostizRef[], found: PostizState[]): PostizRef[] {
  const byId = new Map(found.map((p) => [p.id, p]))
  return ids.filter((ref) => byId.get(ref.postId)?.state === 'ERROR')
}

/** "Not posted to Jake (Instagram)." - each failed account by its name on the post. */
export function notPostedNote(errored: PostizState[], accounts: FailedAccount[]): string {
  const names = errored.map((p) => {
    const account = accounts.find((a) => a.id === p.integration?.id)
    const name = account?.name ?? p.integration?.name ?? 'an account'
    return accountName(name, account?.platform ?? p.integration?.providerIdentifier, accounts)
  })
  return `Not posted to ${[...new Set(names)].join(', ')}.`
}

/** An account as Postiz lists it now. */
export interface ConnectedAccount {
  id: string
  name: string
  platform: string
  profile: string
  disabled: boolean
  /** Postiz says it must be reconnected before it can post. */
  refreshNeeded?: boolean
}

/** The post's accounts to post to again: the ones Postiz says failed, and the
 *  ones its note names whose Postiz post is gone altogether - disconnecting
 *  an account in Postiz takes its posts with it, and he disconnects and
 *  reconnects a YouTube account that won't post before tapping again. */
export function missingAccounts<T extends FailedAccount & { held?: unknown }>(
  accounts: readonly T[],
  ids: readonly PostizRef[],
  found: readonly PostizState[],
  note: string,
): T[] {
  const failed = failedRefs([...ids], [...found])
  const there = new Set(found.map((p) => p.id))
  const all: FailedAccount[] = [...accounts]
  const named = namesIn(note)
  return accounts.filter(
    (a) =>
      !a.held &&
      (failed.some((ref) => ref.integration === a.id) ||
        ids.some((ref) => ref.integration === a.id && !there.has(ref.postId) && named.has(accountName(a.name, a.platform, all)))),
  )
}

/** The accounts a post's note names: "Not posted to A, B (YouTube)." and the
 *  ways Postiz or Buffer failing say it. */
export function namesIn(note: string): Set<string> {
  const m = note.match(/^(?:Not posted to|Postiz couldn't publish it to|Buffer couldn't post it to) (.+?)(?: \(Buffer couldn't\))?\.(?: |$)/)
  return new Set(m ? m[1].split(', ') : [])
}

/** Where to post to an account again: itself while Postiz still has it
 *  connected; once he has disconnected and reconnected it, Postiz gives it a
 *  new id - the one connected account of the same platform and username (its
 *  name when the username isn't known). Null when there is none, or more
 *  than one. */
export function reconnectedAs<T extends ConnectedAccount>(account: FailedAccount & { profile?: string }, now: readonly T[]): T | null {
  const live = now.filter((c) => !c.disabled)
  const same = live.find((c) => c.id === account.id)
  if (same) return same
  const like = live.filter((c) => c.platform === account.platform && (account.profile ? c.profile === account.profile : c.name === account.name))
  return like.length === 1 ? like[0] : null
}

/** YouTube's daily upload limit starts again at midnight in California: its
 *  uploads fail through the evening there (2026-10-29: of 14 days' YouTube
 *  posts, nearly none failed from 7 AM to 3 PM Pacific and half to all from
 *  4 PM to midnight), and go again after it. */
export const YOUTUBE_DAY_TZ = 'America/Los_Angeles'

/** A post's note without what was added about posting it again, so the
 *  accounts it names (namesIn) stay first. */
export function baseNote(note: string): string {
  return note.replace(/ (Posting again|Still not posted)\b.*$/s, '')
}

/** From this hour in California on, YouTube uploads through Postiz fail:
 *  its daily limit is used up ("YouTube's daily upload quota is exhausted
 *  for today", his posts every evening of 2026-10-25..30). */
export const YOUTUBE_FULL_FROM = 15

/** YouTube copies moved off the evening go the next day in this part of
 *  California's morning and midday (8 AM to 4 PM in Toronto): his audience
 *  is awake, and YouTube's day still has room. His words (2026-10-30):
 *  "separate them throughout the day ... only the ones on YouTube". */
export const YOUTUBE_DAY_FROM = 5
export const YOUTUBE_DAY_TO = 13

/** When a post's YouTube copy goes: at the post's own time while YouTube's
 *  day still has room (before 3 PM in California); otherwise the next day,
 *  the evening's 9 hours laid over the 8 good hours (5 AM to 1 PM there), so
 *  they keep their order and spacing. */
export function youtubeTime(at: number): number {
  const day = localDate(new Date(at), YOUTUBE_DAY_TZ)
  const hour = Number(localTime(new Date(at), YOUTUBE_DAY_TZ).slice(0, 2))
  if (hour < YOUTUBE_FULL_FROM) return at
  const from = zoned(day, `${YOUTUBE_FULL_FROM}:00`, YOUTUBE_DAY_TZ).getTime()
  const share = (at - from) / ((24 - YOUTUBE_FULL_FROM) * 60 * 60_000)
  return Math.round((dayHour(addDays(day, 1), YOUTUBE_DAY_FROM) + share * (YOUTUBE_DAY_TO - YOUTUBE_DAY_FROM) * 60 * 60_000) / 60_000) * 60_000
}

/** A YouTube copy that failed anyway, posted again: in the next good hours
 *  in California (5 AM to 1 PM there) - now if it is within them - at the
 *  same share of them as the post's time had of its own day. */
export function youtubeRetryTime(at: number, now: number): number {
  const minutes = Number(localTime(new Date(at), YOUTUBE_DAY_TZ).slice(0, 2)) * 60 + Number(localTime(new Date(at), YOUTUBE_DAY_TZ).slice(3))
  const share = minutes / (24 * 60)
  for (let d = 0; d < 3; d++) {
    const day = addDays(localDate(new Date(now), YOUTUBE_DAY_TZ), d)
    const from = dayHour(day, YOUTUBE_DAY_FROM)
    const to = dayHour(day, YOUTUBE_DAY_TO)
    const t = Math.round((from + share * (to - from)) / 60_000) * 60_000
    if (t > now + 5 * 60_000) return t
    if (to > now + 15 * 60_000) return now + 5 * 60_000
  }
  return now + 24 * 60 * 60_000
}

function dayHour(day: string, hour: number): number {
  return zoned(day, `${String(hour).padStart(2, '0')}:00`, YOUTUBE_DAY_TZ).getTime()
}

/** A time at least `gap` from every one in `taken` (the account's other
 *  YouTube posts), moved on a quarter of an hour at a time, never past `until`. */
export function clearOfTaken(at: number, taken: readonly number[], until: number, gap = 45 * 60_000): number {
  let t = at
  for (let n = 0; n < 64 && taken.some((x) => Math.abs(x - t) < gap); n++) {
    if (t + 15 * 60_000 > until) return t
    t += 15 * 60_000
  }
  return t
}

/** The end of a day's good YouTube hours, for the day `at` falls on. */
export function goodHoursEnd(at: number): number {
  return dayHour(localDate(new Date(at), YOUTUBE_DAY_TZ), YOUTUBE_DAY_TO)
}
