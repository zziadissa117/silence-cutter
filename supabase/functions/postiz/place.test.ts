import { describe, expect, it } from 'vitest'

import { cleanPlace, instagramPlace, parsePlace } from './place'

describe('the place Instagram posts are tagged with', () => {
  it('reads a place from its ID or a link to it', () => {
    expect(parsePlace('110970792260960')).toEqual({ id: '110970792260960', name: 'Place 110970792260960' })
    expect(parsePlace('https://www.facebook.com/pages/Los-Angeles-California/110970792260960')).toEqual({ id: '110970792260960', name: 'Los Angeles California' })
    expect(parsePlace('facebook.com/profile.php?id=108424279189115')).toEqual({ id: '108424279189115', name: 'Place 108424279189115' })
    expect(parsePlace('https://www.facebook.com/Miami-Florida-110148382341970/')).toEqual({ id: '110148382341970', name: 'Miami Florida' })
    expect(parsePlace('https://www.instagram.com/explore/locations/212999109/los-angeles-california/')).toEqual({ id: '212999109', name: 'Los Angeles California' })
  })

  it('says nothing when no ID can be read', () => {
    expect(parsePlace('https://www.facebook.com/LosAngeles')).toBeNull()
    expect(parsePlace('Los Angeles')).toBeNull()
    expect(parsePlace('')).toBeNull()
  })

  it("takes a campaign's own place over the default", () => {
    const settings = {
      instagramPlace: { id: '110970792260960', name: 'Los Angeles' },
      campaigns: { zi: { instagramPlace: { id: '108424279189115', name: 'New York' } }, other: {} },
    }
    expect(instagramPlace(settings, 'zi')?.name).toBe('New York')
    expect(instagramPlace(settings, 'other')?.name).toBe('Los Angeles')
    expect(instagramPlace({}, 'zi')).toBeNull()
    expect(cleanPlace({ id: 'abc', name: 'x' })).toBeNull()
  })
})
