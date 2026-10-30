import { describe, expect, it } from 'vitest'

import { MAX_DEVICES, cleanLoginName, deviceFrom, isActive, roomForDevice, songPrefix } from './invite'

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

describe('deviceFrom', () => {
  it('takes a phone id and a short name', () => {
    expect(deviceFrom({ id: 'a'.repeat(22), name: ' iPhone  Safari ' })).toEqual({ id: 'a'.repeat(22), name: 'iPhone Safari' })
    expect(deviceFrom({ id: 'b'.repeat(22) })).toEqual({ id: 'b'.repeat(22), name: 'A phone' })
  })

  it('turns down anything else', () => {
    for (const bad of [null, 'x', { id: 'short' }, { id: 'a b'.repeat(10) }, { id: 5 }]) expect(deviceFrom(bad)).toBeNull()
  })
})

describe('roomForDevice', () => {
  const phone = (id: string) => ({ device_id: id })
  const device = { id: 'new-phone-0000000000', name: 'x' }

  it('lets a phone already on the login back in', () => {
    expect(roomForDevice([phone('new-phone-0000000000')], device)).toBe('known')
  })

  it('takes a new phone while there is room, and refuses one past the most', () => {
    expect(roomForDevice([phone('a')], device)).toBe('new')
    expect(roomForDevice(Array.from({ length: MAX_DEVICES }, (_, i) => phone(`p${i}`)), device)).toBe('full')
  })
})
