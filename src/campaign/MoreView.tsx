// More: what is set up once and changed now and then - campaigns, formats,
// the bank, settings - and the plain cutter. Out of the tab bar so the five
// tabs left are the day's work, each big enough to read (2026-11-02).

import type { ReactNode } from 'react'

import { BatchIcon, CampaignsIcon, ChevronLeft, ChevronRight, FormatsIcon, MotionIcon, PicturesIcon, SettingsIcon, VideosIcon } from './icons'
import type { Tab } from './TabBar'

interface Row {
  tab: Tab
  icon: ReactNode
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
    { tab: 'campaigns', icon: <CampaignsIcon />, name: 'Campaigns', line: `${campaigns} campaign${campaigns === 1 ? '' : 's'} - brand, logo, angles, accounts and posting times` },
    { tab: 'formats', icon: <FormatsIcon />, name: 'Formats', line: 'A script you film again and again, mixed into many videos' },
    { tab: 'motion', icon: <MotionIcon />, name: 'Motion graphics', line: 'Drop in a talking video - Claude plans graphics around what you say' },
    ...(trialReels
      ? [{ tab: 'trial' as const, icon: <BatchIcon />, name: 'Trial reels', line: 'A viral reel made again and again, posted as Instagram Trial Reels' }]
      : []),
    { tab: 'pictures', icon: <PicturesIcon />, name: 'Bank', line: 'Pictures, videos and songs your videos use' },
    { tab: 'settings', icon: <SettingsIcon />, name: 'Settings', line: 'Posting, sign-in, people, the server, video defaults' },
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
              <span className="more-icon">{r.icon}</span>
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
            <span className="more-icon">
              <VideosIcon />
            </span>
            <span className="row-text">
              <span className="row-name">Cut only</span>
              <span className="row-line">The plain cutter: takes the silences out of any video, nothing else</span>
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

