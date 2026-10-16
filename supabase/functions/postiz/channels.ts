// What a finished campaign leaves switched on in Postiz.
//
// The Postiz plan counts connected channels (30 on his), and a campaign that
// has ended still holds its accounts. Postiz's public API cannot switch one
// off - the only call that touches an account deletes it for good, scheduled
// posts and all - so the planner shows him which to disable by hand and
// checks again afterwards. This works out that report from what Postiz says
// and what the cutter knows: which accounts the campaign posts to, which other
// campaigns post to the same ones, and what is still waiting to go out on
// them (disabling a channel makes those fail).
//
// Pure, so it is tested without Postiz or a database (channels.test.ts).

export interface Integration {
  id: string
  name: string
  platform: string
  profile: string
  disabled: boolean
}

export interface PendingPost {
  campaign_id: string
  status: string
  post_at: string | null
  accounts: { id: string }[] | null
}

export interface ChannelAccount {
  id: string
  name: string
  platform: string
  profile: string
  /** null: the campaign still lists it, but Postiz no longer has it. */
  disabled: boolean | null
  /** Other campaigns on this posting profile that post to the same account. */
  alsoUsedBy: { id: string; name: string }[]
  /** Posts still due to go out on it, from any campaign. */
  scheduled: number
}

export interface ChannelReport {
  /** Connected (not disabled) accounts on this Postiz key - what the plan
   *  limit counts. */
  inUse: number
  accounts: ChannelAccount[]
}

/** Statuses of a post that has not gone out yet. A scheduled one counts only
 *  while its time is still ahead; past it, it has gone out (or failed) and
 *  disabling the channel no longer touches it. */
export const PENDING_STATUSES = ['uploading', 'writing', 'waiting', 'approved', 'scheduled'] as const

export function isPending(post: Pick<PendingPost, 'status' | 'post_at'>, now: number): boolean {
  if (!(PENDING_STATUSES as readonly string[]).includes(post.status)) return false
  if (post.status !== 'scheduled') return true
  return post.post_at === null || Date.parse(post.post_at) > now
}

/** The report for one posting profile, or null when the campaign posts to no
 *  account on it. */
export function channelReport(
  campaignId: string,
  campaigns: Record<string, { accounts?: string[] } | undefined>,
  integrations: readonly Integration[],
  posts: readonly PendingPost[],
  names: ReadonlyMap<string, string>,
  now: number,
): ChannelReport | null {
  const ids = [...new Set(campaigns[campaignId]?.accounts ?? [])]
  if (ids.length === 0) return null

  const pending = posts.filter((post) => isPending(post, now))

  const accounts = ids.map((id): ChannelAccount => {
    const integration = integrations.find((i) => i.id === id)
    const alsoUsedBy = Object.entries(campaigns)
      .filter(([other, settings]) => other !== campaignId && (settings?.accounts ?? []).includes(id))
      .map(([other]) => ({ id: other, name: names.get(other) ?? 'another campaign' }))
    return {
      id,
      name: integration?.name ?? '',
      platform: integration?.platform ?? '',
      profile: integration?.profile ?? '',
      disabled: integration ? integration.disabled : null,
      alsoUsedBy,
      scheduled: pending.filter((post) => (post.accounts ?? []).some((a) => a.id === id)).length,
    }
  })

  return { inUse: integrations.filter((i) => !i.disabled).length, accounts }
}

/** How a campaign's stop splits its posts: the ones never handed to Postiz
 *  are simply rejected; the ones Postiz holds are rejected too, and then
 *  taken out of Postiz in the background (index.ts unpostStopped), so a stop
 *  of a hundred posts never waits on a hundred Postiz calls. */
export function splitStop<P extends Pick<PendingPost, 'status' | 'post_at'> & { id: string; postiz_ids: unknown[] | null }>(
  posts: readonly P[],
  now: number,
): { reject: string[]; unpost: string[] } {
  const reject: string[] = []
  const unpost: string[] = []
  for (const post of posts) {
    if (!isPending(post, now)) continue
    if (post.status === 'scheduled' && (post.postiz_ids?.length ?? 0) > 0) unpost.push(post.id)
    else reject.push(post.id)
  }
  return { reject, unpost }
}


// --- Ending a campaign: which of its accounts come out of Postiz ---------------
//
// Postiz's public API has no way to switch a channel off; the one call there is
// deletes it (Postiz keeps it hidden, and adding the same account again in
// Postiz brings it back with the same id). Deleting also deletes every post
// Postiz holds on it - scheduled ones never go out - but never what is already
// live on the platform. So an account comes out only when nothing else needs
// it: no other campaign or login posts to it, nothing of another campaign is
// due on it, and Postiz holds nothing on it that the Cutter didn't make.

export interface EndPost extends PendingPost {
  postiz_ids: { postId: string }[] | null
}

/** A post in Postiz's own list. */
export interface UpcomingPost {
  id: string
  integration: string
  publishDate: string | null
  state: string | null
}

export interface EndPlan {
  remove: Integration[]
  /** `later`: what keeps it will pass (a post still due, one just out, posts
   *  he made in Postiz) - it stays on the campaign so ending it again can
   *  take it out. Otherwise it belongs elsewhere now. */
  keep: { account: Integration; why: string; later: boolean }[]
  /** The campaign lists them; Postiz no longer has them. */
  gone: string[]
}

/** A post that went out this recently may not be confirmed yet; deleting its
 *  channel now would leave it unconfirmed for good. */
const JUST_OUT_MS = 3 * 60 * 60 * 1000

export function endPlan(input: {
  campaignId: string
  /** The accounts to take out - the campaign's own picks. */
  accountIds: readonly string[]
  /** This login's other campaigns and their accounts. */
  campaigns: Record<string, { accounts?: string[] } | undefined>
  /** The campaigns that still exist; a deleted one's picks hold nothing.
   *  Absent: every campaign counts. */
  known?: ReadonlySet<string>
  /** The other logins' (profiles') campaigns on the same space. */
  otherProfiles: readonly Record<string, { accounts?: string[] } | undefined>[]
  integrations: readonly Integration[]
  /** This login's posts not out yet (PENDING_STATUSES), every campaign. */
  posts: readonly EndPost[]
  /** Postiz posts of this campaign, any status: fine to delete with it. */
  ownPostiz: ReadonlySet<string>
  /** Postiz's list from a little before now on. */
  upcoming: readonly UpcomingPost[]
  names: ReadonlyMap<string, string>
  now: number
}): EndPlan {
  const { campaignId, now } = input
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  const cutterPostiz = new Set(input.posts.flatMap((p) => (p.postiz_ids ?? []).map((ref) => ref.postId)))
  const plan: EndPlan = { remove: [], keep: [], gone: [] }
  for (const id of new Set(input.accountIds)) {
    const account = input.integrations.find((i) => i.id === id)
    if (!account) {
      plan.gone.push(id)
      continue
    }
    const on = (p: PendingPost) => (p.accounts ?? []).some((a) => a.id === id)
    const other = Object.entries(input.campaigns).find(
      ([cid, place]) => cid !== campaignId && (!input.known || input.known.has(cid)) && (place?.accounts ?? []).includes(id),
    )
    const otherDue = input.posts.filter((p) => p.campaign_id !== campaignId && on(p))
    const justOut = input.posts.filter(
      (p) => p.campaign_id === campaignId && on(p) && p.status === 'scheduled' && p.post_at !== null && Date.parse(p.post_at) <= now && now - Date.parse(p.post_at) < JUST_OUT_MS,
    )
    const outside = input.upcoming.filter(
      (u) =>
        u.integration === id &&
        u.state !== 'PUBLISHED' &&
        u.state !== 'ERROR' &&
        (u.publishDate === null || Date.parse(u.publishDate) > now) &&
        !input.ownPostiz.has(u.id) &&
        !cutterPostiz.has(u.id),
    )
    const elsewhere = account.disabled
      ? "already switched off in Postiz - it doesn't count toward your limit"
      : other
        ? `${input.names.get(other[0]) ?? 'another campaign'} posts to it too`
        : input.otherProfiles.some((c) => Object.values(c).some((place) => (place?.accounts ?? []).includes(id)))
          ? "the other login's posting uses it too"
          : null
    const later =
      otherDue.length > 0
        ? `${plural(otherDue.length, `${input.names.get(otherDue[0].campaign_id) ?? 'other'} post`)} still due on it`
        : justOut.length > 0
          ? 'a post just went out on it - end it again in a few hours'
          : outside.length > 0
            ? `Postiz holds ${plural(outside.length, 'post')} on it the Cutter didn't make - delete ${outside.length === 1 ? 'it' : 'them'} in Postiz, then end it again`
            : null
    if (elsewhere) plan.keep.push({ account, why: elsewhere, later: false })
    else if (later) plan.keep.push({ account, why: later, later: true })
    else plan.remove.push(account)
  }
  return plan
}
