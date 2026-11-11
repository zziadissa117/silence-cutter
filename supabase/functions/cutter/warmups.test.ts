import { describe, expect, it } from 'vitest'

import { categoriesFor, cleanIdea, cleanLink, filesOf, ideasFor, type WarmupIdea } from './warmups'

const sha = 'a'.repeat(64)
const raw = {
  id: 'w1',
  title: 'Point at the text',
  category: 'training',
  script: 'Look at the camera, point up when the text comes.',
  headline: 'POV: you started training',
  headlineStyle: 'snap',
  seconds: 7,
  sound: { sha, name: 'Trend', type: 'audio/mpeg', size: 1000 },
  example: { link: 'https://www.tiktok.com/@someone/video/123' },
}
const by = { space: 's1', name: 'stefan' }

describe('warm-up ideas', () => {
  it('are kept as sent, who sent them taken from the login', () => {
    const idea = cleanIdea({ ...raw, by: 'someone-else', status: 'approved' }, by, 'waiting')!
    expect(idea).toMatchObject({ id: 'w1', title: 'Point at the text', seconds: 7, headlineStyle: 'snap', by: 's1', byName: 'stefan', status: 'waiting' })
    expect(idea.example).toEqual({ link: 'https://www.tiktok.com/@someone/video/123' })
  })

  it('need a title and a category; the length stays between 3 and 30 seconds', () => {
    expect(cleanIdea({ ...raw, title: '' }, by, 'waiting')).toBeNull()
    expect(cleanIdea({ ...raw, category: '' }, by, 'waiting')).toBeNull()
    expect(cleanIdea({ ...raw, seconds: 99 }, by, 'waiting')!.seconds).toBe(30)
    expect(cleanIdea({ ...raw, seconds: 'x' }, by, 'waiting')!.seconds).toBe(7)
  })

  it('take a link only to Instagram or TikTok', () => {
    expect(cleanLink('https://www.instagram.com/reel/abc/')).toBe('https://www.instagram.com/reel/abc/')
    expect(cleanLink('https://evil.com/tiktok.com')).toBeNull()
    expect(cleanLink('http://www.tiktok.com/x')).toBeNull()
    expect(cleanIdea({ ...raw, sound: { sha, type: 'video/mp4', size: 1 } }, by, 'waiting')!.sound).toBeNull()
  })

  it("show approved ones to everyone, waiting ones to their sender and the owner; the owner's and partners' first", () => {
    const ideas = [
      { ...cleanIdea(raw, { space: 'other', name: 'o' }, 'approved')!, id: 'a', addedAt: 3 },
      { ...cleanIdea(raw, { space: 'owner', name: 'yes' }, 'approved')!, id: 'b', addedAt: 1 },
      { ...cleanIdea(raw, { space: 'ilyan', name: 'ilyan' }, 'approved')!, id: 'c', addedAt: 2 },
      { ...cleanIdea(raw, { space: 's1', name: 'stefan' }, 'waiting')!, id: 'd', addedAt: 4 },
    ] as WarmupIdea[]
    expect(ideasFor(ideas, 'other', 'owner', ['ilyan']).map((i) => i.id)).toEqual(['b', 'c', 'a'])
    expect(ideasFor(ideas, 's1', 'owner', ['ilyan']).map((i) => i.id)).toEqual(['b', 'c', 'd', 'a'])
    expect(ideasFor(ideas, 'owner', 'owner', ['ilyan']).map((i) => i.id)).toEqual(['b', 'c', 'd', 'a'])
    expect([...filesOf(ideasFor(ideas, 'other', 'owner', []))]).toEqual([sha])
  })

  it('start with Training and AI; a new category waits for the owner', () => {
    const waiting = { id: 'gym-1', name: 'Gym', status: 'waiting' as const, by: 's1', addedAt: 10 }
    expect(categoriesFor([], 'x', 'owner').map((c) => c.name)).toEqual(['Training', 'AI'])
    expect(categoriesFor([waiting], 'x', 'owner').map((c) => c.name)).toEqual(['Training', 'AI'])
    expect(categoriesFor([waiting], 's1', 'owner').map((c) => c.name)).toEqual(['Training', 'AI', 'Gym'])
    expect(categoriesFor([waiting], 'owner', 'owner').map((c) => c.name)).toEqual(['Training', 'AI', 'Gym'])
  })
})
