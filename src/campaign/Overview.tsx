// The top of Analytics (his asks, 2026-11-11, "premium feel", and
// 2026-11-14: "change the analytics section for the views for the last
// month, last 30 days, and keep stacking up"): the views of the last 30 days,
// added up day after day on a line that only climbs, and the month's videos
// by where they stand. The days come with the accounts' views
// (posting.listViews, server postiz/month.ts); what is still to go comes from
// Posts' own list. A server from before the month sends none: the week as
// before (weekOf), from the posts.

import { useEffect, useState } from 'react'

import { shortNumber } from './analytics'
import { lastMonth, lastPosts, listPosts, listViews, type MonthDay, type ServerPost } from './posting'

const DAY = 86400e3

const viewsOf = (p: Pick<ServerPost, 'views'>) => Object.values(p.views ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)

/** The week, counted. Exported for the tests. */
export function weekOf(posts: readonly Pick<ServerPost, 'status' | 'postAt' | 'createdAt' | 'views'>[], now = Date.now()) {
  const from = now - 7 * DAY
  const week = posts.filter((p) => Date.parse(p.postAt ?? p.createdAt) >= from && Date.parse(p.postAt ?? p.createdAt) < now + 7 * DAY)
  const out = week.filter((p) => p.status === 'posted' && p.postAt && Date.parse(p.postAt) <= now)
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(now - (6 - i) * DAY)
    start.setHours(0, 0, 0, 0)
    const end = start.getTime() + DAY
    return {
      label: start.toLocaleDateString(undefined, { weekday: 'narrow' }),
      out: out.filter((p) => Date.parse(p.postAt!) >= start.getTime() && Date.parse(p.postAt!) < end).length,
    }
  })
  const counts = {
    posted: out.length,
    scheduled: week.filter((p) => p.status === 'scheduled' || p.status === 'approved').length,
    waiting: week.filter((p) => p.status === 'waiting').length,
    failed: week.filter((p) => p.status === 'error' || p.status === 'failed').length,
  }
  const done = counts.posted + counts.failed
  return {
    views: out.reduce((n, p) => n + viewsOf(p), 0),
    days,
    counts,
    total: counts.posted + counts.scheduled + counts.waiting + counts.failed,
    rate: done > 0 ? Math.round((counts.posted / done) * 100) : null,
  }
}

/** The last 30 days, added up. Exported for the tests. */
export function monthOf(days: readonly MonthDay[], posts: readonly Pick<ServerPost, 'status'>[]) {
  let run = 0
  const total = days.map((d) => (run += Math.max(0, d.views)))
  const posted = days.reduce((n, d) => n + d.posted, 0)
  const failed = days.reduce((n, d) => n + d.failed, 0)
  const best = days.reduce<MonthDay | null>((b, d) => (d.views > 0 && (!b || d.views > b.views) ? d : b), null)
  return {
    views: run,
    /** The views so far on each day, oldest first: it only climbs. */
    total,
    best,
    counts: {
      posted,
      scheduled: posts.filter((p) => p.status === 'scheduled' || p.status === 'approved').length,
      waiting: posts.filter((p) => p.status === 'waiting').length,
      failed,
    },
    rate: posted + failed > 0 ? Math.round((posted / (posted + failed)) * 100) : null,
  }
}

/** "Nov 3" from "2026-11-03". */
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** The views adding up over the month: a line that climbs, filled under. */
function Climb({ total, days }: { total: readonly number[]; days: readonly MonthDay[] }) {
  const W = 300
  const H = 96
  const top = Math.max(1, total[total.length - 1] ?? 0)
  const x = (i: number) => (total.length > 1 ? (i / (total.length - 1)) * W : W / 2)
  const y = (v: number) => H - 4 - (v / top) * (H - 12)
  const line = total.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = total.length - 1
  return (
    <div className="month-climb">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Views adding up over the last ${days.length} days, to ${shortNumber(top)}`}>
        <defs>
          <linearGradient id="month-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#month-fill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="month-dot" style={{ left: `${(x(last) / W) * 100}%`, top: `${(y(total[last] ?? 0) / H) * 100}%` }} aria-hidden />
      <div className="month-ends">
        <span>{days[0] ? dayLabel(days[0].date) : ''}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

export function Overview() {
  const [posts, setPosts] = useState<ServerPost[]>(() => lastPosts())
  const [days, setDays] = useState<MonthDay[] | null>(() => lastMonth())
  useEffect(() => {
    let alive = true
    void listPosts()
      .then((p) => alive && setPosts(p))
      .catch(() => {})
    void listViews()
      .then(() => alive && setDays(lastMonth()))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  if (days) {
    const m = monthOf(days, posts)
    const rows: { key: keyof typeof m.counts; label: string }[] = [
      { key: 'posted', label: 'Posted' },
      { key: 'scheduled', label: 'Scheduled' },
      { key: 'waiting', label: 'To approve' },
      { key: 'failed', label: "Didn't go out" },
    ]
    const today = days[days.length - 1]
    return (
      <>
        <div className="overview-card">
          <span className="eyebrow">Last {days.length} days</span>
          <span className="today-big">
            <span className="hero-number">{shortNumber(m.views)}</span>
            <span className="today-unit">views</span>
          </span>
          <span className="hint month-line">
            {today && today.views > 0 ? `+${shortNumber(today.views)} today` : 'Views come in a day, three days and a week after each video'}
            {m.best ? ` · best day ${dayLabel(m.best.date)}, ${shortNumber(m.best.views)}` : ''}
          </span>
          <Climb total={m.total} days={days} />
        </div>
        <div className="overview-card split">
          <div className="overview-total">
            <span className="hero-number small">{m.counts.posted}</span>
            <span className="hint">videos out in {days.length} days</span>
            {m.rate !== null ? <span className={`rate-pill${m.rate < 80 ? ' low' : ''}`}>{m.rate}% went out</span> : null}
          </div>
          <ul className="overview-rows">
            {rows.map((r) => (
              <li key={r.key}>
                <span className={`tick ${r.key}`} aria-hidden />
                <span className="overview-n">{m.counts[r.key]}</span>
                <span className="hint">{r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </>
    )
  }
  if (posts.length === 0) return null
  const w = weekOf(posts)
  const most = Math.max(1, ...w.days.map((d) => d.out))
  const rows: { key: keyof typeof w.counts; label: string }[] = [
    { key: 'posted', label: 'Posted' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'waiting', label: 'To approve' },
    { key: 'failed', label: 'Failed' },
  ]
  return (
    <>
      <div className="overview-card">
        <span className="eyebrow">Last 7 days</span>
        <span className="today-big">
          <span className="hero-number">{shortNumber(w.views)}</span>
          <span className="today-unit">views</span>
        </span>
        <div className="week-bars" role="img" aria-label={`Videos out each day: ${w.days.map((d) => d.out).join(', ')}`}>
          {w.days.map((d, i) => (
            <span key={i} className="week-bar">
              <span className="week-bar-fill" style={{ height: `${Math.max(6, (d.out / most) * 100)}%` }} data-empty={d.out === 0 || undefined} />
              <span className="week-bar-label">{d.label}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="overview-card split">
        <div className="overview-total">
          <span className="hero-number small">{w.total}</span>
          <span className="hint">videos this week</span>
          {w.rate !== null ? <span className={`rate-pill${w.rate < 80 ? ' low' : ''}`}>{w.rate}% went out</span> : null}
        </div>
        <ul className="overview-rows">
          {rows.map((r) => (
            <li key={r.key}>
              <span className={`tick ${r.key}`} aria-hidden />
              <span className="overview-n">{w.counts[r.key]}</span>
              <span className="hint">{r.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
