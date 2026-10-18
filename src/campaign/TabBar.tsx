// The tab bar along the bottom - the planner's, with its line icons - so
// the day's work and the setting up each have their own place, one tap
// apart.

import type { ReactNode } from 'react'

import { AnalyticsIcon, BatchIcon, CampaignsIcon, FormatsIcon, PicturesIcon, SettingsIcon, VideosIcon } from './icons'

export type Tab = 'videos' | 'formats' | 'batch' | 'analytics' | 'campaigns' | 'pictures' | 'settings'

const TABS: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'videos', label: 'Videos', icon: <VideosIcon /> },
  { tab: 'formats', label: 'Formats', icon: <FormatsIcon /> },
  { tab: 'batch', label: 'Batch', icon: <BatchIcon /> },
  { tab: 'analytics', label: 'Analytics', icon: <AnalyticsIcon /> },
  { tab: 'campaigns', label: 'Campaigns', icon: <CampaignsIcon /> },
  { tab: 'pictures', label: 'Bank', icon: <PicturesIcon /> },
  { tab: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

/** `dots`: tabs with something waiting for him - a suggestion to answer. */
export function TabBar({ tab, onTab, dots = {} }: { tab: Tab; onTab: (tab: Tab) => void; dots?: Partial<Record<Tab, boolean>> }) {
  return (
    <nav className="tabbar" aria-label="Campaign videos">
      {TABS.map((t) => (
        <button
          key={t.tab}
          type="button"
          className={t.tab === tab ? 'active' : ''}
          aria-current={t.tab === tab ? 'page' : undefined}
          onClick={() => {
            onTab(t.tab)
            window.scrollTo({ top: 0 })
          }}
        >
          <span className="tab-icon">
            {t.icon}
            {dots[t.tab] ? <span className="tab-dot" aria-label="Something to answer" /> : null}
          </span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
