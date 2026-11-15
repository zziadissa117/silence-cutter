import { describe, expect, it } from 'vitest'

import { postKind } from './postKind'

describe('which kind of video a post is (his ask, 2026-11-15)', () => {
  it('a batch video is its format', () => {
    expect(postKind({ format: { kind: 'talking' } })).toBe('talking')
    expect(postKind({ format: { kind: 'reaction' } })).toBe('reaction')
    expect(postKind({ format: { kind: 'greenscreen', voice: true } })).toBe('talking')
    expect(postKind({ format: { kind: 'greenscreen' } })).toBe('reaction')
  })

  it('an older batch by whether he talks in it; his own videos are talking heads unless silent or a reaction campaign', () => {
    expect(postKind({ talks: false })).toBe('reaction')
    expect(postKind({})).toBe('talking')
    expect(postKind({ noSpeech: true })).toBe('reaction')
    expect(postKind({ reactionCampaign: true })).toBe('reaction')
  })
})
