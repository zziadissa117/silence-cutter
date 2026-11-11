// A section's mark: its icon on a colour of its own (Settings, Batch - his
// ask, 2026-11-11, "make it cooler"). One place, so each kind of section has
// the same mark everywhere.

import type { ReactNode } from 'react'

import { AnalyticsIcon, BatchIcon, CaptionsIcon, HookIcon, MusicIcon, PostsIcon, ServerIcon, VideosIcon } from './icons'

const MARKS: Record<string, { icon: ReactNode; hue: number }> = {
  formats: { icon: <BatchIcon />, hue: 258 },
  hook: { icon: <HookIcon />, hue: 32 },
  headlines: { icon: <CaptionsIcon />, hue: 200 },
  music: { icon: <MusicIcon />, hue: 318 },
  copies: { icon: <MusicIcon />, hue: 165 },
  posting: { icon: <PostsIcon />, hue: 236 },
  results: { icon: <AnalyticsIcon />, hue: 140 },
  clips: { icon: <VideosIcon />, hue: 10 },
  engine: { icon: <ServerIcon />, hue: 60 },
}

export type MarkKind = keyof typeof MARKS

export function Mark({ kind }: { kind: MarkKind }) {
  const mark = MARKS[kind] ?? MARKS.formats
  return (
    <span className="set-icon mark" style={{ ['--hue' as string]: String(mark.hue) }} aria-hidden>
      {mark.icon}
    </span>
  )
}
