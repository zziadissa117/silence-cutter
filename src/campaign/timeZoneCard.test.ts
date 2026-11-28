import { describe, expect, it } from 'vitest'

import { allZones, sameClock, zoneLabel, zoneOffset } from './TimeZoneCard'

describe('time zones', () => {
  it('says a zone as a person would', () => {
    expect(zoneLabel('America/Sao_Paulo')).toBe('Sao Paulo')
    expect(zoneLabel('UTC')).toBe('UTC')
  })
  it('gives the offset at a moment', () => {
    const winter = new Date('2026-01-15T12:00:00Z')
    expect(zoneOffset('America/Toronto', winter)).toBe('UTC-5')
    expect(zoneOffset('Asia/Kolkata', winter)).toBe('UTC+5:30')
    expect(zoneOffset('UTC', winter)).toBe('UTC+0')
  })
  it('does not ask when two zones keep the same clock', () => {
    const at = new Date('2026-11-28T12:00:00Z')
    expect(sameClock('America/Toronto', 'America/New_York', at)).toBe(true)
    expect(sameClock('America/Toronto', 'Europe/Paris', at)).toBe(false)
  })
  it('knows the zones', () => {
    expect(allZones()).toContain('Europe/Paris')
  })
})
