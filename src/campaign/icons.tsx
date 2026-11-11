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

/** A paper plane: the posts going out. */
export const PostsIcon = () => (
  <Icon>
    <path d="M20.5 3.5L3.5 10.5l7 2.5 2.5 7 7.5-16.5z" />
    <path d="M10.5 13l4-4" />
  </Icon>
)

/** A curved arrow back: undo. */
export const UndoIcon = () => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </Icon>
)

/** A curved arrow on: redo. */
export const RedoIcon = () => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
  </Icon>
)

/** Four corners out: full screen. */
export const FullIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
)

/** Three dots: everything else. */
export const MoreIcon = () => (
  <Icon>
    <circle cx="5.5" cy="12" r="1.25" />
    <circle cx="12" cy="12" r="1.25" />
    <circle cx="18.5" cy="12" r="1.25" />
  </Icon>
)

/** A clip: the day's videos. */
export const VideosIcon = () => (
  <Icon>
    <rect x="3.75" y="5.25" width="12.5" height="13.5" rx="2.5" />
    <path d="M16.25 10.25l4-2.5v8.5l-4-2.5" />
  </Icon>
)

/** Stacked cards: one format, filmed again and again. */
export const FormatsIcon = () => (
  <Icon>
    <rect x="6.25" y="7.75" width="11.5" height="12.5" rx="2.25" />
    <path d="M8.25 4.75h7.5a2 2 0 0 1 2 2" opacity="0.9" />
    <path d="M10.75 11.75v5l4-2.5z" />
  </Icon>
)

/** Rising bars: how the videos are doing. */
export const AnalyticsIcon = () => (
  <Icon>
    <path d="M4.5 19.5h15" />
    <rect x="5.75" y="12.5" width="3" height="5" rx="1" />
    <rect x="10.5" y="8.75" width="3" height="8.75" rx="1" />
    <rect x="15.25" y="5" width="3" height="12.5" rx="1" />
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

/** A frame with a card and a sparkle: motion graphics. */
export const MotionIcon = () => (
  <Icon>
    <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5" />
    <rect x="6.75" y="8" width="6.5" height="4.5" rx="1" />
    <path d="M6.75 15.5h10.5" />
    <path d="M16.5 7.5v3M15 9h3" />
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

/** A post waiting for its time: a clock whose minute hand ticks round
 *  (campaign.css .sched-clock). Blue is the scheduled colour. */
export const ScheduledIcon = () => (
  <span className="sched-clock" role="img" aria-label="Scheduled">
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12h3.5" />
      <path className="hand" d="M12 12V5.5" />
    </svg>
  </span>
)

/** Row controls: a cross, plus, minus and the two arrows - line icons in
 *  place of the glyphs (✕ ＋ − ↑ ↓) the rows used to draw. */
export const CloseIcon = () => (
  <Icon size={18}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon size={18}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
)

export const ArrowUpIcon = () => (
  <Icon size={18}>
    <path d="M12 18.5v-13M6.5 11l5.5-5.5 5.5 5.5" />
  </Icon>
)

export const ArrowDownIcon = () => (
  <Icon size={18}>
    <path d="M12 5.5v13M6.5 13l5.5 5.5 5.5-5.5" />
  </Icon>
)

export const MinusIcon = () => (
  <Icon size={18}>
    <path d="M5.5 12h13" />
  </Icon>
)

/** Settings' section marks (2026-11-11). */
export const MicIcon = () => (
  <Icon>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.75 11.5a6.25 6.25 0 0 0 12.5 0M12 17.75v2.75" />
  </Icon>
)

export const ScissorsIcon = () => (
  <Icon>
    <circle cx="6.5" cy="7" r="2.5" />
    <circle cx="6.5" cy="17" r="2.5" />
    <path d="M8.6 8.4L19.5 17.5M8.6 15.6L19.5 6.5" />
  </Icon>
)

export const CaptionsIcon = () => (
  <Icon>
    <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
    <path d="M7.5 12.5h3M13.5 12.5h3M7.5 15.25h9" />
  </Icon>
)

export const SparkIcon = () => (
  <Icon>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
    <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Icon>
)

export const ServerIcon = () => (
  <Icon>
    <rect x="4" y="4.5" width="16" height="6" rx="2" />
    <rect x="4" y="13.5" width="16" height="6" rx="2" />
    <path d="M7.5 7.5h.01M7.5 16.5h.01" />
  </Icon>
)

export const PeopleIcon = () => (
  <Icon>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.75 19c.6-3 2.7-4.75 5.25-4.75S13.65 16 14.25 19" />
    <path d="M15.5 6a3 3 0 0 1 0 5.5M17.5 14.5c1.4.6 2.4 2 2.75 4.5" />
  </Icon>
)

export const PaletteIcon = () => (
  <Icon>
    <path d="M12 3.75a8.25 8.25 0 1 0 0 16.5c1.2 0 1.75-.75 1.75-1.6 0-1.5-1.5-1.9-1.5-3.15 0-.9.7-1.5 1.6-1.5h2.15A3.75 3.75 0 0 0 20.25 10.25C20.25 6.6 16.6 3.75 12 3.75z" />
    <circle cx="7.75" cy="11" r="1" />
    <circle cx="10.25" cy="7.5" r="1" />
    <circle cx="14.5" cy="7.5" r="1" />
  </Icon>
)

export const StorageIcon = () => (
  <Icon>
    <ellipse cx="12" cy="6.5" rx="7" ry="2.75" />
    <path d="M5 6.5v11c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75v-11M5 12c0 1.5 3.1 2.75 7 2.75S19 13.5 19 12" />
  </Icon>
)

export const MusicIcon = () => (
  <Icon>
    <path d="M9 17.5V6l10-2v11.5" />
    <circle cx="6.75" cy="17.5" r="2.25" />
    <circle cx="16.75" cy="15.5" r="2.25" />
  </Icon>
)

export const HookIcon = () => (
  <Icon>
    <path d="M13 3.5L5.5 13.25h5.75L10.5 20.5 18.5 10.5h-5.75z" />
  </Icon>
)
