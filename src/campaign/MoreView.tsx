// More: what is set up once and changed now and then - campaigns, formats,
// the bank, settings - and the plain cutter. Out of the tab bar so the five
// tabs left are the day's work, each big enough to read (2026-11-02).

import type { ReactNode } from 'react'

import { BatchIcon, CampaignsIcon, ChevronLeft, ChevronRight, FormatsIcon, MotionIcon, PicturesIcon, SettingsIcon, VideosIcon } from './icons'
import type { Tab } from './TabBar'

interface Row {
  tab: Tab
  icon: ReactNode
  /** Its icon tile's colour. */
  hue: number
  name: string
  line: string
}

export function MoreView({
  campaigns,
  onOpen,
  workToLose,
  trialReels = false,
}: {
  /** How many campaigns there are, to say so. */
  campaigns: number
  /** Trial reels are on for this login (postiz profile `trialReels`). */
  trialReels?: boolean
  onOpen: (tab: Tab) => void
  /** What leaving for the plain cutter would stop, if anything. */
  workToLose: () => Promise<string | null>
}) {
  const rows: Row[] = [
    { tab: 'campaigns', icon: <CampaignsIcon />, hue: 258, name: 'Campaigns', line: `${campaigns} campaign${campaigns === 1 ? '' : 's'} · brands, accounts, times` },
    { tab: 'formats', icon: <FormatsIcon />, hue: 200, name: 'Formats', line: 'One script, mixed into many videos' },
    { tab: 'motion', icon: <MotionIcon />, hue: 320, name: 'Motion graphics', line: 'Claude plans graphics around you' },
    ...(trialReels ? [{ tab: 'trial' as const, icon: <BatchIcon />, hue: 25, name: 'Trial reels', line: 'Viral reels for people who don’t follow you' }] : []),
    { tab: 'warmups', icon: <VideosIcon />, hue: 150, name: 'Warm-ups', line: 'Quick posts that keep accounts warm' },
    { tab: 'pictures', icon: <PicturesIcon />, hue: 45, name: 'Bank', line: 'Pictures, videos and songs' },
    { tab: 'settings', icon: <SettingsIcon />, hue: 230, name: 'Settings', line: 'Posting, people, server, defaults' },
  ]
  const leave = async () => {
    const warning = await workToLose().catch(() => null)
    if (warning && !window.confirm(warning)) return
    window.location.href = '/#cut'
  }
  return (
    <section className="screen more">
      <div className="screen-head">
        <h1>More</h1>
      </div>
      <div className="brand-line">
        <img src="/ugc-roadmap-192.png" alt="" width={40} height={40} />
        <span>
          <span className="row-name">UGC Roadmap</span>
          <span className="row-line">The Cutter</span>
        </span>
      </div>
      <ul className="rows group more-rows">
        {rows.map((r) => (
          <li key={r.tab}>
            <button type="button" className="row-link" onClick={() => onOpen(r.tab)}>
              <span className="more-icon" style={{ ['--hue' as string]: String(r.hue) }}>
                {r.icon}
              </span>
              <span className="row-text">
                <span className="row-name">{r.name}</span>
                <span className="row-line">{r.line}</span>
              </span>
              <ChevronRight />
            </button>
          </li>
        ))}
      </ul>
      <ul className="rows group more-rows">
        <li>
          <button type="button" className="row-link" onClick={() => void leave()}>
            <span className="more-icon" style={{ ['--hue' as string]: '0' }}>
              <VideosIcon />
            </span>
            <span className="row-text">
              <span className="row-name">Cut only</span>
              <span className="row-line">Just take the silences out</span>
            </span>
            <ChevronRight />
          </button>
        </li>
      </ul>
    </section>
  )
}

/** "‹ More" at the top of a screen reached from More. */
export function BackToMore({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="back" onClick={onBack}>
      <ChevronLeft /> More
    </button>
  )
}

