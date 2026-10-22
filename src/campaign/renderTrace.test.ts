import { describe, expect, it } from 'vitest'

import { traceLine, traceRead, traceReset, traceStart, traceStarted, traceStep, traceWritten } from './renderTrace'

describe('where a stuck video stopped', () => {
  it('says the step it was at, for how long, and how many frames went through', () => {
    traceReset()
    expect(traceStarted()).toBe(false)
    traceStart(0)
    traceStep('making the frames', 1000)
    traceRead()
    traceRead()
    traceWritten()
    expect(traceStarted()).toBe(true)
    expect(traceLine(93_000)).toBe('at "making the frames" for 92 s, 2 frames read, 1 written')
    traceStart(0)
    expect(traceLine(90_000)).toBe('at "opening the video" for 90 s, 0 frames read, 0 written')
  })
})
