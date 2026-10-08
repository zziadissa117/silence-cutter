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
