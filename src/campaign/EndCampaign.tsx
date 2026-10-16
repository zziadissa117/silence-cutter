// Ending a campaign: its posts stopped and its Postiz accounts deleted from
// Postiz, so they stop counting toward the plan's limit. Postiz has no way for
// an app to switch an account off - only to delete it - so he sees exactly
// which go and which stay (and why) before anything is done; the server
// deletes them in the background (supabase/functions/postiz, end-campaign).

import { useEffect, useState } from 'react'

import { accountLabel, endCampaign, previewEndCampaign, refreshProfile, type EndPreview, type EndedResult, type Profile } from './posting'
import type { Campaign } from './look'

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function endedLines(result: EndedResult): string[] {
  return [
    result.removed.length > 0 ? `Taken out of Postiz: ${result.removed.map(accountLabel).join(', ')}.` : 'No account was taken out of Postiz.',
    ...result.kept.map((k) => `Kept ${accountLabel(k)} - ${k.why}.`),
    ...result.failed.map((f) => `Couldn't take out ${accountLabel(f)} (${f.error}) - delete it in Postiz.`),
  ]
}

export function EndCampaign({
  campaign,
  profile,
  names,
  onChanged,
}: {
  campaign: Campaign
  profile: Profile
  names: Record<string, string>
  /** The profile on this phone changed. */
  onChanged: () => void
}) {
  const [preview, setPreview] = useState<EndPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const ending = profile.settings.ending?.[campaign.id]
  const ended = profile.settings.ended?.[campaign.id]

  // While its accounts are coming out, look again now and then.
  useEffect(() => {
    if (!ending) return
    const timer = window.setInterval(() => {
      void refreshProfile()
        .then(onChanged)
        .catch(() => {})
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [ending, onChanged])

  const fail = (error: unknown) => setSaid(error instanceof Error ? error.message : String(error))

  if (preview) {
    const { plan, stopping, connected } = preview
    return (
      <div className="end-campaign callout">
        <div className="row-name">End {campaign.name}?</div>
        <p className="row-line wrap">
          {stopping > 0 ? `${stopping} post${stopping === 1 ? '' : 's'} not out yet will be stopped.` : 'Nothing of it is waiting to go out.'}
        </p>
        {plan.remove.length > 0 ? (
          <>
            <p className="row-line wrap">
              Taken out of Postiz - {plan.remove.length} of your {connected} connected account{connected === 1 ? '' : 's'}:
            </p>
            <ul className="end-list">
              {plan.remove.map((a) => (
                <li key={a.id}>{accountLabel(a)}</li>
              ))}
            </ul>
          </>
        ) : null}
        {plan.keep.length > 0 ? (
          <>
            <p className="row-line wrap">Kept in Postiz:</p>
            <ul className="end-list">
              {plan.keep.map((k) => (
                <li key={k.id}>
                  {accountLabel(k)} <span className="row-line wrap">- {k.why}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {plan.remove.length === 0 && plan.keep.length === 0 ? <p className="row-line wrap">It has no Postiz accounts picked.</p> : null}
        {plan.remove.length > 0 ? (
          <p className="hint">
            Videos already posted stay up. Postiz also cancels anything else scheduled on an account it takes out. To use one
            again, add it in Postiz again (you log in to it there), then pick it in a campaign's Posting.
          </p>
        ) : null}
        <div className="actions-row">
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setSaid(null)
              endCampaign(
                campaign.id,
                names,
                plan.remove.map((a) => a.id),
              )
                .then(({ stopped, removing }) => {
                  setPreview(null)
                  onChanged()
                  setSaid(
                    [
                      stopped > 0 ? `Stopped ${stopped} post${stopped === 1 ? '' : 's'}.` : '',
                      removing > 0 ? `Taking ${removing} account${removing === 1 ? '' : 's'} out of Postiz - a few minutes.` : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || 'Done - nothing was left to stop or take out.',
                  )
                })
                .catch(fail)
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Ending…' : plan.remove.length > 0 ? `End it and take out ${plan.remove.length}` : 'End it'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setPreview(null)}>
            Cancel
          </button>
        </div>
        {said ? <div className="error">{said}</div> : null}
      </div>
    )
  }

  return (
    <div className="end-campaign">
      {ending ? (
        <p className="hint">Taking {ending.accounts.length} account{ending.accounts.length === 1 ? '' : 's'} out of Postiz…</p>
      ) : ended ? (
        <div className="hint">
          <div>Ended {day(ended.at)}.</div>
          {endedLines(ended).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
      {said && !ending ? <p className="hint">{said}</p> : null}
      <div className="actions-row">
        <button
          type="button"
          className="btn danger"
          disabled={busy || Boolean(ending)}
          onClick={() => {
            setBusy(true)
            setSaid(null)
            previewEndCampaign(campaign.id, names)
              .then(setPreview)
              .catch(fail)
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Checking…' : 'End campaign - free its Postiz accounts'}
        </button>
      </div>
      <p className="hint tip">
        When a campaign is over: stops its posts and takes its accounts out of Postiz, so they stop counting toward your
        Postiz limit. You see which go before anything happens.
      </p>
    </div>
  )
}
