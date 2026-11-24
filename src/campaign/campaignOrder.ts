// Campaigns newest first, and the ones nobody posts for any more (his ask,
// 2026-11-24: "make sure that campaign names are sorted into which one was the
// most recently made" and, he and Ilyan sharing one Postiz, "if none of us
// have posted in one campaign in a long time, alert it ... 'Hey, are you still
// posting for this campaign? You could free your Postiz account ... delete
// the campaign'").

import type { Campaign } from './look'

/** Nothing out, or set to go, for this long: is anyone still posting for it? */
export const STALE_DAYS = 14
/** "Still posting": not asked about it again for this long. */
export const ASK_AGAIN_DAYS = 30

const DAY = 86_400_000

export type CampaignDates = Record<string, { first: string | null; last: string | null }>

/** When a campaign was made: its own date; one made before campaigns kept it,
 *  its first video in; else when it was last changed. */
export function madeAt(campaign: Campaign, dates: CampaignDates = {}): number {
  if (campaign.createdAt) return campaign.createdAt
  const first = Date.parse(dates[campaign.id]?.first ?? '')
  return Number.isFinite(first) ? first : campaign.updatedAt
}

/** Newest made first; the General campaign last. */
export function newestFirst(campaigns: readonly Campaign[], dates: CampaignDates = {}): Campaign[] {
  const own = campaigns.filter((c) => !c.general).sort((a, b) => madeAt(b, dates) - madeAt(a, dates))
  return [...own, ...campaigns.filter((c) => c.general)]
}

export interface Stale {
  campaign: Campaign
  /** Days since its last video went out (or since it was made, if none did). */
  days: number
}

/** The campaigns that post somewhere and haven't had a video out or set to
 *  go in STALE_DAYS - not the General one, not the Trial reels', not one he
 *  said he still posts for (`answered`: campaign -> when he said so). */
export function staleCampaigns(
  campaigns: readonly Campaign[],
  dates: CampaignDates,
  posts: (campaignId: string) => boolean,
  answered: Readonly<Record<string, number>>,
  now: number,
): Stale[] {
  return campaigns
    .filter((c) => !c.general && !c.trial && posts(c.id))
    .flatMap((campaign) => {
      if (answered[campaign.id] && now - answered[campaign.id] < ASK_AGAIN_DAYS * DAY) return []
      const last = Date.parse(dates[campaign.id]?.last ?? '')
      const since = Number.isFinite(last) ? last : madeAt(campaign, dates)
      if (!dates[campaign.id] && !Number.isFinite(last)) return []
      const days = Math.floor((now - since) / DAY)
      return days >= STALE_DAYS ? [{ campaign, days }] : []
    })
    .sort((a, b) => b.days - a.days)
}

const ANSWERED_KEY = 'cutter.stillPosting'

export function stillPostingAnswers(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ANSWERED_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function sayStillPosting(campaignId: string, now = Date.now()): void {
  try {
    localStorage.setItem(ANSWERED_KEY, JSON.stringify({ ...stillPostingAnswers(), [campaignId]: now }))
  } catch {
    // Asked again next time.
  }
}
