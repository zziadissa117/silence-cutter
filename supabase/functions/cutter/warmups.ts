// Warm-up posts (his ask, 2026-11-11): short, ready-made ideas to film in a
// few seconds - a set headline, a set sound, a set length, no talking - that
// go out between an account's batch videos to warm it up ("warm posts usually
// get over 1,000 views"). Shared by everyone who uses the Cutter: anyone adds
// an idea; one from the owner goes up at once, anyone else's waits for his OK
// (he can change it first). Ideas are in categories (Training, AI to start);
// a new category waits for his OK too. His and his partners' ideas come first.
//
// Each idea is a row of cutter_config, `warmup:<id>`, each category
// `warmcat:<id>`, read and written only by the cutter function after a valid
// login. An idea's sound and example video are files in the cutter-files
// bucket at warmup/<sha>: an idea's sound has to play on every login, and
// each login's music bank is its own.
//
// No imports: the cutter function runs it on Deno, the tests under Vitest.

export const IDEA_KEY = 'warmup:'
export const CATEGORY_KEY = 'warmcat:'
export const PARTNERS_CONFIG = 'warmup-partners'
export const WARMUP_DIR = 'warmup'
/** An idea's sound or example video, at most. */
export const MAX_WARMUP_BYTES = 60_000_000

export interface WarmupFile {
  /** SHA-256 of the file: where it is kept. */
  sha: string
  name: string
  type: string
  size: number
}

export interface WarmupIdea {
  id: string
  title: string
  category: string
  /** How to film it, or the idea behind it. */
  script: string
  /** The words on the video - each one filmed can say them differently. */
  headline: string
  headlineStyle: 'box' | 'outline' | 'snap'
  /** How long it is, in seconds (it stops filming there by itself). */
  seconds: number
  /** The sound it goes out with: a trend or background music - never his voice. */
  sound: WarmupFile | null
  /** What it looks like: a post on Instagram or TikTok, or a video. */
  example: { link: string } | { video: WarmupFile } | null
  /** Who added it: their login, and its name to show. */
  by: string
  byName: string
  status: 'approved' | 'waiting'
  addedAt: number
}

export interface WarmupCategory {
  id: string
  name: string
  status: 'approved' | 'waiting'
  by: string
  addedAt: number
}

/** The two there are before anyone adds one. */
export const FIRST_CATEGORIES: readonly WarmupCategory[] = [
  { id: 'training', name: 'Training', status: 'approved', by: '', addedAt: 1 },
  { id: 'ai', name: 'AI', status: 'approved', by: '', addedAt: 2 },
]

export const SECONDS = { min: 3, max: 30, usual: 7 } as const

const SHA = /^[0-9a-f]{64}$/
const ID = /^[\w-]{1,80}$/
const STYLES = new Set(['box', 'outline', 'snap'])

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export function cleanFile(value: unknown, kind: 'audio' | 'video'): WarmupFile | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const sha = typeof v.sha === 'string' && SHA.test(v.sha) ? v.sha : null
  const type = typeof v.type === 'string' && new RegExp(`^${kind}/[\\w.+-]+$`).test(v.type) ? v.type : null
  const size = Number(v.size)
  if (!sha || !type || !Number.isInteger(size) || size <= 0 || size > MAX_WARMUP_BYTES) return null
  return { sha, name: str(v.name, 120) || (kind === 'audio' ? 'Sound' : 'Example'), type, size }
}

/** Only a post on Instagram or TikTok: tapped, it opens there. */
export function cleanLink(value: unknown): string | null {
  const link = str(value, 500)
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:') return null
    return /(^|\.)(instagram\.com|tiktok\.com)$/.test(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

/** An idea as a phone sent it, checked - with who sent it and what it is now
 *  taken from the server, never the phone. Null when it isn't usable. */
export function cleanIdea(value: unknown, by: { space: string; name: string }, status: WarmupIdea['status'], now = Date.now()): WarmupIdea | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const id = typeof v.id === 'string' && ID.test(v.id) ? v.id : null
  const title = str(v.title, 80)
  const category = typeof v.category === 'string' && ID.test(v.category) ? v.category : null
  if (!id || !title || !category) return null
  const seconds = Math.round(Number(v.seconds))
  const example = v.example && typeof v.example === 'object' ? (v.example as Record<string, unknown>) : null
  const link = example ? cleanLink(example.link) : null
  const video = example && !link ? cleanFile(example.video, 'video') : null
  const addedAt = Number(v.addedAt)
  return {
    id,
    title,
    category,
    script: str(v.script, 1500),
    headline: str(v.headline, 120),
    headlineStyle: STYLES.has(v.headlineStyle as string) ? (v.headlineStyle as WarmupIdea['headlineStyle']) : 'box',
    seconds: Number.isFinite(seconds) ? Math.min(SECONDS.max, Math.max(SECONDS.min, seconds)) : SECONDS.usual,
    sound: cleanFile(v.sound, 'audio'),
    example: link ? { link } : video ? { video } : null,
    by: by.space,
    byName: by.name,
    status,
    addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : now,
  }
}

export function cleanCategoryName(value: unknown): string {
  return str(value, 40).replace(/\s+/g, ' ')
}

/** A category's id from its name: "Gym tips" -> "gym-tips". */
export function categoryId(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'category'
  )
}

/** Rows of cutter_config as things, any bad row left out. */
export function rowsOf<T>(rows: readonly { value: string }[], ok: (v: T) => boolean): T[] {
  const out: T[] = []
  for (const row of rows) {
    try {
      const value = JSON.parse(row.value) as T
      if (value && ok(value)) out.push(value)
    } catch {
      // Not one.
    }
  }
  return out
}

/** What one login sees: everything approved, and what it sent itself while
 *  it waits - the owner sees all of it, to say yes or no. The owner's ideas
 *  first, then his partners', then everyone else's; newest first in each. */
export function ideasFor(ideas: readonly WarmupIdea[], space: string, owner: string | null, partners: readonly string[]): WarmupIdea[] {
  const rank = (i: WarmupIdea) => (i.by === owner ? 0 : partners.includes(i.by) ? 1 : 2)
  return ideas
    .filter((i) => i.status === 'approved' || i.by === space || space === owner)
    .sort((a, b) => rank(a) - rank(b) || b.addedAt - a.addedAt)
}

export function categoriesFor(categories: readonly WarmupCategory[], space: string, owner: string | null): WarmupCategory[] {
  const all = [...FIRST_CATEGORIES.filter((f) => !categories.some((c) => c.id === f.id)), ...categories]
  return all.filter((c) => c.status === 'approved' || c.by === space || space === owner).sort((a, b) => a.addedAt - b.addedAt)
}

/** The files a login may fetch: those of the ideas it can see. */
export function filesOf(ideas: readonly WarmupIdea[]): Set<string> {
  const shas = new Set<string>()
  for (const i of ideas) {
    if (i.sound) shas.add(i.sound.sha)
    if (i.example && 'video' in i.example) shas.add(i.example.video.sha)
  }
  return shas
}
