import { describe, expect, it } from 'vitest'

import { blankAngle, blankCampaign, videoLook, type Angle, type BankPicture } from './look'
import { PICTURE_LEAD_SEC, wordMoments } from './moments'

const image = new Blob(['x'], { type: 'image/png' })
const w = (text: string, start: number, end = start + 0.4) => ({ text: ` ${text}`, start, end })

/** "My favourite is Hershey's, honestly" - the speech model put "Hershey's"
 *  0.45 s late; the letter model put it on his voice, at 2.10 s. */
const rough = [w('My', 1.0), w('favourite', 1.25), w('is', 1.75), w("Hershey's", 2.55), w('honestly', 3.1)]
const exact = [w('My', 0.98), w('favourite', 1.2), w('is', 1.62), w("Hershey's", 2.1), w('honestly', 2.7)]

function lookWith(angleFields: Partial<Angle> = {}, bank: BankPicture[] = [], brandWords: string[] = []) {
  const campaign = { ...blankCampaign('c'), name: 'Candy', logo: image, brandWords }
  const angle = { ...blankAngle('a', 'Angle'), ...angleFields }
  return videoLook(campaign, angle, bank)
}

const picture = { id: 'p', image, words: ["Hershey's"], seconds: 3, position: 'top-right' as const, widthPct: 40 }

describe('when pictures come up', () => {
  it("comes up on the word's exact moment, a touch early - not the speech model's late one", () => {
    const look = lookWith({ pictures: [picture] })
    const { pictures } = wordMoments({ words: rough, spoken: exact }, look)
    expect(pictures[0][0]).toBeCloseTo(2.1 - PICTURE_LEAD_SEC, 5)
  })
  it('does the same for a picture from the bank', () => {
    const bank = [{ id: 'b', image, words: ["Hershey's"], addedAt: 0 }]
    const look = lookWith({ bank: { ...blankAngle('a', 'Angle').bank, use: true } }, bank)
    const { bank: cues } = wordMoments({ words: rough, spoken: exact }, look)
    expect(cues).toHaveLength(1)
    expect(cues[0].moments[0]).toBeCloseTo(2.1 - PICTURE_LEAD_SEC, 5)
  })
  it('brings the logo up a touch early too', () => {
    const look = lookWith({}, [], ["Hershey's"])
    const { logo } = wordMoments({ words: rough, spoken: exact }, look)
    expect(logo[0]).toBeCloseTo(2.1 - PICTURE_LEAD_SEC, 5)
  })
  it('lands a sound on the word itself, with no lead', () => {
    const look = lookWith({
      sounds: [{ id: 's', source: { kind: 'built-in', name: 'whoosh' }, trigger: { kind: 'words', words: ["Hershey's"] }, volumeDb: 0 }],
    })
    const { sounds } = wordMoments({ words: rough, spoken: exact }, look)
    expect(sounds[0][0]).toBeCloseTo(2.1, 5)
  })
  it('keeps a picture put on by hand exactly where he put it', () => {
    const look = lookWith({ pictures: [picture] })
    const { pictures } = wordMoments({ words: rough, spoken: exact }, look, new Map([['p', 1.5]]))
    expect(pictures[0]).toEqual([1.5])
  })
  it('uses the rough words when a video was heard before the exact ones existed', () => {
    const look = lookWith({ pictures: [picture] })
    const { pictures } = wordMoments({ words: rough }, look)
    expect(pictures[0][0]).toBeCloseTo(2.55 - PICTURE_LEAD_SEC, 5)
  })
  it('still finds a name only the rough words make out', () => {
    // The captions joined "Coca" and "-Cola" into one word, which a picture
    // keyed on "Coca" no longer matches; the rough words still have it.
    const look = lookWith({ pictures: [{ ...picture, words: ['Coca'] }] })
    const roughPieces = [w('a', 1), w('Coca', 2), { text: '-Cola', start: 2.3, end: 2.6 }]
    const joined = [w('a', 0.9), { text: ' Coca-Cola', start: 1.9, end: 2.5 }]
    const { pictures, notHeard } = wordMoments({ words: roughPieces, spoken: joined }, look)
    expect(pictures[0][0]).toBeCloseTo(2 - PICTURE_LEAD_SEC, 5)
    expect(notHeard).toEqual([])
  })
  it('says which words were never heard', () => {
    const look = lookWith({ pictures: [{ ...picture, words: ['Kit Kat'] }] })
    const { pictures, notHeard } = wordMoments({ words: rough, spoken: exact }, look)
    expect(pictures[0]).toEqual([])
    expect(notHeard).toEqual(['Kit Kat'])
  })
})
