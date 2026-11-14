import { describe, expect, it } from 'vitest'

import { mondayOf, trackerWeek, type TrackerRow } from './tracker'

// Saturday 2026-11-14, 18:00 in Toronto.
const NOW = Date.parse('2026-11-14T23:00:00Z')
const TZ = 'America/Toronto'

const row = (campaign: string, status: string, post_at: string | null, batch?: string): TrackerRow => ({
  post_at,
  status,
  campaign_id: campaign.toLowerCase(),
  campaign_name: campaign,
  batch: batch ? { date: batch } : null,
})

describe('the week of the campaign tracker', () => {
  it('starts on Monday', () => {
    expect(mondayOf('2026-11-14')).toBe('2026-11-09')
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(mondayOf('2026-11-14', 1)).toBe('2026-11-16')
    expect(mondayOf('2026-11-14', -1)).toBe('2026-11-02')
  })

  it("counts each campaign's posts by day in his time zone, by where they stand", () => {
    const week = trackerWeek(
      [
        row('Cantina', 'posted', '2026-11-14T15:00:00Z'),
        row('Cantina', 'scheduled', '2026-11-14T22:00:00Z'),
        // 23:30 on Saturday in Toronto, Sunday in UTC.
        row('Cantina', 'approved', '2026-11-15T04:30:00Z', '2026-11-14'),
        row('Coverd', 'waiting', '2026-11-16T15:00:00Z'),
        row('Coverd', 'waiting', '2026-11-15T15:00:00Z'),
        row('Coverd', 'error', '2026-11-10T15:00:00Z'),
        // Failed before it was sent: no time, its batch day.
        row('Coverd', 'failed', null, '2026-11-11'),
        // Rejected: not his post any more.
        row('Coverd', 'rejected', '2026-11-12T15:00:00Z'),
      ],
      '2026-11-09',
      NOW,
      TZ,
    )
    expect(week.days).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(week.today).toBe('2026-11-14')
    expect(week.campaigns.map((c) => c.name)).toEqual(['Cantina', 'Coverd'])
    const [cantina, coverd] = week.campaigns
    expect(cantina.days[5]).toEqual({ posted: 1, scheduled: 2, waiting: 0, failed: 0, batch: 1 })
    expect(coverd.days[1]).toEqual({ posted: 0, scheduled: 0, waiting: 0, failed: 1, batch: 0 })
    expect(coverd.days[2]).toEqual({ posted: 0, scheduled: 0, waiting: 0, failed: 1, batch: 1 })
    expect(coverd.days[3]).toEqual({ posted: 0, scheduled: 0, waiting: 0, failed: 0, batch: 0 })
    expect(coverd.days[6].waiting).toBe(1)
  })

  it('keeps a campaign that went quiet for a week - not one he ended, nor one he only rejected', () => {
    const week = trackerWeek(
      [
        row('Tailgate', 'posted', '2026-11-05T15:00:00Z'),
        row('Webild', 'posted', '2026-11-05T15:00:00Z'),
        row('World sims', 'rejected', '2026-11-12T15:00:00Z'),
        // Posted last week, then he rejected the rest: stopped.
        row('Videotto', 'posted', '2026-11-04T15:00:00Z'),
        row('Videotto', 'rejected', '2026-11-10T15:00:00Z'),
        // Rejected one, then posted again: still his.
        row('Fairside', 'rejected', '2026-11-03T15:00:00Z'),
        row('Fairside', 'posted', '2026-11-05T15:00:00Z'),
        // Too long ago.
        row('Vertus', 'posted', '2026-10-30T15:00:00Z'),
      ],
      '2026-11-09',
      NOW,
      TZ,
      new Set(['webild']),
    )
    expect(week.campaigns.map((c) => [c.name, c.before])).toEqual([['Fairside', 1], ['Tailgate', 1]])
    expect(week.campaigns[1].days.every((d) => d.posted + d.scheduled + d.waiting + d.failed === 0)).toBe(true)
  })

  it('an ended campaign still shows while it has posts that week', () => {
    const week = trackerWeek([row('Webild', 'posted', '2026-11-10T15:00:00Z')], '2026-11-09', NOW, TZ, new Set(['webild']))
    expect(week.campaigns).toHaveLength(1)
  })
})
