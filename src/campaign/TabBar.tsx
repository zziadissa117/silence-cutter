// The tab bar along the bottom - the planner's, with its line icons - so
// the day's work and the setting up each have their own place, one tap
// apart.

import type { ReactNode } from 'react'

import { BatchIcon, CampaignsIcon, PicturesIcon, SettingsIcon, VideosIcon } from './icons'

export type Tab = 'videos' | 'batch' | 'campaigns' | 'pictures' | 'settings'

const TABS: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'videos', label: 'Videos', icon: <VideosIcon /> },
  { tab: 'batch', label: 'Batch', icon: <BatchIcon /> },
  { tab: 'campaigns', label: 'Campaigns', icon: <CampaignsIcon /> },
  { tab: 'pictures', label: 'Pictures', icon: <PicturesIcon /> },
  { tab: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
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
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
