import { describe, expect, it } from 'vitest'

import { summaryText } from './summary'

const post = (campaign: string, status = 'posted', error: string | null = null, again = false) => ({ campaign, status, error, again })

describe('summaryText', () => {
  it('says how many went out, and that all did', () => {
    expect(summaryText([post('VAZA'), post('Vertus')], {})).toEqual({ title: 'Yesterday: 2 posted', body: 'Everything went out.' })
  })

  it('names each miss and what is being done about it, and each campaign against its most a day', () => {
    const out = summaryText(
      [
        post('Vertus', 'posted', "Not posted to MikeyAi. Posting again Fri 9:00 AM, when YouTube has room again.", true),
        post('Vertus'),
        post('VAZA', 'error', "Postiz couldn't publish it to Vazaziad. Open Postiz to see why."),
      ],
      { Vertus: 2 },
    )
    expect(out?.title).toBe('Yesterday: 2 posted, 2 missed')
    expect(out?.body).toBe('Vertus: missed MikeyAi - posting again by itself · VAZA: missed Vazaziad - Post again in Posts · Vertus 2/2')
  })

  it('says nothing on a day with nothing due', () => {
    expect(summaryText([post('VAZA', 'scheduled')], {})).toBeNull()
  })
})
