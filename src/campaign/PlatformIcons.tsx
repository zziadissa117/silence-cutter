// The accounts a post goes to, as the platforms' own marks - TikTok,
// Instagram, YouTube, Facebook - instead of a line of usernames (his ask,
// 2026-11-13: "Why can't you just put the logos ... You have to put the
// whole username. It's so much slop"). The usernames are still there: on a
// long press / hover (title) and for screen readers, and in full once the
// post is opened.

import { accountLabel, platformName } from './posting'

type Account = { id?: string; name: string; platform: string; profile?: string; held?: unknown }

/** The platform a Postiz provider id belongs to, for its mark. */
export function platformOf(platform: string): 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'x' | 'threads' | 'linkedin' | 'other' {
  const p = platform.toLowerCase()
  if (p.startsWith('tiktok')) return 'tiktok'
  if (p.startsWith('instagram')) return 'instagram'
  if (p.startsWith('youtube')) return 'youtube'
  if (p.startsWith('facebook')) return 'facebook'
  if (p === 'x' || p.startsWith('twitter')) return 'x'
  if (p.startsWith('threads')) return 'threads'
  if (p.startsWith('linkedin')) return 'linkedin'
  return 'other'
}

const ORDER = ['tiktok', 'instagram', 'youtube', 'facebook', 'x', 'threads', 'linkedin', 'other'] as const

export function PlatformMark({ platform, size = 20 }: { platform: string; size?: number }) {
  const kind = platformOf(platform)
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const, focusable: 'false' as const }
  switch (kind) {
    case 'tiktok':
      return (
        <svg {...common} className="pmark tiktok">
          <rect width="24" height="24" rx="6" fill="#000" />
          <path
            d="M16.6 5.5c.4 1.6 1.5 2.7 3 2.9v2.6c-1.1 0-2.1-.3-3-.9v5.2a4.6 4.6 0 1 1-4.6-4.6h.4v2.6h-.4a2 2 0 1 0 2 2V5.5h2.6z"
            fill="#25F4EE"
            transform="translate(-.6 -.4)"
          />
          <path
            d="M16.6 5.5c.4 1.6 1.5 2.7 3 2.9v2.6c-1.1 0-2.1-.3-3-.9v5.2a4.6 4.6 0 1 1-4.6-4.6h.4v2.6h-.4a2 2 0 1 0 2 2V5.5h2.6z"
            fill="#FE2C55"
            transform="translate(.6 .4)"
          />
          <path d="M16.6 5.5c.4 1.6 1.5 2.7 3 2.9v2.6c-1.1 0-2.1-.3-3-.9v5.2a4.6 4.6 0 1 1-4.6-4.6h.4v2.6h-.4a2 2 0 1 0 2 2V5.5h2.6z" fill="#fff" />
        </svg>
      )
    case 'instagram':
      return (
        <svg {...common} className="pmark instagram">
          <defs>
            <radialGradient id="pmark-ig" cx="30%" cy="107%" r="150%">
              <stop offset="0" stopColor="#fdf497" />
              <stop offset=".1" stopColor="#fdf497" />
              <stop offset=".5" stopColor="#fd5949" />
              <stop offset=".68" stopColor="#d6249f" />
              <stop offset="1" stopColor="#285AEB" />
            </radialGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#pmark-ig)" />
          <rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="16" cy="8" r="1" fill="#fff" />
        </svg>
      )
    case 'youtube':
      return (
        <svg {...common} className="pmark youtube">
          <rect y="3.5" width="24" height="17" rx="5" fill="#FF0000" />
          <path d="M9.6 8.3v7.4l6.4-3.7z" fill="#fff" />
        </svg>
      )
    case 'facebook':
      return (
        <svg {...common} className="pmark facebook">
          <circle cx="12" cy="12" r="12" fill="#1877F2" />
          <path d="M13.4 24v-8.4h2.8l.4-3.3h-3.2v-2.1c0-.9.3-1.6 1.6-1.6h1.7V5.7c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.2v3.3H10V24z" fill="#fff" />
        </svg>
      )
    case 'x':
      return (
        <svg {...common} className="pmark x">
          <rect width="24" height="24" rx="6" fill="#000" />
          <path d="M6 6h3.6l3 4.2L16.3 6h1.6l-4.6 5.2L18.4 18h-3.6l-3.2-4.5L7.6 18H6l4.9-5.6z" fill="#fff" />
        </svg>
      )
    default: {
      const letters = kind === 'threads' ? '@' : kind === 'linkedin' ? 'in' : platformName(platform).slice(0, 2)
      return (
        <svg {...common} className="pmark other">
          <rect width="24" height="24" rx="6" fill={kind === 'linkedin' ? '#0A66C2' : '#555'} />
          <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
            {letters}
          </text>
        </svg>
      )
    }
  }
}

/** One mark per platform the post goes to, in a fixed order, with how many
 *  accounts when it is more than one there. An account held back (paused,
 *  today's limit) is shown faded. */
export function PlatformIcons({ accounts, size = 20 }: { accounts: readonly Account[]; size?: number }) {
  const groups = new Map<string, Account[]>()
  for (const a of accounts) {
    const kind = platformOf(a.platform)
    groups.set(kind, [...(groups.get(kind) ?? []), a])
  }
  const kinds = ORDER.filter((k) => groups.has(k))
  if (kinds.length === 0) return null
  const all = accounts.map(accountLabel).join(', ')
  return (
    <span className="pmarks" role="img" aria-label={all} title={all}>
      {kinds.map((kind) => {
        const list = groups.get(kind)!
        const held = list.every((a) => a.held)
        return (
          <span key={kind} className={`pmark-slot${held ? ' held' : ''}`} title={list.map(accountLabel).join(', ')}>
            <PlatformMark platform={list[0].platform} size={size} />
            {list.length > 1 ? <span className="pmark-count">{list.length}</span> : null}
          </span>
        )
      })}
    </span>
  )
}
