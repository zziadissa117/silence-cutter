// The Campaigns tab: setting up, away from the day's work. A list of
// campaigns; tap one for its angles; tap an angle to change its look. A
// campaign is deleted from its own screen, at the bottom.

import { useEffect, useState } from 'react'

import { ChevronLeft, ChevronRight } from './icons'
import { describeAngle, type Angle, type Campaign } from './look'

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

function Mark({ campaign }: { campaign: Campaign }) {
  const url = useObjectUrl(campaign.logo)
  return url ? (
    <img className="mark" src={url} alt="" />
  ) : (
    <span className="mark letter" aria-hidden>
      {(campaign.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

export function CampaignsView({
  campaigns,
  openId,
  onOpen,
  onNewCampaign,
  onEditCampaign,
  onEditAngle,
  onNewAngle,
  onDeleteCampaign,
  onPosting,
  postingLine,
  shared,
}: {
  campaigns: Campaign[]
  /** The campaign whose angles are showing, or null for the list. */
  openId: string | null
  onOpen: (id: string | null) => void
  onNewCampaign: () => void
  onEditCampaign: (campaign: Campaign) => void
  onEditAngle: (campaign: Campaign, angle: Angle) => void
  onNewAngle: (campaign: Campaign) => void
  onDeleteCampaign: (campaign: Campaign) => void
  /** Opens where and when its videos are posted. */
  onPosting: (campaign: Campaign) => void
  /** One line on how it posts, e.g. "2 accounts · 6 PM, 8 PM · you approve". */
  postingLine: (campaign: Campaign) => string
  /** Signed in to the shared login, so a deletion reaches the other phone. */
  shared: boolean
}) {
  const open = campaigns.find((c) => c.id === openId)

  if (open) {
    return (
      <section className="screen">
        <button type="button" className="back" onClick={() => onOpen(null)}>
          <ChevronLeft /> Campaigns
        </button>
        <div className="screen-head">
          <h2>{open.name}</h2>
          {!open.general ? (
            <button type="button" className="btn small" onClick={() => onEditCampaign(open)}>
              Brand & logo
            </button>
          ) : null}
        </div>
        <p className="lede">
          {open.general
            ? 'For videos with no campaign in them.'
            : open.brandWords.length > 0
              ? `Heard as "${open.brandWords.join('", "')}".`
              : 'No brand name yet - add it under Brand & logo.'}
        </p>

        <div className="list-title">Angles</div>
        <ul className="rows">
          {open.angles.map((angle) => (
            <li key={angle.id}>
              <button type="button" className="row-link" onClick={() => onEditAngle(open, angle)}>
                <span className="row-text">
                  <span className="row-name">{angle.name}</span>
                  <span className="row-line">
                    {angle.general ? `For videos that fit no other angle · ${describeAngle(open, angle)}` : describeAngle(open, angle)}
                  </span>
                </span>
                <ChevronRight />
              </button>
            </li>
          ))}
        </ul>
        <div className="actions-row">
          <button type="button" className="btn" onClick={() => onNewAngle(open)}>
            New angle
          </button>
        </div>

        <div className="list-title">Posting</div>
        <ul className="rows">
          <li>
            <button type="button" className="row-link" onClick={() => onPosting(open)}>
              <span className="row-text">
                <span className="row-name">Postiz</span>
                {/* Red when nothing holds its videos back: no times means they post the moment they're ready. */}
                <span className={postingLine(open).startsWith('No times') ? 'row-line warn-text' : 'row-line'}>{postingLine(open)}</span>
              </span>
              <ChevronRight />
            </button>
          </li>
        </ul>
        {!open.general ? (
          // Down at the bottom, away from everything else, so it is never hit
          // by mistake.
          <button
            type="button"
            className="linkbtn danger delete"
            onClick={() => {
              const everywhere = shared ? ' It goes from your friend\'s phone too.' : ''
              if (window.confirm(`Delete ${open.name} and all its angles? Videos already made are not affected.${everywhere}`)) {
                onDeleteCampaign(open)
              }
            }}
          >
            Delete campaign
          </button>
        ) : null}
      </section>
    )
  }

  const own = campaigns.filter((c) => !c.general)
  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Campaigns</h1>
        <button type="button" className={own.length === 0 ? 'btn small primary' : 'btn small'} onClick={onNewCampaign}>
          New campaign
        </button>
      </div>
      {own.length === 0 ? (
        <p className="lede">Set one up once - the brand's name and logo, then each kind of video it gets.</p>
      ) : null}
      <ul className="rows">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <button type="button" className="row-link" onClick={() => onOpen(campaign.id)}>
              <Mark campaign={campaign} />
              <span className="row-text">
                <span className="row-name">{campaign.name}</span>
                <span className="row-line">
                  {campaign.general
                    ? 'Videos with no campaign'
                    : `${campaign.angles.length} angle${campaign.angles.length === 1 ? '' : 's'}`}
                </span>
              </span>
              <ChevronRight />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
