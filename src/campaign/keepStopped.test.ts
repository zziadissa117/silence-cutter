import { describe, expect, it } from 'vitest'
import type { BatchBank } from './batch'
import { keepStopped, stoppedSince } from './batchRun'

const bank = (over: Partial<BatchBank>): BatchBank => ({ campaignId: 'c', reactions: [], products: [], headlines: [], music: [], ...over }) as unknown as BatchBank

describe('a top-up never undoes a Stop made while it planned', () => {
  it('keeps the batch stopped when it was stopped meanwhile', async () => {
    let saved: BatchBank | null = null
    const stored = bank({ running: false, startedAt: 'a' })
    const save = keepStopped(async (b) => void (saved = b), async () => stored)
    await save(bank({ running: true, startedAt: 'a', madeThrough: '2026-11-10' }))
    expect(saved!.running).toBe(false)
    expect(saved!.madeThrough).toBe('2026-11-10')
  })

  it('leaves a Start since alone, and a batch nobody stopped', () => {
    expect(stoppedSince({ running: true, startedAt: 'a' }, { running: false, startedAt: 'b' })).toBe(false)
    expect(stoppedSince({ running: true, startedAt: 'a' }, { running: true, startedAt: 'a' })).toBe(false)
    expect(stoppedSince({ running: true, startedAt: 'a' }, null)).toBe(false)
    expect(stoppedSince({ running: true, startedAt: 'a' }, { running: false, startedAt: 'a' })).toBe(true)
  })
})
