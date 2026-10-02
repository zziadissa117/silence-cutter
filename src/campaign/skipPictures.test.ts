import { describe, expect, it } from 'vitest'

import { without } from './skipPictures'

describe('without', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  it('drops the skipped ids', () => {
    expect(without(items, ['a'])).toEqual([{ id: 'b' }])
  })
  it('keeps everything when none are skipped', () => {
    expect(without(items, undefined)).toBe(items)
    expect(without(items, [])).toBe(items)
  })
})
