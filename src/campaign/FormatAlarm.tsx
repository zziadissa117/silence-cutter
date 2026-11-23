// "Change the format now" (his ask, 2026-11-23: "if we get under 1k views,
// notify us ... Try to really force the fact that we have to change the
// format"). The server judges each video of a watched campaign a day in
// (postiz/lowViews.ts) and buzzes him; here the accounts it named stay in red
// on top of Analytics - and as a line on the Videos tab - until he taps that
// he changed the format, or a newer video of theirs gets 1k by itself.
// Which campaigns are watched: one tap each, on Analytics.

import { useState } from 'react'

import type { FormatAlarm } from '../../supabase/functions/postiz/lowViews.ts'
import { shortNumber } from './analytics'
import type { Campaign } from './look'
import { accountLabel } from './posting'

const platformName = (p: string) =>
  p.startsWith('instagram') ? 'Instagram' : p.startsWith('tiktok') ? 'TikTok' : p === 'youtube' ? 'YouTube' : p === 'facebook' ? 'Facebook' : p

const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** The red card: every account that has to change its format now. */
export function FormatAlarmCard({ alarms, onChanged }: { alarms: readonly FormatAlarm[]; onChanged: (accountIds: string[]) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (alarms.length === 0) return null
  const tap = (ids: string[], key: string) => {
    setBusy(key)
    setProblem(null)
    void onChanged(ids)
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(null))
  }
  return (
    <div className="group analytics-campaign trouble format-alarm" role="alert">
      <div className="group-title">Change the format now</div>
      <p className="hint">
        {alarms.length === 1 ? 'This account' : `These ${alarms.length} accounts`} got under 1k views a day in. The format isn&rsquo;t working on
        {alarms.length === 1 ? ' it' : ' them'} - post a different one next (another hook style, length, layout or sound), not the same again.
      </p>
      <ul className="trouble-list">
        {alarms.map((a) => (
          <li key={a.accountId} className="trouble-row">
            <div>
              <div className="label">
                {accountLabel({ name: a.name, platform: a.platform, profile: a.profile })} <span className="alarm-views">{shortNumber(a.views)} views</span>
              </div>
              <div className="hint">
                {a.campaignName} · {platformName(a.platform)} · {dayOf(a.postAt)}
                {a.headline ? ` · “${a.headline}”` : ''}
              </div>
            </div>
            <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => tap([a.accountId], a.accountId)}>
              {busy === a.accountId ? '…' : 'I changed it'}
            </button>
          </li>
        ))}
      </ul>
      {alarms.length > 1 ? (
        <button type="button" className="btn small" disabled={busy !== null} onClick={() => tap(alarms.map((a) => a.accountId), 'all')}>
          {busy === 'all' ? '…' : 'I changed all of them'}
        </button>
      ) : null}
      {problem ? <p className="hint warn">{problem}</p> : null}
    </div>
  )
}

/** Which campaigns are watched: a tap each. */
export function FormatAlarmPicker({
  campaigns,
  watched,
  onSet,
}: {
  /** The campaigns that post somewhere. */
  campaigns: readonly Campaign[]
  watched: Readonly<Record<string, string>>
  onSet: (campaignId: string, on: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (campaigns.length === 0) return null
  const tap = (id: string) => {
    setBusy(id)
    setProblem(null)
    void onSet(id, !watched[id])
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(null))
  }
  return (
    <div className="group analytics-campaign format-watch">
      <div className="group-title">Under-1k alarm</div>
      <p className="hint">Tell me to change the format when a video of these gets under 1k views a day after it goes out.</p>
      <div className="seg chips" role="group" aria-label="Campaigns watched">
        {campaigns.map((c) => (
          <button key={c.id} type="button" className={watched[c.id] ? 'active' : ''} aria-pressed={Boolean(watched[c.id])} disabled={busy === c.id} onClick={() => tap(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      {problem ? <p className="hint warn">{problem}</p> : null}
    </div>
  )
}

/** The line on the Videos tab while any account has to change: before he
 *  makes the next one. */
export function FormatAlarmLine({ alarms, onOpen }: { alarms: readonly FormatAlarm[]; onOpen: () => void }) {
  if (alarms.length === 0) return null
  const names = alarms.slice(0, 3).map((a) => (a.profile ? `@${a.profile.replace(/^@/, '')}` : a.name))
  return (
    <button type="button" className="format-alarm-line" onClick={onOpen}>
      <span className="label">Change the format now</span>
      <span className="hint">
        {names.join(', ')}
        {alarms.length > 3 ? ` +${alarms.length - 3}` : ''} under 1k views
      </span>
    </button>
  )
}
