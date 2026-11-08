// The Analytics tab's tracking: when videos do best, as a week of hours, and
// what works in each batch campaign - its headlines, reactions, songs and
// headline looks, best first, as bars of views a video. His words
// (2026-11-01): "very, very tracking-oriented, with a very visible graph of
// the best hooks. We see what works and what does not work", and a "Use the
// best hooks" button (batchFavour.ts).

import { useState } from 'react'

import { type DeadAccount } from '../../supabase/functions/postiz/deadAccounts.ts'
import { accountLabel } from './posting'

import { bestRuns, dayOfWeek, type BestHours } from '../../supabase/functions/postiz/bestHours.ts'
import type { CampaignHooks, HookKind, HookRow } from '../../supabase/functions/postiz/hookInsights.ts'
import { shortNumber } from './analytics'
import { todayHere, type BatchBank } from './batch'
import { anyFavour, favourFrom } from './batchFavour'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Monday first, as a week reads. */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

export function hourLabel(hour: number): string {
  const h = hour % 24
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
}

const runsText = (day: readonly number[]) =>
  bestRuns(day)
    .map((r) => `${hourLabel(r.from)} - ${hourLabel(r.to)}`)
    .join(', ')

/** The week's hours: darker where more of the day's videos go. Tap an hour
 *  for its number. */
export function BestHoursCard({ best, onOff }: { best: BestHours | null | undefined; onOff: (off: boolean) => void }) {
  const [picked, setPicked] = useState<{ day: number; hour: number } | null>(null)
  const learnt = best && best.weights.length === 7
  const today = dayOfWeek(todayHere())
  return (
    <div className="group analytics-campaign">
      <div className="analytics-head">
        <span className="group-title">When to post</span>
        {learnt ? (
          <button type="button" className="linkbtn" onClick={() => onOff(!best.off)}>
            {best.off ? 'Turn on' : 'Turn off'}
          </button>
        ) : null}
      </div>
      {!learnt ? (
        <p className="hint">
          Learning from your views: it needs 150 videos at least 3 days old with their views read
          {best?.videos ? ` - ${best.videos} so far` : ''}. Until then every day stays evenly spread.
        </p>
      ) : (
        <>
          <p className="hint">
            {best.off
              ? 'Off: every day is evenly spread around the clock.'
              : `Still spread around the clock, with up to twice as many at each day's best hours and never back to back. Today, most at ${runsText(best.weights[today]) || 'no hour in particular'}.`}
          </p>
          <div className={`heat${best.off ? ' off' : ''}`} role="table" aria-label="How many of the day's videos go at each hour">
            <div className="heat-row heat-hours" role="row">
              <span className="heat-day" />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="heat-hour" role="columnheader">
                  {h % 6 === 0 ? hourLabel(h).replace(' ', '') : ''}
                </span>
              ))}
            </div>
            {WEEK.map((d) => (
              <div key={d} className={`heat-row${d === today ? ' today' : ''}`} role="row">
                <span className="heat-day" role="rowheader">
                  {DAYS[d]}
                </span>
                {best.weights[d].map((w, h) => (
                  <button
                    key={h}
                    type="button"
                    role="cell"
                    className={`heat-cell${picked?.day === d && picked.hour === h ? ' picked' : ''}`}
                    style={{ opacity: 0.12 + 0.88 * Math.min(1, Math.max(0, (w - 0.5) / 1.5)) }}
                    aria-label={`${DAY_NAMES[d]} ${hourLabel(h)}: ${w.toFixed(1)} times the day's usual`}
                    onClick={() => setPicked({ day: d, hour: h })}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="hint">
            {picked
              ? `${DAY_NAMES[picked.day]} ${hourLabel(picked.hour)}: ${best.weights[picked.day][picked.hour].toFixed(1)}× the day's usual number of videos.`
              : `From ${best.videos} videos' views. Tap an hour for its number.`}
          </p>
        </>
      )}
    </div>
  )
}

const KINDS: { kind: HookKind; title: string; none: string }[] = [
  { kind: 'headline', title: 'Headlines', none: 'No headline videos with views yet.' },
  { kind: 'reaction', title: 'Reactions', none: 'No reactions with views yet.' },
  { kind: 'song', title: 'Songs', none: 'Songs are counted from videos made from Nov 1 on - their numbers come 3 days after they post.' },
  { kind: 'look', title: 'Headline looks', none: 'Only one look so far.' },
]

/** How many lines show before "Show all". */
const SHOWN = 5

/** One kind's bars: views a video, best first. */
function Bars({ rows, none }: { rows: HookRow[]; none: string }) {
  const [all, setAll] = useState(false)
  if (rows.length === 0) return <p className="hint">{none}</p>
  const most = Math.max(...rows.map((r) => r.views), 1)
  const shown = all || rows.length <= SHOWN + 1 ? rows : [...rows.slice(0, SHOWN - 1), rows[rows.length - 1]]
  return (
    <>
      <ul className="bars">
        {shown.map((r, i) => (
          <li key={r.key} className={`bar-row${r.mark ? ` ${r.mark}` : ''}`}>
            {!all && rows.length > SHOWN + 1 && i === SHOWN - 1 ? <span className="bar-gap">…</span> : null}
            <div className="bar-label">
              <span className="bar-name">{r.label}</span>
              {r.mark ? <span className={`bar-mark ${r.mark}`}>{r.mark === 'best' ? '★ Best' : 'Worst'}</span> : null}
            </div>
            <div className="bar-line">
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.max(2, (r.views / most) * 100)}%` }} />
              </span>
              <span className="bar-value">
                {shortNumber(r.views)} <span className="hint">· {r.videos} video{r.videos === 1 ? '' : 's'}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN + 1 ? (
        <button type="button" className="linkbtn" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      ) : null}
    </>
  )
}

/** Accounts whose videos suddenly stopped getting views - most often a
 *  shadowban (postiz/deadAccounts.ts) - each with a Pause. */
export function TroubleCard({
  accounts,
  paused,
  onPause,
  known = [],
}: {
  accounts: readonly DeadAccount[]
  /** The profile's accounts, for the usernames of those the server named only. */
  known?: readonly { id: string; profile?: string }[]
  /** Account ids paused now. */
  paused: ReadonlySet<string>
  onPause: (accountId: string, paused: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (accounts.length === 0) return null
  const tap = (id: string, pause: boolean) => {
    setBusy(id)
    setProblem(null)
    void onPause(id, pause)
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(null))
  }
  return (
    <div className="group analytics-campaign trouble">
      <div className="group-title">Accounts that stopped getting views</div>
      <p className="hint">Most often a shadowban. Check the account in its app; pausing holds its videos until you resume.</p>
      <ul className="trouble-list">
        {accounts.map((a) => (
          <li key={a.id} className="trouble-row">
            <div>
              <div className="label">
                {accountLabel({ ...a, profile: a.profile ?? known.find((k) => k.id === a.id)?.profile })}
              </div>
              <div className="hint">
                About {shortNumber(a.recent)} views a video lately - it usually gets {shortNumber(a.usual)}.
              </div>
            </div>
            <button type="button" className={`btn small${paused.has(a.id) ? '' : ' primary'}`} disabled={busy === a.id} onClick={() => tap(a.id, !paused.has(a.id))}>
              {busy === a.id ? '…' : paused.has(a.id) ? 'Resume' : 'Pause'}
            </button>
          </li>
        ))}
      </ul>
      {problem ? <p className="hint warn">{problem}</p> : null}
    </div>
  )
}

/** "Write more like the best": Claude's new headlines in the style of the
 *  campaign's best (postiz/headlineIdeas.ts), each added with a tap. */
function HeadlineIdeas({ onIdeas, onAdd }: { onIdeas: () => Promise<{ headlines: string[]; error?: string }>; onAdd: (headline: string) => Promise<void> }) {
  const [ideas, setIdeas] = useState<string[] | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ask = () => {
    setWorking(true)
    setProblem(null)
    void onIdeas()
      .then((got) => {
        setIdeas(got.headlines)
        setAdded(new Set())
        if (got.error) setProblem(got.error)
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setWorking(false))
  }
  const add = (headline: string) => {
    setAdded((a) => new Set(a).add(headline))
    void onAdd(headline).catch((error: unknown) => {
      setAdded((a) => {
        const rest = new Set(a)
        rest.delete(headline)
        return rest
      })
      setProblem(error instanceof Error ? error.message : String(error))
    })
  }
  return (
    <div className="ideas">
      <button type="button" className="btn small" disabled={working} onClick={ask}>
        {working ? 'Writing…' : ideas ? 'Write others' : 'Write more like the best'}
      </button>
      {ideas && ideas.length > 0 ? (
        <ul className="ideas-list">
          {ideas.map((idea) => (
            <li key={idea} className="idea-row">
              <span className="idea-text">{idea}</span>
              <button type="button" className="btn small" disabled={added.has(idea)} onClick={() => add(idea)}>
                {added.has(idea) ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? <p className="hint warn">{problem}</p> : null}
    </div>
  )
}

/** A campaign's "what works": each kind's bars, and the button that makes
 *  more videos with the best. */
export function WhatWorks({
  hooks,
  bank,
  onUseBest,
  onIdeas,
  onAddHeadline,
}: {
  hooks: CampaignHooks | undefined
  bank: BatchBank
  onUseBest: (on: boolean) => void
  /** Claude's new headlines like the best, and one of them added to the batch. */
  onIdeas?: () => Promise<{ headlines: string[]; error?: string }>
  onAddHeadline?: (headline: string) => Promise<void>
}) {
  if (!hooks) {
    return <p className="hint">What works shows here once this campaign's batch videos are 3 days old and their views are read.</p>
  }
  const favour = favourFrom(hooks)
  const can = anyFavour(favour)
  return (
    <div className="what-works">
      <div className="label">What works · views a video</div>
      <p className="hint">
        From {hooks.videos} videos in the last 30 days, at least 3 days old. Average {shortNumber(hooks.views)}.
      </p>
      {bank.useBest ? (
        <div className="analytics-suggestion">
          <div className="label">Using the best hooks</div>
          <div className="hint">
            The ones marked ★ Best go into twice as many of the new videos, and it follows the numbers as they change. Each different video is still made only
            once.
          </div>
          <div className="actions-row">
            <button type="button" className="btn small" onClick={() => onUseBest(false)}>
              Back to even
            </button>
          </div>
        </div>
      ) : (
        <div className="actions-row">
          <button type="button" className="btn small primary" disabled={!can} onClick={() => onUseBest(true)}>
            Use the best hooks
          </button>
          {!can ? <span className="hint">Nothing stands out yet - a few more videos first.</span> : null}
        </div>
      )}
      {KINDS.map(({ kind, title, none }) => (
        <div key={kind} className="what-kind">
          <div className="what-title">{title}</div>
          <Bars rows={hooks.rows[kind]} none={none} />
          {kind === 'headline' && onIdeas && onAddHeadline ? <HeadlineIdeas onIdeas={onIdeas} onAdd={onAddHeadline} /> : null}
        </div>
      ))}
    </div>
  )
}
