// Line icons, one stroke weight, drawn in currentColor - the planner's own
// style, so the two apps read as one kit. No icon font, no package.

import type { ReactNode } from 'react'

function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** A clip: the day's videos. */
export const VideosIcon = () => (
  <Icon>
    <rect x="3.75" y="5.25" width="12.5" height="13.5" rx="2.5" />
    <path d="M16.25 10.25l4-2.5v8.5l-4-2.5" />
  </Icon>
)

/** Crossing arrows: a batch, mixed from the bank. */
export const BatchIcon = () => (
  <Icon>
    <path d="M3.5 7h3.25c2.5 0 3.75 1.25 5.25 5s2.75 5 5.25 5h3.25" />
    <path d="M3.5 17h3.25c1.3 0 2.2-.35 2.95-1.1M14.05 8.1c.75-.75 1.65-1.1 2.95-1.1h3.5" />
    <path d="M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5" />
  </Icon>
)

/** Stacked sheets: campaigns and their angles. */
export const CampaignsIcon = () => (
  <Icon>
    <rect x="4" y="8" width="16" height="12" rx="2.25" />
    <path d="M6.5 5h11M9 2.75h6" />
  </Icon>
)

/** A picture: the picture bank. */
export const PicturesIcon = () => (
  <Icon>
    <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5" />
    <circle cx="9" cy="10" r="1.75" />
    <path d="M4.5 17.5l5-4.5 3.5 3 2.75-2.25 3.75 3.25" />
  </Icon>
)

/** Sliders: settings. */
export const SettingsIcon = () => (
  <Icon>
    <path d="M4.5 7.5h8M17 7.5h2.5M4.5 16.5h2.5M11.5 16.5h8" />
    <circle cx="14.75" cy="7.5" r="2.25" />
    <circle cx="9.25" cy="16.5" r="2.25" />
  </Icon>
)

export const UploadIcon = () => (
  <Icon size={30}>
    <path d="M12 15V4.5M7.75 8.5L12 4.25l4.25 4.25" />
    <path d="M4.5 14.5v2.75a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V14.5" />
  </Icon>
)

export const ChevronRight = () => (
  <Icon size={18}>
    <path d="M9.5 6l6 6-6 6" />
  </Icon>
)

export const ChevronLeft = () => (
  <Icon size={20}>
    <path d="M14.5 6l-6 6 6 6" />
  </Icon>
)

export const ChevronDown = () => (
  <Icon size={18}>
    <path d="M6 9.5l6 6 6-6" />
  </Icon>
)

/** Play the moment, with its captions. */
export const PlayIcon = () => (
  <Icon>
    <path d="M8 5.75v12.5l10-6.25z" />
  </Icon>
)

export const PauseIcon = () => (
  <Icon>
    <path d="M8.5 5.75v12.5M15.5 5.75v12.5" />
  </Icon>
)
