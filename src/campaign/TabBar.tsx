// The tab bar along the bottom - the planner's, with its line icons. Five
// tabs, what he does every day: make videos, approve and follow posts, the
// batch, the numbers - and More for what is set up once (campaigns, formats,
// the bank, settings). Seven side by side were too small to read, and Batch
// beside Bank was easy to mix up (2026-11-02, "a million different types of
// things").

import type { ReactNode } from 'react'

import { AnalyticsIcon, BatchIcon, MoreIcon, PostsIcon, TribeIcon, VideosIcon } from './icons'

export type Tab = 'videos' | 'posts' | 'formats' | 'batch' | 'analytics' | 'campaigns' | 'pictures' | 'settings' | 'more' | 'trial' | 'motion' | 'warmups' | 'variations' | 'tribe'

/** The screens reached from More: the More tab stays lit on them. */
export const UNDER_MORE: readonly Tab[] = ['more', 'campaigns', 'formats', 'pictures', 'settings', 'trial', 'motion', 'warmups', 'variations']

const TABS: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'videos', label: 'Videos', icon: <VideosIcon /> },
  { tab: 'posts', label: 'Posts', icon: <PostsIcon /> },
  { tab: 'batch', label: 'Batch', icon: <BatchIcon /> },
  { tab: 'analytics', label: 'Analytics', icon: <AnalyticsIcon /> },
  { tab: 'more', label: 'More', icon: <MoreIcon /> },
]

/** Tribe's tab, beside Batch, once Tribe is turned on in Settings (tribe.ts). */
const TRIBE_TAB = { tab: 'tribe' as const, label: 'Trybe', icon: <TribeIcon /> }

/** `dots`: tabs with something waiting for him - a suggestion to answer.
 *  `counts`: how many, shown on the tab (posts to approve). */
export function TabBar({
  tab,
  onTab,
  dots = {},
  counts = {},
  tribe = false,
}: {
  /** Tribe's tab shown (Settings, Tribe). */
  tribe?: boolean
  tab: Tab
  onTab: (tab: Tab) => void
  dots?: Partial<Record<Tab, boolean>>
  counts?: Partial<Record<Tab, number>>
}) {
  const lit = UNDER_MORE.includes(tab) ? 'more' : tab
  return (
    <nav className="tabbar" aria-label="Campaign videos">
      {(tribe ? [...TABS.slice(0, 3), TRIBE_TAB, ...TABS.slice(3)] : TABS).map((t) => {
        const count = counts[t.tab] ?? 0
        return (
          <button
            key={t.tab}
            type="button"
            className={t.tab === lit ? 'active' : ''}
            aria-current={t.tab === lit ? 'page' : undefined}
            aria-label={count > 0 ? `${t.label}, ${count} to approve` : t.label}
            onClick={() => {
              onTab(t.tab)
              window.scrollTo({ top: 0 })
            }}
          >
            <span className="tab-icon">
              {t.icon}
              {count > 0 ? (
                <span className="tab-count" aria-hidden>
                  {count > 99 ? '99+' : count}
                </span>
              ) : dots[t.tab] ? (
                <span className="tab-dot" aria-label="Something to answer" />
              ) : null}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
