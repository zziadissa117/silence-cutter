// A post he makes by hand from the Posts screen's New post: a finished video
// he picks, for the campaign he picks, sent as it is. It is never approved
// again and takes none of the campaign's own times - it goes at the time he
// chose, or straight away when he chose none or that time has gone.
//
// Several at once can instead be spread over the campaign's own times - and
// the day's even spread to midnight when those have gone - exactly as made
// videos are, still with nothing to approve.
//
// Plain TypeScript with no imports beyond caption.ts, for Deno and for the
// unit tests.

import { captionLead, finishCaption, finishTitle, type PostingRules } from './caption.ts'

/** A time closer than this is as good as now. */
const NOW_WITHIN_MS = 2 * 60_000

export interface HandFields {
  /** False for a batch spread over the campaign's times: those take their
   *  times the way every made video does. */
  by_hand: boolean
  about: string | null
  slot: null
  post_at: string | null
  caption?: string
  title?: string
}

/** The fields a post made by hand starts with, from what the phone sent -
 *  or null when it is not one. */
export function handFields(value: unknown, rules: PostingRules, campaignName: string, now = Date.now()): HandFields | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const at = typeof v.at === 'string' ? Date.parse(v.at) : NaN
  const about = (typeof v.about === 'string' ? v.about.slice(0, 2000).trim() : '') || null
  const written =
    typeof v.caption === 'string' && v.caption.trim()
      ? finishCaption(v.caption.slice(0, 5000), rules.caption === 'paste' ? [] : rules.hashtags)
      : null
  return {
    by_hand: v.spread !== true,
    about,
    slot: null,
    post_at: v.spread !== true && Number.isFinite(at) && at > now + NOW_WITHIN_MS ? new Date(at).toISOString() : null,
    ...(written ? { caption: written, title: finishTitle('', [about ?? '', captionLead(written), campaignName]) } : {}),
  }
}
