import { describe, expect, it } from 'vitest'

import { limitsLine } from './PostingLimits'
import type { Limits, Profile } from './posting'

const account = (id: string, platform: string) => ({ id, name: id, platform, profile: id, picture: '', disabled: false })

const profile = (limits?: Limits): Profile => ({
  id: 'p',
  accounts: [account('a', 'tiktok'), account('b', 'tiktok'), account('c', 'youtube')],
  settings: { limits },
  timezone: 'UTC',
  hasAnthropic: false,
  vapidPublic: null,
})

describe('the Settings row for pause and daily limits', () => {
  it('says when nothing is set', () => {
    expect(limitsLine(profile())).toBe('Nothing paused, no daily limits')
  })

  it('names paused platforms and counts the rest', () => {
    const line = limitsLine(
      profile({
        platforms: { youtube: { paused: true }, tiktok: { perDay: 4 } },
        accounts: { a: { paused: true }, b: { perDay: 2 }, gone: { paused: true } },
      }),
    )
    // An account no longer in Postiz isn't counted.
    expect(line).toBe('YouTube paused · 1 account paused · 2 with a daily limit')
  })
})
