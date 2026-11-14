// The campaign tracker at the top of the Videos tab (his ask, 2026-11-14: "I
// can't remember, every single day, which brands posted, which did not post,
// and which ones I need to post on ... The goal for this is to be like a
// dashboard"): a week from Monday, each campaign on a line, and a box a day
// with how many posts go out - yellow while they are set to go, blue once
// posted. The server counts the posts (postiz/tracker.ts); here each running
// batch's days still to come are added - it makes its videos only three days
// ahead, so the rest of the week would look empty though it is taken care of.

import { addDays, type BatchBank } from './batch'
import { AHEAD_DAYS, leftToMake, perDayOn } from './batchRun'
import type { TrackerCell, TrackerWeek } from './posting'

/** One campaign's day in the tracker. */
export interface TrackerBox extends TrackerCell {
  /** Still to be made by its running batch. */
  coming: number
}

export interface TrackerLine {
  id: string
  name: string
  boxes: TrackerBox[]
  /** Nothing this week: posted the week before, nothing since - under the others. */
  quiet: boolean
}

export type BoxKind = 'posted' | 'failed' | 'waiting' | 'scheduled' | 'coming'

/** Bottom to top in a box: what went out first, what is still to come last. */
export const BOX_ORDER: readonly BoxKind[] = ['posted', 'failed', 'waiting', 'scheduled', 'coming']

export const boxTotal = (b: TrackerBox): number => b.posted + b.failed + b.waiting + b.scheduled + b.coming

const running = (bank: BatchBank | null | undefined): bank is BatchBank => Boolean(bank?.running)

/** What a running batch will still make on each day of the week after
 *  today, as many as it makes a day less what it made already - no more than
 *  it has videos left to make. */
function comingFor(bank: BatchBank, week: TrackerWeek, made: readonly number[]): number[] {
  let left = leftToMake(bank).left
  // Days between today and this week (a week ahead): theirs are spoken for.
  // The first AHEAD_DAYS are made already, out of what is left.
  for (let d = addDays(week.today, AHEAD_DAYS); d < week.days[0]; d = addDays(d, 1)) left -= perDayOn(bank, d)
  return week.days.map((date, i) => {
    if (date <= week.today || left <= 0) return 0
    const coming = Math.max(0, Math.min(perDayOn(bank, date) - made[i], left))
    left -= coming
    return coming
  })
}

/** The tracker's lines: the server's campaigns, and any with a running batch
 *  that has nothing on the server yet; each running batch's days to come
 *  added. `names`: the campaigns on this phone, by id. */
export function trackerLines(week: TrackerWeek, banks: ReadonlyMap<string, BatchBank | null>, names: ReadonlyMap<string, string>): TrackerLine[] {
  const empty = (): TrackerCell => ({ posted: 0, scheduled: 0, waiting: 0, failed: 0, batch: 0 })
  const lines = week.campaigns.map((c) => ({ id: c.id, name: c.name, days: c.days }))
  for (const [id, bank] of banks) {
    if (!running(bank) || lines.some((l) => l.id === id) || !names.has(id)) continue
    lines.push({ id, name: names.get(id)!, days: week.days.map(empty) })
  }
  return lines
    .map((line) => {
      const bank = banks.get(line.id)
      const coming = running(bank) ? comingFor(bank, week, line.days.map((d) => d.batch)) : week.days.map(() => 0)
      const boxes = line.days.map((d, i) => ({ ...d, coming: coming[i] }))
      return { id: line.id, name: names.get(line.id) ?? line.name, boxes, quiet: boxes.every((b) => boxTotal(b) === 0) }
    })
    // The campaigns with posts this week first, by name; the quiet ones under them.
    .sort((a, b) => Number(a.quiet) - Number(b.quiet) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Each day's posts, every campaign together. */
export function dayTotals(lines: readonly TrackerLine[], days: number): number[] {
  return Array.from({ length: days }, (_, i) => lines.reduce((n, l) => n + boxTotal(l.boxes[i]), 0))
}

/** A box's colours from the bottom up, each with its share of the box. */
export function boxParts(b: TrackerBox): { kind: BoxKind; from: number; to: number }[] {
  const total = boxTotal(b)
  if (total === 0) return []
  let at = 0
  return BOX_ORDER.filter((k) => b[k] > 0).map((kind) => {
    const from = at
    at += b[kind] / total
    return { kind, from, to: at }
  })
}

/** The colour behind the box's number: the box's one colour, or 'mixed'. */
export function boxInk(b: TrackerBox): BoxKind | 'mixed' | null {
  const parts = boxParts(b)
  return parts.length === 0 ? null : parts.length === 1 ? parts[0].kind : 'mixed'
}

const WORDS: Record<BoxKind, string> = {
  posted: 'posted',
  failed: "didn't go out",
  waiting: 'to approve',
  scheduled: 'scheduled',
  coming: 'the batch makes',
}

/** "1 posted · 2 scheduled · the batch makes 1": a box in words. */
export function boxWords(b: TrackerBox, future: boolean): string {
  const said = BOX_ORDER.filter((k) => b[k] > 0).map((k) => (k === 'coming' ? `${WORDS[k]} ${b[k]}` : `${b[k]} ${WORDS[k]}`))
  if (said.length > 0) return said.join(' · ')
  return future ? 'Nothing set to go out' : 'Nothing went out'
}

/** "Nov 9 – 15", "Nov 30 – Dec 6". */
export function weekRange(days: readonly string[]): string {
  if (days.length === 0) return ''
  const at = (date: string) => new Date(`${date}T12:00:00`)
  const first = at(days[0])
  const last = at(days[days.length - 1])
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  return first.getMonth() === last.getMonth()
    ? `${month(first)} ${first.getDate()} – ${last.getDate()}`
    : `${month(first)} ${first.getDate()} – ${month(last)} ${last.getDate()}`
}

/** "This week", "Next week", "Last week", or the dates. */
export function weekTitle(weeks: number, days: readonly string[]): string {
  return weeks === 0 ? 'This week' : weeks === 1 ? 'Next week' : weeks === -1 ? 'Last week' : weekRange(days)
}
