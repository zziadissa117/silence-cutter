import { describe, expect, it } from 'vitest'

import { planRespread, type RespreadRow } from '../../supabase/functions/postiz/respread.ts'
import { zoned } from '../../supabase/functions/postiz/slots.ts'
import { evenTimes } from '../../supabase/functions/postiz/window.ts'
import { unevenCampaigns } from './keepEven'
import { stackTimesOn, type ServerPost } from './posting'

const now = new Date(2026, 9, 26, 14, 0)
const post = (campaignId: string, date: string, hhmm: string, status: ServerPost['status'] = 'scheduled'): ServerPost => {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(y, m - 1, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)))
  return { id: `${campaignId}-${date}-${hhmm}`, key: 'k', campaignId, status, postAt: at.toISOString(), batch: { id: 'b', date, time: hhmm, size: 1 } } as unknown as ServerPost
}

describe('which campaigns have uneven days ahead', () => {
  it('finds a day squeezed into 11 AM - 5 PM, not an even one', () => {
    const squeezed = ['11:03', '11:41', '12:17', '13:02', '13:46', '14:31', '15:09', '15:52', '16:33', '16:58'].map((t) => post('squeezed', '2026-10-28', t))
    const even = ['01:13', '03:37', '06:01', '08:26', '10:49', '13:14', '15:38', '18:02', '20:27', '22:51'].map((t) => post('even', '2026-10-28', t))
    expect(unevenCampaigns([...squeezed, ...even], now)).toEqual(['squeezed'])
  })

  it("leaves today alone (part of it gone), what was stopped, and days with one or two", () => {
    const today = ['11:00', '11:10', '11:20'].map((t) => post('a', '2026-10-26', t))
    const stopped = ['11:00', '11:10', '11:20'].map((t) => post('b', '2026-10-28', t, 'rejected'))
    const two = ['11:00', '11:10'].map((t) => post('c', '2026-10-28', t))
    expect(unevenCampaigns([...today, ...stopped, ...two], now)).toEqual([])
  })

  it('leaves a day the batch topped up to a higher number: moving it would only spend Postiz requests', () => {
    for (const [have, want] of [[25, 30], [27, 40], [29, 48], [37, 48]]) {
      const date = '2026-10-29'
      const had = evenTimes(have, 'c1', date)
      const all = [...had, ...stackTimesOn({ accounts: [], times: [] }, 'c1', date, want - have, had)]
      expect(all).toHaveLength(want)
      expect(unevenCampaigns(all.map((t) => post('c1', date, t)), now)).toEqual([])
      const rows: RespreadRow[] = all.map((t, i) => ({
        id: `r${i}`,
        campaign_id: 'c1',
        status: 'approved',
        post_at: zoned(date, t, 'America/Toronto').toISOString(),
        created_at: new Date(Date.UTC(2026, 9, 20, 0, i)).toISOString(),
        creating_at: null,
        slot: `${date} ${t}`,
        batch: { date, time: t },
      }))
      expect(planRespread(rows, { now: now.getTime(), tz: 'America/Toronto' }).moves).toEqual([])
    }
  })
})
