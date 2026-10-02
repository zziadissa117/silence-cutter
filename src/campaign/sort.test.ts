import { describe, expect, it } from 'vitest'

import { blankAngle, blankCampaign, blankPicture, generalCampaign, withGeneralAngle, type Campaign } from './look'
import { dayWords, firstLineHeadline, recognizedBy, sortVideo } from './sort'

const heard = (sentence: string) =>
  sentence.split(' ').map((text, i) => ({ text: ` ${text}`, start: i * 0.3, end: i * 0.3 + 0.25 }))

const photo = new Blob(['x'])

const inflow: Campaign = {
  ...blankCampaign('inflow'),
  name: 'Inflow',
  brandWords: ['Inflow'],
  angles: [blankAngle('inflow-a1', 'Angle 1')],
}
const vertus: Campaign = {
  ...blankCampaign('vertus'),
  name: 'Vertus',
  brandWords: ['Vertus'],
  angles: [
    { ...blankAngle('sydney', 'Sydney Sweeney'), pictures: [{ ...blankPicture('p', photo), words: ['Sydney Sweeney'] }] },
    blankAngle('creepy', 'Creepy guy at school'),
  ],
}
const campaigns = [inflow, vertus, generalCampaign()]

describe('sortVideo', () => {
  it('puts a video where its angle’s words are heard', () => {
    const guess = sortVideo(heard('Vertus just posted about Sidney Sweeney wow'), campaigns)
    expect(guess).toMatchObject({ campaignId: 'vertus', angleId: 'sydney', sure: true })
  })

  it('knows the angle from the brand alone when the campaign has only one', () => {
    expect(sortVideo(heard('I found this app called Enflow today'), campaigns)).toMatchObject({
      campaignId: 'inflow',
      sure: true,
    })
  })

  it('asks when the brand is heard but not which of its angles', () => {
    const guess = sortVideo(heard('this guy at school on Vertus kept staring'), campaigns)
    expect(guess).toMatchObject({ campaignId: 'vertus', sure: false })
    expect(guess.why).toMatch(/not which angle/)
  })

  it('asks when two campaigns are heard', () => {
    expect(sortVideo(heard('Inflow or Vertus which pays more'), campaigns).sure).toBe(false)
  })

  it('sends a video with no campaign in it to General', () => {
    expect(sortVideo(heard('I asked ChatGPT to plan my week'), campaigns)).toMatchObject({
      campaignId: 'general',
      angleId: 'general-a1',
      sure: true,
    })
  })

  it('sends a campaign’s video that fits none of its angles to its General angle', () => {
    const withGeneral = [inflow, withGeneralAngle(vertus), generalCampaign()]
    const guess = sortVideo(heard('this guy at school on Vertus kept staring'), withGeneral)
    expect(guess).toMatchObject({ campaignId: 'vertus', angleId: 'vertus-general', sure: true })
  })

  it('still picks the one angle with no words of its own - that is the catch-all', () => {
    const withGeneral = [withGeneralAngle(inflow), vertus, generalCampaign()]
    expect(sortVideo(heard('I found this app called Enflow today'), withGeneral)).toMatchObject({
      campaignId: 'inflow',
      angleId: 'inflow-a1',
      sure: true,
    })
  })

  it('a new campaign, with only its General angle, sorts there', () => {
    const fresh: Campaign = { ...blankCampaign('amboras'), name: 'Amboras', brandWords: ['Amboras'] }
    expect(sortVideo(heard('okay so Amboras just changed everything'), [fresh, generalCampaign()])).toMatchObject({
      campaignId: 'amboras',
      angleId: 'amboras-general',
      sure: true,
    })
  })

  it('uses an angle’s own words over its pictures’', () => {
    const angle = { ...vertus.angles[1], recognize: ['creepy'] }
    expect(recognizedBy(angle)).toEqual(['creepy'])
    expect(recognizedBy(vertus.angles[0])).toEqual(['Sydney Sweeney'])
  })
})

describe('firstLineHeadline', () => {
  it('is his first sentence, as said', () => {
    expect(firstLineHeadline(heard('um so I found an app that pays. It is great'))).toBe('So I found an app that pays')
  })

  it('stops at eight words', () => {
    expect(firstLineHeadline(heard('this is the longest opening line I have ever said on camera'))).toBe(
      'This is the longest opening line I have',
    )
  })

  it('is empty when nothing was heard', () => {
    expect(firstLineHeadline([])).toBe('')
  })
})

describe('dayWords', () => {
  it('names brands first, each once, and stops before the prompt is too long', () => {
    const bank = Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, image: photo, words: [`Product${i}`], addedAt: i }))
    const words = dayWords(campaigns, bank)
    expect(words.slice(0, 2)).toEqual(['Inflow', 'Vertus'])
    expect(words).toContain('Sydney Sweeney')
    expect(words.join(', ').length).toBeLessThanOrEqual(480)
    expect(new Set(words).size).toBe(words.length)
  })
})
