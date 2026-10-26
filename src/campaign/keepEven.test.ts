import { describe, expect, it } from 'vitest'

import { unevenCampaigns } from './keepEven'
import type { ServerPost } from './posting'

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
})
