// "Change the format now" (his ask, 2026-11-23: "whenever we post something
// for campaigns that we select, if we get under 1k views, notify us ... Try to
// really force the fact that we have to change the format"). A video of a
// campaign he watches that is under UNDER views when its views are first read
// (a day after it went out, postViews.ts) puts its account on the alarm: he
// is told at once, and Analytics shows it on top until he says he changed the
// format - or until a newer video on that account gets UNDER, which says the
// new format works.
//
// Plain TypeScript with no imports, for Deno and the tests.

/** Under this many views a day in, the format isn't working (his number). */
export const UNDER = 1000
/** A video is judged once its views are read this long after it went out. */
export const JUDGED_AFTER_H = 24
/** Videos older than this are not judged any more (the last reading is at a week). */
export const LOOK_BACK_DAYS = 8

export interface WatchedPost {
  id: string
  campaign_id: string
  campaign_name: string
  headline: string | null
  post_at: string | null
  views_at: string | null
  accounts: { id: string; name: string; platform: string; profile?: string }[]
  views: Record<string, number> | null
}

/** One account told to change its format: the video that said so. */
export interface FormatAlarm {
  accountId: string
  name: string
  platform: string
  profile?: string
  campaignId: string
  campaignName: string
  postId: string
  headline: string | null
  views: number
  postAt: string
  /** When he was told. */
  at: string
}

export interface AlarmState {
  /** On now, one per account: its latest video under UNDER. */
  alarms: FormatAlarm[]
  /** `postId:accountId` already judged, so a video sets an alarm only once. */
  judged: Record<string, string>
}

const HOUR = 3_600_000

/** The alarms after the videos read since: `watched` maps each campaign he
 *  watches to when he turned it on (only videos posted since count). Returns
 *  the new state and the alarms that are new (to tell him). */
export function nextAlarms(
  before: AlarmState,
  posts: readonly WatchedPost[],
  watched: Readonly<Record<string, string>>,
  now: number,
): { state: AlarmState; fresh: FormatAlarm[] } {
  const judged = { ...before.judged }
  const byAccount = new Map(before.alarms.map((a) => [a.accountId, a]))
  const fresh: FormatAlarm[] = []
  // Oldest first: a newer video decides how the account stands.
  const read = posts
    .filter((p) => {
      const since = Date.parse(watched[p.campaign_id] ?? '')
      const at = Date.parse(p.post_at ?? '')
      const readAt = Date.parse(p.views_at ?? '')
      return Number.isFinite(since) && Number.isFinite(at) && at >= since && p.views && Number.isFinite(readAt) && readAt >= at + JUDGED_AFTER_H * HOUR
    })
    .sort((a, b) => Date.parse(a.post_at!) - Date.parse(b.post_at!))
  for (const post of read) {
    for (const account of post.accounts ?? []) {
      const views = post.views![account.name]
      if (typeof views !== 'number' || !Number.isFinite(views)) continue
      const key = `${post.id}:${account.id}`
      if (judged[key]) {
        // The video that set the alarm caught up later (read again at 3 days
        // and a week): it wasn't the format after all.
        const on = byAccount.get(account.id)
        if (on?.postId === post.id && views >= UNDER) byAccount.delete(account.id)
        continue
      }
      judged[key] = new Date(now).toISOString()
      const on = byAccount.get(account.id)
      if (views >= UNDER) {
        // A newer video did it: the format works again.
        if (on && Date.parse(on.postAt) <= Date.parse(post.post_at!)) byAccount.delete(account.id)
        continue
      }
      if (on && Date.parse(on.postAt) > Date.parse(post.post_at!)) continue
      const alarm: FormatAlarm = {
        accountId: account.id,
        name: account.name,
        platform: account.platform,
        ...(account.profile ? { profile: account.profile } : {}),
        campaignId: post.campaign_id,
        campaignName: post.campaign_name,
        postId: post.id,
        headline: post.headline,
        views: Math.round(views),
        postAt: post.post_at!,
        at: new Date(now).toISOString(),
      }
      byAccount.set(account.id, alarm)
      fresh.push(alarm)
    }
  }
  // Judged keys older than anything still read are let go.
  const oldest = now - (LOOK_BACK_DAYS + 2) * 24 * HOUR
  for (const [key, at] of Object.entries(judged)) if (Date.parse(at) < oldest) delete judged[key]
  return { state: { alarms: [...byAccount.values()].sort((a, b) => a.views - b.views), judged }, fresh: fresh.filter((f) => byAccount.get(f.accountId) === f) }
}

/** He changed the format on these accounts: their alarms go. */
export function changedFormat(state: AlarmState, accountIds: readonly string[]): AlarmState {
  const gone = new Set(accountIds)
  return { ...state, alarms: state.alarms.filter((a) => !gone.has(a.accountId)) }
}

const platformName = (p: string) =>
  p.startsWith('instagram') ? 'Instagram' : p.startsWith('tiktok') ? 'TikTok' : p === 'youtube' ? 'YouTube' : p === 'facebook' ? 'Facebook' : p

const who = (a: { name: string; profile?: string }) => (a.profile ? `@${a.profile.replace(/^@/, '')}` : a.name)

/** The notification: one for all the accounts found at once. */
export function alarmNote(fresh: readonly FormatAlarm[]): { title: string; body: string } {
  if (fresh.length === 1) {
    const a = fresh[0]
    return {
      title: `Change the format now - ${who(a)}`,
      body: `Its ${a.campaignName} video got ${a.views} views on ${platformName(a.platform)} - under 1k. Post a different format next.`,
    }
  }
  return {
    title: `Change the format now - ${fresh.length} accounts under 1k`,
    body: fresh
      .slice(0, 4)
      .map((a) => `${who(a)} ${a.views}`)
      .join(' · ')
      .concat(fresh.length > 4 ? ` · +${fresh.length - 4} more` : '', '. Post a different format next.'),
  }
}
