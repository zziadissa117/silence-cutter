import { describe, expect, it } from 'vitest'

import { serverTrouble, troubleNote, type ServerPing } from './serverWatch'

const NOW = Date.parse('2026-11-01T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const ping = (fields: Partial<ServerPing> = {}): ServerPing => ({ at: ago(5), chrome: 'running', freeGB: 3, pageAt: ago(1), signedIn: true, posting: true, ...fields })

describe('serverTrouble', () => {
  it('is nothing while it says it is well', () => {
    expect(serverTrouble(ping(), NOW)).toBeNull()
  })

  it('is quiet when it has said nothing for half an hour', () => {
    expect(serverTrouble(ping({ at: ago(45) }), NOW)).toBe('quiet')
  })

  it('is the page when the Cutter inside has stopped', () => {
    expect(serverTrouble(ping({ pageAt: ago(40) }), NOW)).toBe('page')
    expect(serverTrouble(ping({ chrome: 'off' }), NOW)).toBe('page')
  })

  it('is the disk when it is nearly full, and signed out when it lost its login', () => {
    expect(serverTrouble(ping({ freeGB: 0.2 }), NOW)).toBe('disk')
    expect(serverTrouble(ping({ signedIn: false }), NOW)).toBe('signed-out')
  })
})

describe('troubleNote', () => {
  it('says how long it has been quiet, and what to do', () => {
    expect(troubleNote('quiet', ping({ at: ago(45) }), NOW).body).toContain('45 minutes')
    expect(troubleNote(null, ping(), NOW).title).toBe('The Cutter server is making videos again')
  })
})
