import { describe, expect, it } from 'vitest'

import { clipFor, unusedClips, type ClipInfo } from './clips'

const HOUR = 60 * 60 * 1000
const clip = (id: string, addedAt: number): ClipInfo => ({ id, name: `${id}.mov`, type: 'video/quicktime', size: 1, seconds: 3, addedAt })

describe('clipFor', () => {
  it("takes the video's own pick, then none, then the angle's", () => {
    expect(clipFor(undefined, 'hook')).toBe('hook')
    expect(clipFor('other', 'hook')).toBe('other')
    expect(clipFor('none', 'hook')).toBeNull()
    expect(clipFor(undefined, undefined)).toBeNull()
  })
})

describe('unusedClips', () => {
  const now = 10 * HOUR
  it('keeps what an angle or a waiting video uses, and anything just added', () => {
    const clips = [clip('angle', 0), clip('picked', 0), clip('fresh', now - 60_000), clip('old', 0)]
    const unused = unusedClips(clips, { 'c/a': { before: 'angle' } }, ['picked'], now)
    expect(unused).toEqual(['old'])
  })

  it('lets go of a clip once nothing uses it', () => {
    expect(unusedClips([clip('hook', 0)], {}, [], now)).toEqual(['hook'])
    expect(unusedClips([clip('hook', 0)], { 'c/a': { after: 'hook' } }, [], now)).toEqual([])
  })
})
