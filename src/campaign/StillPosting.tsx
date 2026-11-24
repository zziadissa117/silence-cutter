// "Are you still posting for this campaign?" on the Videos tab (campaignOrder.ts):
// a campaign nothing has gone out for in two weeks, with the way to free its
// Postiz accounts or delete it (Open it: the campaign's page, where "Stop or
// end this campaign" is) - or "Still posting", not asked again for a month.

import { useState } from 'react'

import { STALE_DAYS, sayStillPosting, staleCampaigns, stillPostingAnswers, type CampaignDates } from './campaignOrder'
import type { Campaign } from './look'

export function StillPosting({
  campaigns,
  dates,
  posts,
  onOpen,
}: {
  campaigns: readonly Campaign[]
  dates: CampaignDates
  /** Whether a campaign posts to any account. */
  posts: (campaignId: string) => boolean
  onOpen: (campaignId: string) => void
}) {
  const [answers, setAnswers] = useState(stillPostingAnswers)
  const stale = staleCampaigns(campaigns, dates, posts, answers, Date.now())
  if (stale.length === 0) return null
  const { campaign, days } = stale[0]
  return (
    <div className="still-posting" role="status">
      <span className="label">Still posting for {campaign.name}?</span>
      <span className="hint">
        Nothing has gone out for it in {days >= STALE_DAYS * 4 ? 'over two months' : `${days} days`}. If it&rsquo;s over, end it to free its Postiz accounts, or
        delete it to clear things up.
        {stale.length > 1 ? ` ${stale.length - 1} more like it.` : ''}
      </span>
      <div className="actions-row">
        <button type="button" className="btn small primary" onClick={() => onOpen(campaign.id)}>
          End or delete it
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            sayStillPosting(campaign.id)
            setAnswers(stillPostingAnswers())
          }}
        >
          Still posting
        </button>
      </div>
    </div>
  )
}
