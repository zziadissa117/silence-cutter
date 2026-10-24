import { describe, expect, it } from 'vitest'

import { emptyBank, type BatchBank } from './batch'
import { assumedLook, changeHeadline, dropHook, dropLook, groupHooks, hookOfJob, hookOfPost, hookStats, lookChoices, sameHook, swapLook, weakHooks, type HookStat } from './batchHooks'
import type { Job } from './jobs'
import type { ServerPost } from './posting'

const post = (fields: Partial<ServerPost> & { headline: string; status: string }): ServerPost =>
  ({ id: fields.headline + fields.status + Math.random(), key: 'k', campaignId: 'c1', batch: { id: 'b', date: '2026-10-24', time: '12:00', size: 3 }, ...fields }) as unknown as ServerPost
const job = (headlineText: string, look?: 'box' | 'outline' | 'snap' | 'formula'): Job =>
  ({ id: `j-${headlineText}`, campaignId: 'c1', headlineText, status: 'queued', batch: { id: 'b', date: '2026-10-24', time: '12:00', size: 3, ...(look ? { look } : {}) } }) as unknown as Job
const bank = (fields: Partial<BatchBank> = {}): BatchBank => ({ ...emptyBank('c1', 'a1'), headlines: ['POV: it works', 'Wait for it'], ...fields })

describe("a video's hook", () => {
  it('is its look and words, Claude + X by its look or its headline', () => {
    expect(hookOfPost(post({ headline: 'POV: it works', status: 'posted', batch: { id: 'b', date: '2026-10-24', time: '12:00', size: 3, look: 'snap' } }))).toEqual({ look: 'snap', words: 'POV: it works' })
    expect(hookOfPost(post({ headline: 'POV: it works', status: 'posted' }))).toEqual({ look: null, words: 'POV: it works' })
    expect(hookOfPost(post({ headline: 'Claude + Lovable = $800 a day', status: 'posted' }))).toEqual({ look: 'formula', words: '' })
    expect(hookOfPost(post({ headline: '$650 a day', status: 'posted' }))).toEqual({ look: 'formula', words: '' })
    expect(hookOfJob(job('Wait for it', 'box'))).toEqual({ look: 'box', words: 'Wait for it' })
  })

  it('matches by words whatever the case, and by look when both know it', () => {
    expect(sameHook({ look: null, words: 'pov: IT works' }, { look: 'snap', words: 'POV: it works' })).toBe(true)
    expect(sameHook({ look: 'box', words: 'POV: it works' }, { look: 'snap', words: 'POV: it works' })).toBe(false)
    expect(sameHook({ look: 'formula', words: '' }, { look: 'formula', words: '' })).toBe(true)
    expect(sameHook({ look: 'formula', words: '' }, { look: null, words: 'POV: it works' })).toBe(false)
  })
})

describe('how each hook is doing', () => {
  const posts = [
    post({ headline: 'POV: it works', status: 'posted', views: { a: 1000, b: 400 } }),
    post({ headline: 'POV: it works', status: 'posted', views: { a: 600 } }),
    post({ headline: 'POV: it works', status: 'scheduled' }),
    post({ headline: 'Wait for it', status: 'posted', views: { a: 100 } }),
    post({ headline: 'Wait for it', status: 'posted' }),
    post({ headline: 'Claude + Lovable = $800 a day', status: 'posted', views: { a: 50 } }),
    post({ headline: 'Claude + Lovable = $650 a day', status: 'rejected' }),
    post({ headline: 'POV: it works', status: 'posted', campaignId: 'other', views: { a: 9 } }),
  ]
  const jobs = [job('Wait for it'), job('Wait for it')]

  it('counts posted, read, views and waiting per hook, most views first', () => {
    const stats = hookStats(posts, jobs, bank(), [])
    expect(stats.map((s) => [s.words || s.look, s.posted, s.read, s.views, s.waiting])).toEqual([
      ['POV: it works', 2, 2, 1000, 1],
      ['Wait for it', 2, 1, 100, 2],
      ['formula', 1, 1, 50, 0],
    ])
    expect(stats.map((s) => s.inMix)).toEqual([true, true, false])
  })

  it('tells a weak hook from the rest only once enough of each is read', () => {
    const many = (headline: string, views: number, n: number) => Array.from({ length: n }, () => post({ headline, status: 'posted', views: { a: views } }))
    const stats = hookStats([...many('POV: it works', 900, 6), ...many('Wait for it', 120, 5)], [], bank(), [])
    expect(weakHooks(stats).map((s) => s.words)).toEqual(['Wait for it'])
    const early = hookStats([...many('POV: it works', 900, 6), ...many('Wait for it', 120, 4)], [], bank(), [])
    expect(weakHooks(early)).toEqual([])
    const close = hookStats([...many('POV: it works', 900, 6), ...many('Wait for it', 500, 5)], [], bank(), [])
    expect(weakHooks(close)).toEqual([])
  })
})

describe('changing the mix', () => {
  it('drops a headline, or Claude + X from the looks, never the last look', () => {
    expect(dropHook(bank({ used: { 'Wait for it': 3 } }), { look: null, words: 'wait for it' }, []).headlines).toEqual(['POV: it works'])
    expect(dropHook(bank({ used: { 'Wait for it': 3 } }), { look: null, words: 'wait for it' }, []).used).toEqual({})
    const mixed = [{ look: 'box' as const, parts: 1 }, { look: 'formula' as const, parts: 1 }]
    expect(dropHook(bank({ looks: mixed }), { look: 'formula', words: '' }, mixed).looks).toEqual([{ look: 'box', parts: 1 }])
    expect(dropHook(bank({ looks: [mixed[1]] }), { look: 'formula', words: '' }, [mixed[1]]).looks).toEqual([mixed[1]])
    expect(dropLook(bank({ looks: mixed }), 'box', mixed).looks).toEqual([mixed[1]])
  })

  it('changes the words of a headline, starting it fresh', () => {
    const next = changeHeadline(bank({ used: { 'Wait for it': 3 } }), 'wait for it', ' Wait till the end ')
    expect(next.headlines).toEqual(['POV: it works', 'Wait till the end'])
    expect(next.used).toEqual({})
    expect(changeHeadline(bank(), 'Wait for it', '').headlines).toEqual(['POV: it works'])
  })
})

describe('the lines the Batch tab shows', () => {
  const stat = (look: HookStat['look'], words: string, posted: number, read: number, views: number | null, waiting = 0): HookStat => ({ look, words, posted, read, views, waiting, inMix: true })
  it('groups a headline across its looks, with the views averaged by how many were read', () => {
    const rows = groupHooks([stat('box', 'POV', 2, 2, 100), stat('snap', 'POV', 1, 1, 400), stat('formula', '', 3, 3, 50, 2)], 'words')
    expect(rows.map((r) => [r.words || r.look, r.posted, r.read, r.views, r.waiting])).toEqual([
      ['POV', 3, 3, 200, 0],
      ['formula', 3, 3, 50, 2],
    ])
  })
  it('groups by look, the angle\'s own for videos from before', () => {
    const rows = groupHooks([stat('box', 'POV', 2, 2, 100), stat('box', 'Wait', 1, 1, 700), stat(null, 'POV', 1, 0, null)], 'look')
    expect(rows.map((r) => [r.look, r.posted, r.views])).toEqual([
      ['box', 3, 300],
      [null, 1, null],
    ])
  })
})

describe('changing a look', () => {
  it('moves its share to the new look and takes it out of the mix', () => {
    const b = bank({ looks: [{ look: 'snap', parts: 2 }, { look: 'formula', parts: 1 }, { look: 'box', parts: 1 }] })
    expect(swapLook(b, 'formula', 'snap').looks).toEqual([{ look: 'snap', parts: 3 }, { look: 'box', parts: 1 }])
    expect(swapLook(b, 'box', 'outline').looks).toEqual([{ look: 'snap', parts: 2 }, { look: 'formula', parts: 1 }, { look: 'outline', parts: 1 }])
  })

  it('offers the looks that can make videos', () => {
    const logo = { id: 'l', name: 'l.png', type: 'image/png', size: 1 }
    expect(lookChoices(bank(), 'snap', ['box', 'outline', 'snap', 'formula'])).toEqual(['box', 'outline'])
    expect(lookChoices(bank({ formula: { left: logo, right: logo, min: 1, max: 2 } }), 'snap', ['box', 'outline', 'snap', 'formula'])).toEqual(['box', 'outline', 'formula'])
    expect(lookChoices(bank({ headlines: [] }), 'formula', ['box', 'outline', 'snap', 'formula'])).toEqual([])
  })

  it('counts a video from before looks were kept in the batch\'s one headline look', () => {
    const b = bank({ looks: [{ look: 'snap', parts: 1 }, { look: 'formula', parts: 1 }] })
    expect(assumedLook(b)).toBe('snap')
    expect(hookOfPost(post({ headline: 'POV: it works', status: 'scheduled' }), assumedLook(b))).toEqual({ look: 'snap', words: 'POV: it works' })
    expect(hookOfPost(post({ headline: '$650 a day', status: 'scheduled' }), assumedLook(b))).toEqual({ look: 'formula', words: '' })
    expect(assumedLook(bank({ looks: [{ look: 'snap', parts: 1 }, { look: 'box', parts: 1 }] }))).toBeNull()
    // No look picked: the angle's own.
    expect(assumedLook(bank(), 'outline')).toBe('outline')
    expect(assumedLook(bank({ looks: [{ look: 'formula', parts: 1 }] }), 'box')).toBe('box')
    expect(assumedLook(bank({ looks: [{ look: 'snap', parts: 1 }] }), 'box')).toBe('snap')
  })
})
