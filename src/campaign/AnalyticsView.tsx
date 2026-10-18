// The Analytics tab: how each campaign's videos are doing - views per video,
// and how that moved on last week - account by account, and when a running
// batch is doing well (or falling away) a suggestion to change its videos a
// day, which he answers with one tap. The numbers are read from Postiz by the
// server, about once a day per account (analytics.ts, views.ts).

import { useEffect, useMemo, useState } from 'react'

import {
  answeredAt,
  campaignViews,
  rememberAnswer,
  shortNumber,
  suggestRate,
  weekChange,
  type CampaignViews,
  type Suggestion,
  type ViewsByAccount,
} from './analytics'
import type { BatchBank } from './batch'
import type { Campaign } from './look'
import { accountLabel, placeFor, type Profile } from './posting'
import { loadBatchBank, saveBatchBank } from './store'

export interface CampaignRow {
  campaign: Campaign
  accountIds: string[]
  stats: CampaignViews
  bank: BatchBank | null
  suggestion: Suggestion | null
}

/** The campaigns that post somewhere, their numbers and batches, and what
 *  to suggest for each. `version` reloads the batches after a change. */
export function useCampaignRows(campaigns: readonly Campaign[] | null, profile: Profile | null, views: ViewsByAccount, version: number): CampaignRow[] {
  const posting = useMemo(
    () => (profile && campaigns ? campaigns.map((campaign) => ({ campaign, accountIds: placeFor(profile, campaign.id).accounts })).filter((c) => c.accountIds.length > 0) : []),
    [campaigns, profile],
  )
  const [banks, setBanks] = useState<Map<string, BatchBank | null>>(() => new Map())
  // Read again when the campaigns themselves change, not each time a new
  // list of the same ones comes in.
  const ids = posting.map((p) => p.campaign.id).join(',')
  useEffect(() => {
    let alive = true
    void Promise.all(ids.split(',').filter(Boolean).map(async (id) => [id, await loadBatchBank(id).catch(() => null)] as const)).then((list) => {
      if (alive) setBanks(new Map(list))
    })
    return () => {
      alive = false
    }
  }, [ids, version])
  return useMemo(
    () =>
      posting.map(({ campaign, accountIds }) => {
        const stats = campaignViews(accountIds, views)
        const bank = banks.get(campaign.id) ?? null
        const suggestion = bank
          ? suggestRate({ perDay: bank.perDay, running: Boolean(bank.running), stats, target: bank.viewTarget, answeredAt: answeredAt(campaign.id) })
          : null
        return { campaign, accountIds, stats, bank, suggestion }
      }),
    [posting, banks, views, version], // eslint-disable-line react-hooks/exhaustive-deps
  )
}

function Trend({ change }: { change: number | null }) {
  if (change === null) return <span className="trend">no trend yet</span>
  const pct = Math.round(change * 100)
  if (pct === 0) return <span className="trend">same as last week</span>
  return (
    <span className={`trend ${pct > 0 ? 'up' : 'down'}`}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% on last week
    </span>
  )
}

function ago(iso: string | undefined): string {
  if (!iso) return ''
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000
  if (!Number.isFinite(hours)) return ''
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.round(hours)} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function AnalyticsView({
  rows,
  profile,
  views,
  loading,
  onAnswer,
  onTarget,
}: {
  rows: CampaignRow[]
  profile: Profile | null
  views: ViewsByAccount
  loading: boolean
  /** He said yes (the new number) or not now (null) to a suggestion. */
  onAnswer: (campaignId: string, to: number | null) => void
  /** The views a video he wants before more a day; null for none. */
  onTarget: (campaignId: string, target: number | null) => void
}) {
  if (!profile) {
    return (
      <section className="screen analytics">
        <div className="screen-head">
          <h1>Analytics</h1>
        </div>
        <p className="empty">Analytics reads your views through Postiz. Set posting up in Settings first.</p>
      </section>
    )
  }
  const suggested = rows.filter((r) => r.suggestion)
  const anyRead = Object.keys(views).length > 0

  return (
    <section className="screen analytics">
      <div className="screen-head">
        <h1>Analytics</h1>
      </div>

      {suggested.map(({ campaign, suggestion }) => (
        <div key={campaign.id} className="callout analytics-suggestion">
          <div>
            <div className="label">
              {campaign.name}: {suggestion!.to > suggestion!.from ? 'ready for' : 'try'} {suggestion!.to} a day?
            </div>
            <div className="hint">
              {suggestion!.why} Now {suggestion!.from} a day.
            </div>
            <div className="actions-row">
              <button type="button" className="btn small primary" onClick={() => onAnswer(campaign.id, suggestion!.to)}>
                Yes, {suggestion!.to} a day
              </button>
              <button type="button" className="btn small" onClick={() => onAnswer(campaign.id, null)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      ))}

      {rows.length === 0 ? <p className="empty">No campaign posts anywhere yet. Pick its accounts first: Campaigns, open the campaign, then Posting.</p> : null}
      {rows.length > 0 && !anyRead ? (
        <p className="hint new-post-to">
          {loading ? 'Getting your views…' : 'Views are being read from Postiz, one account every few minutes - the first numbers show up within the hour.'}
        </p>
      ) : null}

      {rows.map(({ campaign, accountIds, stats, bank }) => (
        <div key={campaign.id} className="group analytics-campaign">
          <div className="analytics-head">
            <span className="group-title">{campaign.name}</span>
            <span className="hint">{bank?.running ? (bank.perDay === 0 ? 'Paused' : `${bank.perDay} a day`) : 'No batch running'}</span>
          </div>
          <div className="analytics-big">
            <span className="big-number">{shortNumber(stats.perVideo)}</span>
            <span className="hint">views a video</span>
            <Trend change={stats.change} />
          </div>
          {stats.read < stats.total && anyRead ? (
            <p className="hint">
              Views for {stats.read} of {stats.total} accounts so far.
            </p>
          ) : null}
          <ul className="analytics-accounts">
            {accountIds.map((id) => {
              const account = profile.accounts.find((a) => a.id === id)
              const v = views[id]
              return (
                <li key={id} className="analytics-account">
                  <div className="analytics-account-name">{account ? accountLabel(account) : 'An account no longer in Postiz'}</div>
                  {v?.error && v.perVideo === null ? (
                    <span className="hint warn-text">Postiz can't read views here yet.</span>
                  ) : v ? (
                    <div className="analytics-account-numbers">
                      <span>
                        <strong>{shortNumber(v.perVideo)}</strong> a video
                      </span>
                      {v.followers !== null ? <span className="hint">{shortNumber(v.followers)} followers</span> : null}
                      <Trend change={weekChange(v.history)} />
                      <span className="hint">{ago(v.at)}</span>
                    </div>
                  ) : (
                    <span className="hint">Not read yet</span>
                  )}
                </li>
              )
            })}
          </ul>
          {bank ? <TargetField value={bank.viewTarget ?? null} onSave={(target) => onTarget(campaign.id, target)} /> : null}
        </div>
      ))}

      {rows.length > 0 ? (
        <p className="hint new-post-to">
          Read from Postiz about once a day per account. TikTok counts your last 20 videos; Instagram and YouTube the last 7 days. A
          suggestion comes when views per video are up a fifth on last week, or at your number - or down by almost a third.
        </p>
      ) : null}
    </section>
  )
}

/** "Suggest more at [ 1000 ] views a video" - empty to go by the trend only. */
function TargetField({ value, onSave }: { value: number | null; onSave: (target: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  const save = () => {
    const n = Math.round(Number(draft))
    const target = draft.trim() && Number.isFinite(n) && n > 0 ? n : null
    if (target !== value) onSave(target)
    setDraft(target === null ? '' : String(target))
  }
  return (
    <label className="field analytics-target">
      <span className="label">Suggest more a day at</span>
      <span className="analytics-target-row">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="any"
          aria-label="Views a video before more a day"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <span className="hint">views a video</span>
      </span>
      <span className="hint">Empty: it goes by the trend only.</span>
    </label>
  )
}

/** He answered a suggestion: yes sets the batch's videos a day (the batch
 *  follows at once), either way the campaign is left alone a few days. */
export async function answerSuggestion(campaignId: string, to: number | null): Promise<void> {
  rememberAnswer(campaignId)
  if (to === null) return
  const bank = await loadBatchBank(campaignId)
  if (bank) await saveBatchBank({ ...bank, perDay: to })
}

export async function saveTarget(campaignId: string, target: number | null): Promise<void> {
  const bank = await loadBatchBank(campaignId)
  if (bank) await saveBatchBank({ ...bank, viewTarget: target ?? undefined })
}
