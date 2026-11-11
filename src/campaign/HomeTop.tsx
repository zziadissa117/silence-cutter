// The top of the Videos tab (his ask, 2026-11-11: "the cutter just looks like
// an old app ... it does not have a premium feel"): who is signed in and
// whether it is shared, the day at a glance - what goes out today, what waits
// for him - the two things he does most as big tiles, and his campaigns as a
// row of brand badges.

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { Campaign } from './look'
import { lastPosts, type ServerPost } from './posting'

const greeting = (hour: number) => (hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')

/** A colour of its own for a name, steady from one visit to the next. */
export function hueOf(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function HomeHeader({ name, sync, warn, onSync }: { name: string; sync: string; warn: boolean; onSync: () => void }) {
  const first = name.trim() || 'You'
  return (
    <header className="home-head">
      <span className="home-avatar" aria-hidden style={{ ['--hue' as string]: String(hueOf(first)) }}>
        {first.slice(0, 1).toUpperCase()}
      </span>
      <span className="home-hello">
        <span className="eyebrow">{greeting(new Date().getHours())}</span>
        <span className="home-name">{first}</span>
      </span>
      <button type="button" className={`sync-chip${warn ? ' warn' : ''}`} onClick={onSync}>
        <span className="sync-dot" aria-hidden />
        {sync}
      </button>
    </header>
  )
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Today's posts: what went out, what is set to go, what waits for him. */
export function dayOf(posts: readonly Pick<ServerPost, 'status' | 'postAt'>[], now = new Date()) {
  const today = posts.filter((p) => p.postAt && sameDay(new Date(p.postAt), now))
  return {
    out: today.filter((p) => p.status === 'posted').length,
    going: today.filter((p) => p.status === 'scheduled' || p.status === 'approved').length,
    waiting: posts.filter((p) => p.status === 'waiting').length,
    failed: posts.filter((p) => p.status === 'error' && p.postAt && Date.now() - Date.parse(p.postAt) < 2 * 86400e3).length,
  }
}

export function TodayCard({ toApprove, onPosts }: { toApprove: number; onPosts: () => void }) {
  // Read again whenever the count he sees on the tab changes.
  const posts = useMemo(() => lastPosts(), [toApprove]) // eslint-disable-line react-hooks/exhaustive-deps
  const day = dayOf(posts)
  const total = day.out + day.going
  return (
    <button type="button" className="today-card" onClick={onPosts}>
      <span className="eyebrow">Today</span>
      <span className="today-big">
        <span className="hero-number">{total}</span>
        <span className="today-unit">video{total === 1 ? '' : 's'} going out</span>
      </span>
      <span className="stat-row">
        <span className="stat-pill">
          <span className="stat-dot posted" aria-hidden />
          {day.out} out
        </span>
        <span className="stat-pill">
          <span className="stat-dot scheduled" aria-hidden />
          {day.going} scheduled
        </span>
        <span className={`stat-pill${day.waiting > 0 ? ' lit' : ''}`}>
          <span className="stat-dot waiting" aria-hidden />
          {day.waiting} to approve
        </span>
        {day.failed > 0 ? (
          <span className="stat-pill bad">
            <span className="stat-dot failed" aria-hidden />
            {day.failed} failed
          </span>
        ) : null}
      </span>
    </button>
  )
}

/** The two things he does every day, side by side. */
export function ActionTiles({ onRecord, add }: { onRecord: () => void; add: ReactNode }) {
  return (
    <div className="action-tiles">
      <button type="button" className="action-tile record" onClick={onRecord}>
        <span className="tile-icon" aria-hidden>
          <span className="record-dot" />
        </span>
        <span className="tile-title">Record</span>
        <span className="tile-sub">Film in the Cutter</span>
      </button>
      {add}
    </div>
  )
}

/** A campaign's badge: its logo, or its first letter on a colour of its own. */
function Badge({ campaign }: { campaign: Campaign }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!campaign.logo) return
    const made = URL.createObjectURL(campaign.logo)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [campaign.logo])
  const name = campaign.name || 'Campaign'
  return (
    <span className="brand-badge" style={{ ['--hue' as string]: String(hueOf(name)) }}>
      {url ? <img src={url} alt="" /> : <span aria-hidden>{name.slice(0, 1).toUpperCase()}</span>}
    </span>
  )
}

export function CampaignRow({ campaigns, onOpen, onAll }: { campaigns: readonly Campaign[]; onOpen: (c: Campaign) => void; onAll: () => void }) {
  if (campaigns.length === 0) return null
  return (
    <section className="home-section">
      <div className="section-head">
        <h2 className="section-title">Your campaigns</h2>
        <button type="button" className="see-all" onClick={onAll}>
          See all
        </button>
      </div>
      <div className="brand-row">
        {campaigns.map((c) => (
          <button key={c.id} type="button" className="brand-item" onClick={() => onOpen(c)}>
            <Badge campaign={c} />
            <span className="brand-name">{c.name || 'Campaign'}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
