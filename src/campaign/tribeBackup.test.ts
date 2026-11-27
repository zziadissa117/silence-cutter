import { describe, expect, it } from 'vitest'

import { backupIds, needsBackup, onlyOnServer } from './tribeBackup'

describe('Trybe backups', () => {
  it('names the three files from the job id, in the letters the server takes', () => {
    expect(backupIds('abc-1')).toEqual({ video: 'tribe-abc-1-video', recording: 'tribe-abc-1-rec', row: 'tribe-abc-1-meta' })
    const ids = backupIds('a:b/c.d')
    expect(ids.row).toBe('tribe-a_b_c_d-meta')
    for (const id of Object.values(backupIds('x'.repeat(200)))) expect(id).toMatch(/^[A-Za-z0-9_-]{1,80}$/)
  })

  it('backs up each new go once', () => {
    expect(needsBackup({ tribe: {} })).toBe(true)
    expect(needsBackup({ tribe: { backedUp: 1 } })).toBe(false)
    expect(needsBackup({ tribe: { backedUp: 1 }, version: 2 })).toBe(true)
    expect(needsBackup({ version: 2 })).toBe(false)
  })

  it('finds the videos only the server has', () => {
    const files = { 'tribe-a-meta': {}, 'tribe-a-video': {}, 'tribe-b-meta': {}, 'tribe-b-rec': {}, 'clip-1': {} }
    expect(onlyOnServer(files, ['a'])).toEqual(['tribe-b-meta'])
    expect(onlyOnServer(files, ['a', 'b'])).toEqual([])
  })
})
