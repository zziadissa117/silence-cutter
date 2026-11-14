// The campaign tracker (his ask, 2026-11-14): a week of boxes per campaign,
// yellow while set to go, blue once posted - and a running batch's days to
// come counted though it makes its videos only three days ahead.

import { describe, expect, it } from 'vitest'

import type { BankFile, BatchBank } from './batch'
import type { TrackerCell, TrackerWeek } from './posting'
import { boxParts, boxWords, dayTotals, boxInk, trackerLines, weekRange, weekTitle, type TrackerBox } from './trackerLines'

const DAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']

const cell = (over: Partial<TrackerCell> = {}): TrackerCell => ({ posted: 0, scheduled: 0, waiting: 0, failed: 0, batch: 0, ...over })
const box = (over: Partial<TrackerBox> = {}): TrackerBox => ({ ...cell(over), coming: 0, ...over })

const files = (prefix: string, n: number): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}.mov`, type: 'video/quicktime', size: 1 }))

const bank = (over: Partial<BatchBank> = {}): BatchBank =>
  ({
    campaignId: 'postiz',
    angleId: 'a',
    layout: 'after',
    reactions: files('r', 10),
    products: files('p', 10),
    headlines: ['One', 'Two', 'Three'],
    music: [],
    used: {},
    made: [],
    perDay: 2,
    days: 1,
    running: true,
    ...over,
  }) as unknown as BatchBank

/** Thursday the 12th: three days of the week left after today. */
const week = (campaigns: TrackerWeek['campaigns'], today = '2026-11-12'): TrackerWeek => ({ days: DAYS, today, campaigns })

describe('the campaign tracker', () => {
  it("adds what a running batch still makes on the days after today, less what it made already", () => {
    const lines = trackerLines(
      week([
        {
          id: 'postiz',
          name: 'Postiz',
          before: 0,
          days: [cell({ posted: 2, batch: 2 }), cell({ posted: 2, batch: 2 }), cell({ posted: 2, batch: 2 }), cell({ posted: 1, scheduled: 1, batch: 2 }), cell({ scheduled: 1, batch: 1 }), cell(), cell()],
        },
      ]),
      new Map([['postiz', bank()]]),
      new Map([['postiz', 'Postiz']]),
    )
    expect(lines).toHaveLength(1)
    // Today and before: only what is there.
    expect(lines[0].boxes.slice(0, 4).map((b) => b.coming)).toEqual([0, 0, 0, 0])
    // Friday has one of its two; the weekend none yet.
    expect(lines[0].boxes.slice(4).map((b) => b.coming)).toEqual([1, 2, 2])
  })

  it('no more than the batch has videos left to make', () => {
    // 3 reactions, each once: 3 videos in all.
    const lines = trackerLines(week([]), new Map([['c', bank({ campaignId: 'c', reactions: files('r', 3), reactionsOnce: true } as Partial<BatchBank>)]]), new Map([['c', 'Coverd']]))
    expect(lines[0].boxes.map((b) => b.coming)).toEqual([0, 0, 0, 0, 2, 1, 0])
  })

  it('a stopped batch adds nothing; a running one with nothing sent yet gets its line; a deleted campaign none', () => {
    const lines = trackerLines(
      week([{ id: 'cantina', name: 'Cantina', before: 2, days: DAYS.map(() => cell()) }]),
      new Map<string, BatchBank | null>([
        ['cantina', bank({ campaignId: 'cantina', running: false })],
        ['tailgate', bank({ campaignId: 'tailgate', perDay: 1 })],
        ['gone', bank({ campaignId: 'gone' })],
      ]),
      new Map([
        ['cantina', 'Cantina'],
        ['tailgate', 'Tailgate'],
      ]),
    )
    // Quiet ones under the others.
    expect(lines.map((l) => [l.name, l.quiet])).toEqual([
      ['Tailgate', false],
      ['Cantina', true],
    ])
    expect(lines[1].boxes.every((b) => b.coming === 0)).toBe(true)
    expect(lines[0].boxes.map((b) => b.coming)).toEqual([0, 0, 0, 0, 1, 1, 1])
    expect(dayTotals(lines, 7)).toEqual([0, 0, 0, 0, 1, 1, 1])
  })

  it('a week ahead: the days in between are spoken for first', () => {
    const next = { days: DAYS.map((d) => d.replace(/-(\d+)$/, (_, n) => `-${Number(n) + 7}`)), today: '2026-11-12', campaigns: [] }
    // 9 left at 2 a day: Sun the 15th is beyond the 3 made days, so 2 of
    // the 9 go to it, 7 are left for next week.
    const lines = trackerLines(next, new Map([['c', bank({ campaignId: 'c', reactions: files('r', 9), reactionsOnce: true } as Partial<BatchBank>)]]), new Map([['c', 'Coverd']]))
    expect(lines[0].boxes.map((b) => b.coming)).toEqual([2, 2, 2, 1, 0, 0, 0])
  })

  it('a box: posted at the bottom, what is still to come on top, the number on its colour, or on a shadow when it has more than one', () => {
    const b = box({ posted: 1, scheduled: 2, coming: 1 })
    expect(boxParts(b)).toEqual([
      { kind: 'posted', from: 0, to: 0.25 },
      { kind: 'scheduled', from: 0.25, to: 0.75 },
      { kind: 'coming', from: 0.75, to: 1 },
    ])
    expect(boxInk(b)).toBe('mixed')
    expect(boxInk(box({ posted: 3 }))).toBe('posted')
    expect(boxInk(box())).toBeNull()
    expect(boxWords(b, true)).toBe('1 posted · 2 scheduled · the batch makes 1')
    expect(boxWords(box({ failed: 30 }), false)).toBe("30 didn't go out")
    expect(boxWords(box(), true)).toBe('Nothing set to go out')
    expect(boxWords(box(), false)).toBe('Nothing went out')
  })

  it('the week in words', () => {
    expect(weekRange(DAYS)).toBe('Nov 9 – 15')
    expect(weekRange(['2026-11-30', '2026-12-06'])).toBe('Nov 30 – Dec 6')
    expect(weekTitle(0, DAYS)).toBe('This week')
    expect(weekTitle(1, DAYS)).toBe('Next week')
    expect(weekTitle(-1, DAYS)).toBe('Last week')
    expect(weekTitle(2, DAYS)).toBe('Nov 9 – 15')
  })
})
