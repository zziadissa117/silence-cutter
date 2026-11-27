import { describe, expect, it } from 'vitest'

import { blankAngle, generalCampaign, videoLook, type BankPicture, type Campaign } from './look'
import { picturesOf, sharedPictures } from './campaignBank'

const pic = (id: string, campaignId?: string): BankPicture => ({ id, image: new Blob(), words: [id], addedAt: 0, ...(campaignId ? { campaignId } : {}) })
const bank = [pic('shared'), pic('mine', 'moon'), pic('theirs', 'fit')]
const campaign = (id: string): Campaign => ({ ...generalCampaign(), id, general: false, name: id })

describe('a campaign picture bank (his ask, 2026-11-27)', () => {
  it("pops up its own pictures on its videos, never another campaign's", () => {
    const angle = { ...blankAngle('a', 'A'), bank: { ...blankAngle('a', 'A').bank, use: false } }
    expect(videoLook(campaign('moon'), angle, bank).bankPictures.map((p) => p.id)).toEqual(['mine'])
    const using = { ...angle, bank: { ...angle.bank, use: true } }
    expect(videoLook(campaign('moon'), using, bank).bankPictures.map((p) => p.id)).toEqual(['shared', 'mine'])
  })
  it('lists a campaign\'s own and the shared ones apart', () => {
    expect(picturesOf(bank, 'moon').map((p) => p.id)).toEqual(['mine'])
    expect(sharedPictures(bank).map((p) => p.id)).toEqual(['shared'])
  })
})
