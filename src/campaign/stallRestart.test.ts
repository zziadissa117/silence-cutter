import { beforeEach, describe, expect, it } from 'vitest'

import { firstRestartFor } from './stallRestart'

beforeEach(() => localStorage.clear())

describe('starting the Cutter again when the phone stops making a video', () => {
  it('does it once per video, then lets the video go the usual way', () => {
    const now = Date.parse('2026-10-22T18:00:00Z')
    expect(firstRestartFor('job-a', now)).toBe(true)
    expect(firstRestartFor('job-a', now + 60_000)).toBe(false)
    // Another video stuck after it gets its own fresh start.
    expect(firstRestartFor('job-b', now + 120_000)).toBe(true)
  })

  it('forgets after a few hours, so a video made again another day can have one', () => {
    const now = Date.parse('2026-10-22T18:00:00Z')
    expect(firstRestartFor('job-a', now)).toBe(true)
    expect(firstRestartFor('job-a', now + 7 * 3_600_000)).toBe(true)
  })
})
