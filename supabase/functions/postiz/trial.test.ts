import { describe, expect, it } from 'vitest'

import { batchInfo } from './batch.ts'
import { REWORDINGS, cleanRead, learnedLimit, readFromHook, trialAllowed, trialProblem, trialSpaces, withAllowed, withLimit, withNotAllowed } from './trial.ts'

describe('who may post Trial reels', () => {
  it('is the owner, and the logins he turned it on for', () => {
    expect(trialAllowed('owner', 'owner', [])).toBe(true)
    expect(trialAllowed('ilian', 'owner', ['ilian'])).toBe(true)
    expect(trialAllowed('stefan', 'owner', ['ilian'])).toBe(false)
  })

  it('reads the kept list whatever was stored', () => {
    expect(trialSpaces('["a","b",3]')).toEqual(['a', 'b'])
    expect(trialSpaces('not json')).toEqual([])
    expect(trialSpaces(null)).toEqual([])
    expect(trialSpaces('{"a":1}')).toEqual([])
  })
})

describe('a batch video marked as a trial', () => {
  it('keeps the trial flag only when it is exactly true', () => {
    const base = { id: 'b-1', date: '2026-11-05', time: '10:13', size: 3 }
    expect(batchInfo({ ...base, trial: true })?.trial).toBe(true)
    expect(batchInfo({ ...base, trial: 'yes' })?.trial).toBeUndefined()
    expect(batchInfo(base)).not.toHaveProperty('trial')
  })
})

describe("Instagram's trial refusals", () => {
  it('tells the daily limit from an account that cannot post trials', () => {
    expect(trialProblem('Instagram Trial Reel publish limit reached for this account, please try again later or publish the post as a regular Reel')).toBe('limit')
    expect(trialProblem('{"error":{"code":9,"error_subcode":2207078}}')).toBe('limit')
    expect(trialProblem("This account doesn't support Trial Reels")).toBe('not-allowed')
    expect(trialProblem('error_subcode 2207081')).toBe('not-allowed')
    expect(trialProblem('The video is too long')).toBeNull()
    expect(trialProblem(null)).toBeNull()
  })

  it('learns the limit from what went out, never under one', () => {
    expect(learnedLimit(20)).toBe(20)
    expect(learnedLimit(0)).toBe(1)
  })

  it('keeps the lower limit when told twice, and forgets "not allowed" once one goes out', () => {
    let t = withLimit(undefined, 'ig', 20, '2026-11-05T10:00:00Z')
    t = withLimit(t, 'ig', 25, '2026-11-05T11:00:00Z')
    expect(t.limits?.ig.perDay).toBe(20)
    t = withLimit(t, 'ig', 15, '2026-11-05T12:00:00Z')
    expect(t.limits?.ig.perDay).toBe(15)
    t = withNotAllowed(t, 'ig2', '2026-11-05T12:00:00Z')
    expect(t.notAllowed?.ig2).toBeTruthy()
    t = withAllowed(t, 'ig2')
    expect(t.notAllowed?.ig2).toBeUndefined()
    expect(t.limits?.ig.perDay).toBe(15)
  })
})

describe("Claude's reading of the viral reel", () => {
  it('keeps a safe look and only new rewordings', () => {
    const read = cleanRead({
      text: 'POV: you found the hack',
      style: 'weird',
      outlineColor: 'red',
      size: 'huge',
      x: 2,
      y: -1,
      rewordings: ['POV: you found the hack', 'POV: you found the trick', 'pov: YOU found the trick', '', 7, 'POV: you just found the hack'],
    })
    expect(read).toEqual({
      text: 'POV: you found the hack',
      style: 'outline',
      outlineColor: '#000000',
      size: 'medium',
      x: 0.95,
      y: 0.05,
      rewordings: ['POV: you found the trick', 'POV: you just found the hack'],
    })
  })

  it('caps the rewordings, and none without a text', () => {
    const many = Array.from({ length: 30 }, (_, i) => `hook ${i}`)
    expect(cleanRead({ text: 'hook', style: 'box', outlineColor: '#FFFFFF', size: 'large', x: 0.5, y: 0.5, rewordings: many })?.rewordings).toHaveLength(REWORDINGS)
    expect(cleanRead({ text: '', rewordings: many })?.rewordings).toEqual([])
    expect(cleanRead(null)).toBeNull()
  })

  it('takes his own words when he typed them', () => {
    expect(readFromHook('  my hook ')).toMatchObject({ text: 'my hook', rewordings: [] })
  })
})
