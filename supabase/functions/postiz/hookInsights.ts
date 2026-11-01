// What works in each batch campaign's videos, for the Analytics tab: views a
// video by headline, by headline look, by reaction and by song - which do
// best, which do worst. His words (2026-11-01): "very, very tracking-oriented,
// with a very visible graph of the best hooks. We see what works and what
// does not work", and a button that makes more videos with the best ones
// (the phone's batchFavour.ts, the mixing's `favour`).
//
// From every batch video posted in the last LOOK_BACK_DAYS that is at least
// MIN_AGE_DAYS old - each has had its time to get its views - with its views
// as Postiz last read them (postViews.ts), all its accounts together. The
// reaction is the first clip in its file name ("IMG_0249 + IMG_0330.mp4",
// CampaignApp.addBatch); the song is carried with the video since
// 2026-11-01 (`batch.song`), so older videos don't count for songs.
//
// A thing with one or two videos can look like the best by luck: each one's
// number leans on the campaign's own average, PRIOR videos' worth, so it
// takes a few videos to stand out (`score`, what they are put in order by).
//
// Plain TypeScript with no imports, for Deno and the tests.

export const LOOK_BACK_DAYS = 30
export const MIN_AGE_DAYS = 3
/** Videos' worth of the campaign's average each one's number leans on. */
const PRIOR = 3
/** A thing needs this many videos to be called best or worst. */
export const ENOUGH = 3
/** Best: this much over the campaign's average, or more. */
const BEST_SHARE = 1.15
/** Worst: under this share of it. */
const WORST_SHARE = 0.75

export type HookKind = 'headline' | 'look' | 'reaction' | 'song'

export interface HookVideo {
  campaign_id: string
  campaign_name: string
  headline: string | null
  file_name: string | null
  batch: { look?: string; song?: string } | null
  views: Record<string, number> | null
  post_at: string | null
}

export interface HookRow {
  /** How the phone matches it: the headline's words in small letters, the
   *  look, the clip's or song's name. */
  key: string
  label: string
  videos: number
  /** Its views a video, on average. */
  views: number
  /** That number leaning on the campaign's average - the order. */
  score: number
  mark?: 'best' | 'worst'
}

export interface CampaignHooks {
  id: string
  name: string
  videos: number
  /** The campaign's views a video, on average. */
  views: number
  rows: Record<HookKind, HookRow[]>
}

const LOOK_LABEL: Record<string, string> = { box: 'White box', outline: 'Outline', snap: 'Snapchat', formula: 'Claude + X' }

/** The same headline, whatever its case and spacing (batchHooks.wordsKey). */
export const wordsKey = (words: string) => words.trim().toLowerCase().replace(/\s+/g, ' ')

/** "$800 a day" or "Claude + X = $800 a day": a Claude + X headline. */
const FORMULA = /(?:^|=)\s*\$[\d,]+/

/** The first clip of a batch video's name: its reaction. */
export function reactionOf(fileName: string | null): string | null {
  const first = fileName?.replace(/\.[^./]+$/, '').split(' + ')[0]?.trim()
  return first ? first : null
}

function keysOf(video: HookVideo): Partial<Record<HookKind, { key: string; label: string }>> {
  const out: Partial<Record<HookKind, { key: string; label: string }>> = {}
  const look = video.batch?.look
  const words = video.headline?.trim() ?? ''
  if (look === 'formula' || (!look && FORMULA.test(words))) out.headline = { key: 'formula', label: 'Claude + X' }
  else if (words) out.headline = { key: wordsKey(words), label: words }
  if (look && LOOK_LABEL[look]) out.look = { key: look, label: LOOK_LABEL[look] }
  const reaction = reactionOf(video.file_name)
  if (reaction) out.reaction = { key: reaction, label: reaction }
  const song = typeof video.batch?.song === 'string' ? video.batch.song.trim() : ''
  if (song) out.song = { key: song, label: song }
  return out
}

const totalViews = (views: Record<string, number> | null): number | null => {
  const counts = Object.values(views ?? {}).filter((n) => Number.isFinite(n))
  return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null
}

/** Every batch campaign's numbers, most videos first. */
export function hookInsights(videos: readonly HookVideo[], now: number): CampaignHooks[] {
  const oldest = now - LOOK_BACK_DAYS * 86_400_000
  const newest = now - MIN_AGE_DAYS * 86_400_000
  const byCampaign = new Map<string, { name: string; list: { video: HookVideo; views: number }[] }>()
  for (const video of videos) {
    const at = Date.parse(video.post_at ?? '')
    const views = totalViews(video.views)
    if (!video.batch || views === null || !Number.isFinite(at) || at < oldest || at > newest) continue
    const entry = byCampaign.get(video.campaign_id) ?? { name: video.campaign_name, list: [] }
    entry.list.push({ video, views })
    byCampaign.set(video.campaign_id, entry)
  }
  const out: CampaignHooks[] = []
  for (const [id, { name, list }] of byCampaign) {
    const average = list.reduce((n, v) => n + v.views, 0) / list.length
    const groups: Record<HookKind, Map<string, { label: string; views: number[] }>> = {
      headline: new Map(),
      look: new Map(),
      reaction: new Map(),
      song: new Map(),
    }
    for (const { video, views } of list) {
      for (const [kind, k] of Object.entries(keysOf(video)) as [HookKind, { key: string; label: string }][]) {
        const at = groups[kind].get(k.key) ?? { label: k.label, views: [] }
        at.views.push(views)
        groups[kind].set(k.key, at)
      }
    }
    const rows = Object.fromEntries(
      (Object.keys(groups) as HookKind[]).map((kind) => [kind, rank([...groups[kind]].map(([key, g]) => rowOf(key, g, average)))]),
    ) as Record<HookKind, HookRow[]>
    out.push({ id, name, videos: list.length, views: Math.round(average), rows })
  }
  return out.sort((a, b) => b.videos - a.videos)
}

function rowOf(key: string, { label, views }: { label: string; views: number[] }, average: number): HookRow {
  const sum = views.reduce((a, b) => a + b, 0)
  return { key, label, videos: views.length, views: Math.round(sum / views.length), score: Math.round((sum + PRIOR * average) / (views.length + PRIOR)) }
}

/** In order, best first, with the best and the worst marked - only among
 *  things with ENOUGH videos, and only when there are two of those to tell
 *  apart. At most a third are best. */
function rank(rows: HookRow[]): HookRow[] {
  const sorted = rows.sort((a, b) => b.score - a.score || b.videos - a.videos)
  const enough = sorted.filter((r) => r.videos >= ENOUGH)
  if (enough.length < 2) return sorted
  const mean = enough.reduce((n, r) => n + r.views * r.videos, 0) / enough.reduce((n, r) => n + r.videos, 0)
  const room = Math.max(1, Math.floor(enough.length / 3))
  enough.filter((r) => r.score >= mean * BEST_SHARE).slice(0, room).forEach((r) => (r.mark = 'best'))
  enough.filter((r) => !r.mark && r.score < mean * WORST_SHARE).forEach((r) => (r.mark = 'worst'))
  return sorted
}
