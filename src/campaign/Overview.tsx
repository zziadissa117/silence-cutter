// The top of Analytics (his ask, 2026-11-11, "premium feel"): the week at a
// glance from the posts the server already sends - views over the last 7
// days, how many went out each day, and every post of the week by where it
// stands. No new request: Posts' own list (posting.listPosts / lastPosts).

import { useEffect, useState } from 'react'

import { shortNumber } from './analytics'
import { lastPosts, listPosts, type ServerPost } from './posting'

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

export function Overview() {
  const [posts, setPosts] = useState<ServerPost[]>(() => lastPosts())
  useEffect(() => {
    let alive = true
    void listPosts()
      .then((p) => alive && setPosts(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
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
