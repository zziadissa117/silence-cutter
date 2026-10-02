import { describe, expect, it } from 'vitest'

import {
  angleProblems,
  blankAngle,
  blankPicture,
  blankCampaign,
  campaignProblems,
  copyAngle,
  describeAngle,
  firstAngleId,
  generalCampaign,
  parseWordList,
  upgradeV1,
  videoLook,
  withGeneralAngle,
  wordsToHear,
  type Campaign,
  type CampaignV1,
} from './look'

const logo = new Blob(['png'], { type: 'image/png' })

function vertus(fields: Partial<Campaign> = {}): Campaign {
  return { ...blankCampaign('c'), name: 'Vertus', logo, brandWords: ['Vertus'], ...fields }
}

describe('withGeneralAngle', () => {
  it('gives a campaign its General angle once, last, and never the General campaign', () => {
    const c = withGeneralAngle({ ...blankCampaign('c'), angles: [blankAngle('c-a1', 'Angle 1')] })
    expect(c.angles.map((a) => a.id)).toEqual(['c-a1', 'c-general'])
    expect(c.angles[1]).toMatchObject({ general: true, name: 'General', headline: { fromFirstLine: true }, logo: { show: true } })
    expect(withGeneralAngle(c)).toBe(c)
    expect(withGeneralAngle(generalCampaign()).angles).toHaveLength(1)
  })

  it('makes a copy of it an ordinary angle', () => {
    const general = blankCampaign('c').angles[0]
    expect(copyAngle(general, 'x', 'Angle 2').general).toBeUndefined()
  })
})

describe('blankCampaign', () => {
  it('starts with no campaign content at all, and only its General angle - no angle to fill in', () => {
    const c = blankCampaign('x')
    expect(c.name).toBe('')
    expect(c.logo).toBeNull()
    expect(c.brandWords).toEqual([])
    expect(c.angles).toHaveLength(1)
    expect(c.angles[0]).toMatchObject({ id: 'x-general', general: true })
    expect(c.angles[0].headline.text).toBe('')
    expect(c.format).toBeUndefined()
  })
})

describe('parseWordList', () => {
  it('splits on commas, trims, and drops blanks and repeats', () => {
    expect(parseWordList(' inflow,  in   flow , ,Inflow')).toEqual(['inflow', 'in flow'])
    expect(parseWordList('')).toEqual([])
  })
})

describe('campaignProblems', () => {
  it('passes a named campaign with nothing else', () => {
    expect(campaignProblems({ ...blankCampaign('c'), name: 'Vertus' })).toEqual([])
  })

  it('refuses no name, and a logo with no brand name to bring it up', () => {
    expect(campaignProblems(blankCampaign('c'))).toHaveLength(1)
    expect(campaignProblems(vertus({ brandWords: [] }))).toHaveLength(1)
    expect(campaignProblems(vertus())).toEqual([])
  })
})

describe('angleProblems', () => {
  it('refuses an unnamed angle and two angles with the same name', () => {
    const c = vertus({ angles: [blankAngle('a', 'Sydney Sweeney'), blankAngle('b', 'sydney sweeney ')] })
    expect(angleProblems(c, c.angles[1])).toHaveLength(1)
    expect(angleProblems(c, { ...c.angles[0], name: ' ' })).toHaveLength(1)
  })

  it('refuses a sound on a word with no word, and one on the brand when there is no brand', () => {
    const angle = {
      ...blankAngle('a', 'School guy'),
      sounds: [
        { id: '1', source: { kind: 'built-in' as const, name: 'ding' as const }, trigger: { kind: 'words' as const, words: [] }, volumeDb: 0 },
        { id: '2', source: { kind: 'built-in' as const, name: 'pop' as const }, trigger: { kind: 'brand' as const }, volumeDb: 0 },
      ],
    }
    expect(angleProblems(vertus({ brandWords: [] }), angle)).toHaveLength(2)
    expect(angleProblems(vertus(), angle)).toHaveLength(1)
  })

  it('refuses timings and volumes outside the limits', () => {
    const base = blankAngle('a', 'A')
    expect(angleProblems(vertus(), { ...base, headline: { ...base.headline, seconds: 0 } })).toHaveLength(1)
    expect(angleProblems(vertus(), { ...base, logo: { ...base.logo, seconds: Number.NaN } })).toHaveLength(1)
  })
})

describe('videoLook', () => {
  it('uses the campaign logo and brand, and the angle format', () => {
    const angle = {
      ...blankAngle('a', 'A'),
      sounds: [{ id: '1', source: { kind: 'built-in' as const, name: 'ding' as const }, trigger: { kind: 'brand' as const }, volumeDb: -3 }],
    }
    const look = videoLook(vertus(), angle)
    expect(look.logo.image).toBe(logo)
    expect(look.logo.words).toEqual(['Vertus'])
    expect(look.sounds[0].trigger).toEqual({ kind: 'words', words: ['Vertus'] })
    expect(wordsToHear(look)).toEqual(['Vertus'])
  })

  it('leaves the logo off for an angle that does not show it, and then listens for nothing', () => {
    const angle = { ...blankAngle('a', 'A'), logo: { ...blankAngle('a', 'A').logo, show: false } }
    const look = videoLook(vertus(), angle)
    expect(look.logo.image).toBeNull()
    expect(wordsToHear(look)).toEqual([])
  })
})

describe('pictures on words', () => {
  const photo = new Blob(['jpg'], { type: 'image/jpeg' })

  it('refuses a picture with no words to bring it up', () => {
    const angle = { ...blankAngle('a', 'Sydney Sweeney'), pictures: [blankPicture('p', photo)] }
    expect(angleProblems(vertus(), angle)).toEqual(['Picture 1 needs the words that bring it up.'])
    angle.pictures[0].words = ['Sydney Sweeney']
    expect(angleProblems(vertus(), angle)).toEqual([])
  })

  it('listens for a picture’s words, and says it has pictures', () => {
    const angle = {
      ...blankAngle('a', 'A'),
      logo: { ...blankAngle('a', 'A').logo, show: false },
      pictures: [{ ...blankPicture('p', photo), words: ['Sydney Sweeney'] }],
    }
    expect(wordsToHear(videoLook(vertus(), angle))).toEqual(['Sydney Sweeney'])
    expect(describeAngle(vertus(), angle)).toBe('1 picture')
  })
})

describe('copyAngle', () => {
  it('copies the format under a new name without sharing anything with the original', () => {
    const from = {
      ...blankAngle('a', 'Sydney Sweeney'),
      sounds: [{ id: '1', source: { kind: 'built-in' as const, name: 'ding' as const }, trigger: { kind: 'start' as const }, volumeDb: -3 }],
    }
    const copy = copyAngle(from, 'b', 'Angle 2')
    expect(copy.name).toBe('Angle 2')
    expect(copy.headline).toEqual(from.headline)
    copy.headline.text = 'changed'
    expect(from.headline.text).toBe('')
    expect(copy.sounds[0].id).not.toBe('1')
  })
})

describe('describeAngle', () => {
  it('says what a video will get', () => {
    expect(describeAngle(vertus(), blankAngle('a', 'A'), 'GET PAID')).toBe('Headline 4s · Logo on "Vertus"')
    expect(describeAngle({ ...blankCampaign('c'), name: 'X' }, blankAngle('a', 'A'))).toMatch(/only the pauses/)
  })
})

describe('upgradeV1', () => {
  const v1: CampaignV1 = {
    id: 'inflow',
    name: 'Inflow',
    headline: { text: 'GET PAID TO POST', seconds: 4, position: 'top', style: 'box', size: 'medium' },
    logo: { image: 'the stored logo', words: ['inflow', 'in flow'], seconds: 2.5, position: 'bottom-left', widthPct: 30 },
    sounds: [
      { id: 's1', source: 'whoosh', trigger: { kind: 'start' }, volumeDb: -6 },
      { id: 's2', source: 'ding', trigger: { kind: 'words', words: ['In Flow', 'inflow'] }, volumeDb: -6 },
      { id: 's3', source: 'pop', trigger: { kind: 'words', words: ['money'] }, volumeDb: 0 },
    ],
    mentions: 'every',
    updatedAt: 5,
  }

  it('keeps everything he set up, as the campaign and one "Angle 1"', () => {
    const c = upgradeV1<string>(v1)
    expect(c).toMatchObject({ id: 'inflow', name: 'Inflow', logo: 'the stored logo', brandWords: ['inflow', 'in flow'], updatedAt: 5 })
    expect(c.angles).toHaveLength(1)
    const [angle] = c.angles
    expect(angle.id).toBe(firstAngleId('inflow'))
    expect(angle.name).toBe('Angle 1')
    expect(angle.headline).toEqual(v1.headline)
    expect(angle.logo).toEqual({ show: true, seconds: 2.5, position: 'bottom-left', widthPct: 30 })
    expect(angle.mentions).toBe('every')
  })

  it('turns a sound on the logo’s own words into a sound on the brand, and leaves others alone', () => {
    const [angle] = upgradeV1<string>(v1).angles
    expect(angle.sounds.map((s) => s.trigger)).toEqual([
      { kind: 'start' },
      { kind: 'brand' },
      { kind: 'words', words: ['money'] },
    ])
    expect(angle.sounds.map((s) => s.source)).toEqual(['whoosh', 'ding', 'pop'])
  })
})
