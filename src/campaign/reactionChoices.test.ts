// The reaction campaigns offered (Reaction video) and the one a video with no
// talking is sorted into: never the Trial reels campaign (found 2026-11-15).

import { describe, expect, it } from 'vitest'

import { reactionChoices, type Campaign } from './look'

const campaign = (id: string, fields: Partial<Campaign> = {}) => ({ id, name: id, logo: null, brandWords: [], angles: [], updatedAt: 0, ...fields }) as Campaign

describe('reactionChoices', () => {
  it('lists the reaction campaigns and leaves the Trial reels one out', () => {
    const list = [campaign('trial', { format: 'reaction', trial: true }), campaign('talk'), campaign('notes', { format: 'reaction' })]
    expect(reactionChoices(list).map((c) => c.id)).toEqual(['notes'])
  })
})
