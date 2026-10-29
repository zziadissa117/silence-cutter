import { describe, expect, it } from 'vitest'

import { cleanLoginName, isActive, songPrefix } from './invite'

describe('cleanLoginName', () => {
  it('takes a plain name, in lower case', () => {
    expect(cleanLoginName(' Kari.B ')).toBe('kari.b')
    expect(cleanLoginName('jake_99')).toBe('jake_99')
  })

  it('turns down admin, short, long and odd names', () => {
    for (const bad of ['admin', 'ADMIN', 'ab', 'a'.repeat(31), 'kari b', 'kari/b', 5, null]) expect(cleanLoginName(bad)).toBeNull()
  })
})

describe('isActive', () => {
  it('lets only active spaces in, and rows from before the column', () => {
    expect(isActive({})).toBe(true)
    expect(isActive({ status: null })).toBe(true)
    expect(isActive({ status: 'active' })).toBe(true)
    expect(isActive({ status: 'invited' })).toBe(false)
    expect(isActive({ status: 'paused' })).toBe(false)
  })
})

describe('songPrefix', () => {
  it("keeps the owner's songs where they are and gives anyone else their own", () => {
    expect(songPrefix('own', 'own')).toBe('song:')
    expect(songPrefix('kari', 'own')).toBe('song@kari:')
    // The owner's prefix never matches another's rows, nor theirs his.
    expect('song@kari:x'.startsWith(songPrefix('own', 'own'))).toBe(false)
  })
})
