import { describe, expect, it } from 'vitest'

import { BATCH_TRUST, approvalFor, batchChoices, batchInfo, batchReady, batchSpan, batchTrusted, freeBatchTimes, trustKey } from './batch.ts'

describe('a batch video', () => {
  it('is only taken as one with a real id, day, time and size', () => {
    expect(batchInfo({ id: 'b-1', date: '2026-09-30', time: '08:00', size: 21 })).toEqual({ id: 'b-1', date: '2026-09-30', time: '08:00', size: 21 })
    expect(batchInfo({ id: 'b-1', date: '30/09', time: '08:00', size: 21 })).toBeNull()
    expect(batchInfo({ id: 'b-1', date: '2026-09-30', time: '25:00', size: 21 })).toBeNull()
    expect(batchInfo({ id: 'b 1; drop', date: '2026-09-30', time: '08:00', size: 21 })).toBeNull()
    expect(batchInfo(undefined)).toBeNull()
  })

  it('goes at its own time, else the day\'s next ones, else the earlier ones', () => {
    const choices = batchChoices({ id: 'b', date: '2026-09-30', time: '14:00', size: 3 }, ['11:00', '12:00', '14:00', '17:00'], 'America/Toronto')
    expect(choices.map((c) => c.slot)).toEqual(['2026-09-30 14:00', '2026-09-30 17:00', '2026-09-30 12:00', '2026-09-30 11:00'])
    // 2 PM in Montreal is 18:00 UTC, plus a few minutes.
    const first = choices[0].at.getTime() - Date.parse('2026-09-30T18:00:00Z')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(10 * 60_000)
  })

  it('says which days it covers', () => {
    expect(batchSpan(['2026-10-06', '2026-09-30', '2026-10-01'])).toBe('Wed, Sep 30 to Tue, Oct 6')
    expect(batchSpan(['2026-09-30'])).toBe('Wed, Sep 30')
  })
})

describe('a batch video made for the night', () => {
  it('keeps its own night time - his window is his', () => {
    const times = ['03:43', '13:42', '16:43', '20:44']
    const choices = batchChoices({ id: 'b', date: '2026-10-14', time: '03:43', size: 6 }, times, 'America/Toronto')
    expect(choices.map((c) => c.slot)).toEqual(['2026-10-14 03:43', '2026-10-14 13:42', '2026-10-14 16:43', '2026-10-14 20:44'])
  })

  it('keeps its own time when it is in the day', () => {
    const choices = batchChoices({ id: 'b', date: '2026-10-14', time: '13:42', size: 6 }, ['13:42', '16:43'], 'America/Toronto')
    expect(choices[0].slot).toBe('2026-10-14 13:42')
  })
})

describe('who says a video can go', () => {
  const plain = { hand: false, approveNow: false, batch: false, scheduled: false }
  it("takes the campaign's own rule for an ordinary video", () => {
    expect(approvalFor('brand', plain)).toBe('brand')
    expect(approvalFor('direct', plain)).toBe('direct')
  })
  it('always asks him for a batch video, whatever the campaign says', () => {
    expect(approvalFor('direct', { ...plain, batch: true })).toBe('me')
    expect(approvalFor('brand', { ...plain, batch: true })).toBe('me')
  })
  it('lets a Formats video he scheduled himself go at its time', () => {
    expect(approvalFor('me', { ...plain, batch: true, scheduled: true })).toBe('direct')
    expect(approvalFor('brand', { ...plain, batch: true, scheduled: true })).toBe('direct')
    // "Scheduled" means nothing without a day and time.
    expect(approvalFor('me', { ...plain, scheduled: true })).toBe('me')
  })
  it('lets one made by hand, or approved with its music, go', () => {
    expect(approvalFor('me', { ...plain, hand: true })).toBe('direct')
    expect(approvalFor('me', { ...plain, approveNow: true })).toBe('direct')
  })
})

describe('the notification when a batch is up', () => {
  it('says how many to approve, how many a day and over which days', () => {
    const note = batchReady('Lovable', ['2026-10-20', '2026-10-20', '2026-10-21', '2026-10-21'], false)
    expect(note.title).toBe('Lovable: 4 videos ready to approve')
    expect(note.body).toBe('2 a day, Tue, Oct 20 to Wed, Oct 21. Approve them in Posts.')
  })

  it('says when they are the last ones, and to film new clips', () => {
    const note = batchReady('Lovable', ['2026-10-26', '2026-10-27'], true)
    expect(note.title).toBe('Lovable: the last 2 videos - film new clips')
    expect(note.body).toContain('These post Mon, Oct 26 to Tue, Oct 27, then the batch stops')
  })

  it('keeps the mark from the phone that they are the last', () => {
    expect(batchInfo({ id: 'b1', date: '2026-10-26', time: '12:00', size: 2, last: true })?.last).toBe(true)
    expect(batchInfo({ id: 'b1', date: '2026-10-26', time: '12:00', size: 2 })).not.toHaveProperty('last')
    expect(batchInfo({ id: 'b1', date: '2026-10-26', time: '12:00', size: 2, last: 'yes' })).not.toHaveProperty('last')
  })
})

describe('freeBatchTimes', () => {
  const tz = 'America/Toronto'
  const batch = { id: 'b-1', date: '2026-10-31', time: '03:43', size: 4 }

  it('tries a quarter hour on, then before, further each time', () => {
    expect(freeBatchTimes(batch, tz, []).slice(0, 4).map((c) => c.slot)).toEqual(['2026-10-31 03:58', '2026-10-31 03:28', '2026-10-31 04:13', '2026-10-31 03:13'])
  })

  it('never lands within 10 minutes of a video of the campaign already going', () => {
    const going = [Date.parse('2026-10-31T07:58:00Z'), Date.parse('2026-10-31T07:28:00Z')]
    const first = freeBatchTimes(batch, tz, going)[0]
    expect(first.slot).toBe('2026-10-31 04:13')
    for (const c of freeBatchTimes(batch, tz, going)) for (const t of going) expect(Math.abs(c.at.getTime() - t)).toBeGreaterThanOrEqual(10 * 60_000)
  })

  it('stays within the day', () => {
    for (const c of freeBatchTimes({ ...batch, time: '23:50' }, tz, [])) expect(c.slot.startsWith('2026-10-31 ')).toBe(true)
  })
})

describe('batchTrusted', () => {
  it('goes by itself once he has approved 3 of the batch', () => {
    expect(BATCH_TRUST).toBe(3)
    expect(batchTrusted(['approved', 'scheduled', 'waiting', 'waiting'])).toBe(false)
    expect(batchTrusted(['approved', 'scheduled', 'posted', 'waiting'])).toBe(true)
    expect(batchTrusted(['error', 'posted', 'approved'])).toBe(true)
  })

  it('does not count ones turned down, failed, held or still being made', () => {
    expect(batchTrusted(['rejected', 'rejected', 'rejected', 'approved', 'failed', 'writing', 'waiting'])).toBe(false)
  })
})

describe('a Trial loop copy', () => {
  it('keeps the viral reel it copies, and his yes counts per reel, across makings', () => {
    const info = batchInfo({ id: 'b-1', date: '2026-11-06', time: '10:00', size: 5, trial: true, source: 't-abc' })
    expect(info?.source).toBe('t-abc')
    expect(trustKey(info!)).toEqual({ field: 'source', value: 't-abc' })
    // Not a trial: its own making, as always - a source on it is dropped.
    const plain = batchInfo({ id: 'b-1', date: '2026-11-06', time: '10:00', size: 5, source: 't-abc' })
    expect(plain?.source).toBeUndefined()
    expect(trustKey(plain!)).toEqual({ field: 'id', value: 'b-1' })
    // A trial from before sources were kept: its making.
    expect(trustKey({ id: 'b-2', trial: true })).toEqual({ field: 'id', value: 'b-2' })
    // A bad id never reaches a query.
    expect(batchInfo({ id: 'b-1', date: '2026-11-06', time: '10:00', size: 5, trial: true, source: "x' or 1=1" })?.source).toBeUndefined()
  })

  it('waits for his yes like any batch video', () => {
    expect(approvalFor('direct', { hand: false, approveNow: false, batch: true, scheduled: false })).toBe('me')
  })
})
