// The Campaigns tab: setting up, away from the day's work. A list of
// campaigns; tap one for its angles; tap an angle to change its look. A
// campaign is deleted from its own screen, at the bottom.

import { TRIBE_HUE } from './tribe'
import { useEffect, useState } from 'react'

import { ChevronLeft, ChevronRight } from './icons'
import { BackToMore } from './MoreView'
import { EndCampaign } from './EndCampaign'
import type { Profile } from './posting'
import { describeAngle, type Angle, type BankPicture, type Campaign } from './look'
import { hueOf } from './HomeTop'

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
    <span className="mark letter" aria-hidden style={{ ['--hue' as string]: String(campaign.tribe ? TRIBE_HUE : hueOf(campaign.name || '?')) }}>
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
  onStopPosts,
  postingLine,
  shared,
  ending,
  onBackToMore,
  pictures,
}: {
  /** Each campaign's own picture bank (campaignBank.ts): its pictures, and
   *  adding or taking one out. */
  pictures?: { of: (campaignId: string) => BankPicture[]; onAdd: (campaignId: string, files: File[]) => Promise<void>; onRemove: (id: string) => void }
  /** Back to More, which it is reached from. */
  onBackToMore?: () => void
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
  /** Stops every post of the campaign not out yet, and says what it did.
   *  Absent when posting is not set up on this phone. */
  onStopPosts?: (campaign: Campaign) => Promise<string>
  /** One line on how it posts, e.g. "2 accounts · 6 PM, 8 PM · you approve". */
  postingLine: (campaign: Campaign) => string
  /** Signed in to the shared login, so a deletion reaches the other phone. */
  shared: boolean
  /** Ending a campaign (its accounts out of Postiz); absent without posting. */
  ending?: { profile: Profile; names: Record<string, string>; onChanged: () => void }
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

        {pictures ? <CampaignPictures campaign={open} pictures={pictures} /> : null}

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
        {/* Stopping, ending and deleting, folded away together: rare, and
            not to be hit by mistake. */}
        {onStopPosts || (ending && !open.general) || !open.general ? (
          <details className="danger-zone">
            <summary className="linkbtn">Stop or end this campaign</summary>
          {onStopPosts ? <StopPosts campaign={open} onStop={onStopPosts} /> : null}
          {ending && !open.general ? (
            <EndCampaign campaign={open} profile={ending.profile} names={ending.names} onChanged={ending.onChanged} />
          ) : null}
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
          </details>
        ) : null}
      </section>
    )
  }

  const own = campaigns.filter((c) => !c.general)
  return (
    <section className="screen">
      {onBackToMore ? <BackToMore onBack={onBackToMore} /> : null}
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

/** For a finished campaign: every post of it still waiting or scheduled,
 *  stopped in one go. Only this campaign's - nothing else is touched. */
function StopPosts({ campaign, onStop }: { campaign: Campaign; onStop: (campaign: Campaign) => Promise<string> }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  return (
    <div className="actions-row">
      <button
        type="button"
        className="btn danger"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(`Stop every ${campaign.name} post that hasn't gone out yet? Ones scheduled in Postiz are taken out. Other campaigns' posts are not touched.`)) return
          setBusy(true)
          setSaid(null)
          onStop(campaign)
            .then(setSaid)
            .catch((error: unknown) => setSaid(error instanceof Error ? error.message : String(error)))
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Stopping…' : `Stop all ${campaign.name} posts`}
      </button>
      {said ? <div className="hint">{said}</div> : null}
    </div>
  )
}

/** A campaign's own picture bank on its page (campaignBank.ts). */
function CampaignPictures({
  campaign,
  pictures,
}: {
  campaign: Campaign
  pictures: { of: (campaignId: string) => BankPicture[]; onAdd: (campaignId: string, files: File[]) => Promise<void>; onRemove: (id: string) => void }
}) {
  const list = pictures.of(campaign.id)
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <div className="campaign-pictures">
      <div className="list-title">
        Picture bank <span className="bank-count">{list.length}</span>
      </div>
      <p className="hint">
        {campaign.name}&rsquo;s own pictures. They come first when you put a picture on one of its videos (Overlay in the edit screen). Pictures from your
        phone that you use on its videos are kept here by themselves.
      </p>
      {list.length > 0 ? (
        <div className="pic-grid campaign-pic-grid">
          {list.map((p) => (
            <CampaignPicture key={p.id} picture={p} onRemove={() => pictures.onRemove(p.id)} />
          ))}
        </div>
      ) : null}
      <label className="btn small picker">
        {adding ? 'Adding…' : '+ Add pictures'}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={adding}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length === 0) return
            setAdding(true)
            setProblem(null)
            void pictures
              .onAdd(campaign.id, files)
              .catch(() => setProblem("Some pictures couldn't be opened."))
              .finally(() => setAdding(false))
          }}
        />
      </label>
      {problem ? <p className="hint warn-text">{problem}</p> : null}
    </div>
  )
}

function CampaignPicture({ picture, onRemove }: { picture: BankPicture; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const made = URL.createObjectURL(picture.image)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [picture.image])
  return (
    <span className="pic-cell campaign-pic">
      {url ? <img alt="" src={url} /> : null}
      <button
        type="button"
        className="campaign-pic-x"
        aria-label="Take this picture out of the bank"
        onClick={() => {
          if (window.confirm('Take this picture out of the campaign\'s bank? Videos already made keep it.')) onRemove()
        }}
      >
        ✕
      </button>
    </span>
  )
}
