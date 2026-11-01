// When his videos do best, by day of the week and hour - so each day's batch
// videos come closer together at its best hours and further apart at its
// weakest, still spread around the clock. His words (2026-11-01): "a higher
// rate at certain hours, depending on the day of the week", "I still want it
// to be spread evenly around the clock, but just have a higher rate
// concentrated around the hour that has the most views", and not back to
// back, "it's going to flag it" (window.ts LEAST_EVEN_GAP, MOST_WEIGHT).
//
// From the views Postiz gave for each video (postViews.ts): only videos at
// least MIN_AGE_DAYS old, so each has had its time, and from the last
// LOOK_BACK_DAYS. A video is measured against its own campaign - its views
// over the campaign's usual (median) - so a campaign that does well
// everywhere doesn't make its hours look good. Each hour of the week has only
// a few videos, so it leans on the same hour on the other days and on the
// hours beside it, and on nothing at all (an even day) until enough videos
// are in.
//
// Worked out once a day by the posting function's tick (index.ts
// learnHours), kept in cutter_config `hours:<profile>`, handed to the phone
// with the profile (`bestHours`). Days of the week are 0 Sunday to 6
// Saturday, hours his clock's, as a batch's dates and times are.
//
// Plain TypeScript with no imports, for Deno and the tests.

export const LOOK_BACK_DAYS = 35
export const MIN_AGE_DAYS = 3
/** No weighting at all before this many videos are read. */
export const MIN_VIDEOS = 150

/** How much an hour (all days together) leans on even, in videos. */
const HOUR_PRIOR = 12
/** How much one day's hour leans on that hour of every day, in videos. */
const CELL_PRIOR = 10
/** The hours either side count this much toward an hour. */
const NEIGHBOUR = 0.5
/** Views added to both sides of the over-usual measure, so a video with a
 *  handful of views isn't nothing next to one with a few dozen. */
const SOFT = 20

export interface HourVideo {
  campaign: string
  /** When it went out. */
  at: string
  /** Its views on every account it went to, together. */
  views: number
}

export interface BestHours {
  /** By day of the week (0 Sunday), 24 weights each: 1 is the day's usual
   *  rate, 2 twice it. */
  weights: number[][]
  /** How many videos it was worked out from. */
  videos: number
  /** When. */
  at: string
  /** He turned it off: every day even again. */
  off?: boolean
}

/** The day of the week and hour a moment is on his clock. */
export function weekHour(at: Date, tz: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday), hour }
}

/** The day of the week of a date ("2026-11-01" is a Sunday, 0). */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

const median = (list: number[]) => {
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** The week's weights from the videos, or null while too few are read. */
export function learnHours(videos: readonly HourVideo[], { now, tz }: { now: number; tz: string }): BestHours | null {
  const oldest = now - LOOK_BACK_DAYS * 86_400_000
  const newest = now - MIN_AGE_DAYS * 86_400_000
  const kept = videos.filter((v) => {
    const at = Date.parse(v.at)
    return Number.isFinite(at) && at >= oldest && at <= newest && Number.isFinite(v.views) && v.views >= 0
  })
  // Each against its campaign's usual: campaigns with too few to tell are left out.
  const byCampaign = new Map<string, HourVideo[]>()
  for (const v of kept) byCampaign.set(v.campaign, [...(byCampaign.get(v.campaign) ?? []), v])
  const scored: { day: number; hour: number; score: number }[] = []
  for (const list of byCampaign.values()) {
    if (list.length < 5) continue
    const usual = median(list.map((v) => v.views))
    for (const v of list) scored.push({ ...weekHour(new Date(v.at), tz), score: Math.log((v.views + SOFT) / (usual + SOFT)) })
  }
  if (scored.length < MIN_VIDEOS) return null

  // Every day's hour together, with the hours beside it.
  const hourSum = new Array<number>(24).fill(0)
  const hourN = new Array<number>(24).fill(0)
  for (const { hour, score } of scored) {
    for (const [h, share] of [[hour, 1], [(hour + 23) % 24, NEIGHBOUR], [(hour + 1) % 24, NEIGHBOUR]] as const) {
      hourSum[h] += score * share
      hourN[h] += share
    }
  }
  const hourly = hourSum.map((sum, h) => sum / (hourN[h] + HOUR_PRIOR))
  // Then each day's own lean on top of it, the same way.
  const cellSum = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const cellN = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  for (const { day, hour, score } of scored) {
    const rest = score - hourly[hour]
    for (const [h, share] of [[hour, 1], [(hour + 23) % 24, NEIGHBOUR], [(hour + 1) % 24, NEIGHBOUR]] as const) {
      cellSum[day][h] += rest * share
      cellN[day][h] += share
    }
  }
  const weights = cellSum.map((row, d) => {
    const raw = row.map((sum, h) => Math.exp(hourly[h] + sum / (cellN[d][h] + CELL_PRIOR)))
    return dayWeights(raw)
  })
  return { weights, videos: scored.length, at: new Date(now).toISOString() }
}

/** A day's weights with its usual at 1, none above 2 or under a half, to two places. */
function dayWeights(raw: readonly number[]): number[] {
  let w = [...raw]
  for (let pass = 0; pass < 3; pass++) {
    const mean = w.reduce((a, b) => a + b, 0) / w.length
    w = w.map((x) => Math.min(2, Math.max(0.5, x / mean)))
  }
  return w.map((x) => Math.round(x * 100) / 100)
}

/** A date's 24 weights, or none (off, not learnt yet, or not a good shape). */
export function hoursOn(best: BestHours | null | undefined, date: string): number[] | undefined {
  if (!best || best.off || !Array.isArray(best.weights)) return undefined
  const day = best.weights[dayOfWeek(date)]
  return Array.isArray(day) && day.length === 24 ? day : undefined
}

/** What was kept, or null - never trusting its shape. */
export function parseHours(text: string | null | undefined): BestHours | null {
  try {
    const v = JSON.parse(text ?? '') as BestHours
    if (!v || !Array.isArray(v.weights) || v.weights.length !== 7) return v && v.off ? { weights: [], videos: 0, at: '', off: true } : null
    return v
  } catch {
    return null
  }
}

/** The day's best hours, for the Analytics tab: the hours at or above
 *  `share` of the day's usual rate, as runs ("1 PM - 4 PM"). */
export function bestRuns(day: readonly number[], share = 1.25): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = []
  for (let h = 0; h < 24; h++) {
    if (day[h] < share) continue
    const last = runs[runs.length - 1]
    if (last && last.to === h) last.to = h + 1
    else runs.push({ from: h, to: h + 1 })
  }
  return runs
}
