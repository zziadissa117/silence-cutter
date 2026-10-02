import { describe, expect, it } from 'vitest'

import { captionLead, captionRequest, finishCaption, finishTitle, isForbiddenTag, normalTag } from './caption.ts'

describe('finishCaption', () => {
  it('never says ad or paid partnership', () => {
    const out = finishCaption('This app changed my trading 🔥 #ad #Sponsored #crypto #PaidPartnership', [])
    expect(out).toBe('This app changed my trading 🔥 #crypto')
    expect(finishCaption('Paid partnership with Vertus. Love it #ai', [])).toBe('. Love it #ai')
  })

  it('adds a required hashtag that is missing, once', () => {
    expect(finishCaption('New coin just dropped\n\n#crypto #memecoin', ['#pumpfunpartner'])).toBe(
      'New coin just dropped\n\n#crypto #memecoin #pumpfunpartner',
    )
    expect(finishCaption('New coin #PumpFunPartner #crypto', ['pumpfunpartner'])).toBe('New coin #PumpFunPartner #crypto')
    expect(finishCaption('No tags here', ['#a', 'a'])).toBe('No tags here\n\n#a')
  })

  it('keeps a brand tag that merely contains "partner"', () => {
    expect(finishCaption('gm #pumpfunpartner #partner', [])).toBe('gm #pumpfunpartner #partner')
  })

  it('never adds a forbidden tag even when required', () => {
    expect(finishCaption('Hi', ['#ad'])).toBe('Hi')
  })

  it('drops quotes around the whole caption', () => {
    expect(finishCaption('"Comment CLIP and I\'ll send it over to you"', [])).toBe("Comment CLIP and I'll send it over to you")
  })
})

describe('tags', () => {
  it('normalises', () => {
    expect(normalTag('pumpfun partner')).toBe('#pumpfunpartner')
    expect(normalTag('##x')).toBe('#x')
    expect(normalTag('  ')).toBe('')
    expect(isForbiddenTag('#AD')).toBe(true)
    expect(isForbiddenTag('#pumpfunpartner')).toBe(false)
  })
})

describe('finishTitle', () => {
  it('has no hashtags and fits YouTube', () => {
    expect(finishTitle('Why I switched #crypto', [])).toBe('Why I switched')
    expect(finishTitle('x', ['The headline'])).toBe('The headline')
    expect(finishTitle('a'.repeat(150), []).length).toBeLessThanOrEqual(100)
  })
})

describe('captionRequest', () => {
  it('carries the rules, hashtags, headline and what he says', () => {
    const text = captionRequest({
      campaignName: 'Pump.fun',
      rules: 'Always add crypto hashtags.',
      hashtags: ['pumpfunpartner'],
      headline: 'This coin is wild',
      transcript: 'so I found this coin',
    })
    expect(text).toContain('Pump.fun')
    expect(text).toContain('Always add crypto hashtags.')
    expect(text).toContain('#pumpfunpartner')
    expect(text).toContain('This coin is wild')
    expect(text).toContain('so I found this coin')
  })
})

describe('a post made by hand', () => {
  it('tells Claude what the video is about instead of words never heard', () => {
    const text = captionRequest({ campaignName: 'Polsha', rules: '', hashtags: [], headline: '', transcript: '', about: 'my reaction to the new polish colours' })
    expect(text).toContain('What the video is about, as he describes it: my reaction to the new polish colours')
    expect(text).not.toContain('no words were heard')
  })

  it('tells Claude the stills are there, and to read the hook off them', () => {
    const text = captionRequest({ campaignName: 'Polsha', rules: '', hashtags: [], headline: '', transcript: '', stills: 4 })
    expect(text).toContain('4 stills from the video are attached, in order')
    expect(text).toContain('Read any text on screen')
  })

  it('still says no words were heard when there is nothing to go on', () => {
    expect(captionRequest({ campaignName: 'Polsha', rules: '', hashtags: [], headline: '', transcript: '' })).toContain('(no words were heard)')
  })

  it('takes a title from the first line of his caption, without the hashtags', () => {
    expect(captionLead('#fyp\nThis colour is unreal #nails #polsha\n\n#more')).toBe('This colour is unreal')
    expect(finishTitle('', ['', captionLead('#a #b'), 'Polsha'])).toBe('Polsha')
  })
})
