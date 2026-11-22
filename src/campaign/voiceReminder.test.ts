import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../report', () => ({ report: vi.fn() }))

import { ASK_AGAIN_AFTER_MS, voiceReminder } from './VoiceSetup'

const DAY = 86_400_000
const voice = (at: number) => ({ id: 'v0', name: 'Phone mic', roomDb: -60, speechDb: -20, tailDb: -45, gapSec: 0.3, at })

describe('the voice reminder (Stefan, 2026-11-23: asked to redo it every time)', () => {
  beforeEach(() => localStorage.clear())

  it('asks for a voice when there is none', () => {
    expect(voiceReminder()).toBe('none')
  })

  it('never asks again within two weeks of setting one up, however his videos sound', () => {
    const now = Date.now()
    localStorage.setItem('voice.profiles', JSON.stringify([voice(now - 3 * DAY)]))
    localStorage.setItem('voice.offCount', '9')
    expect(voiceReminder(now)).toBeNull()
  })

  it('asks once the newest voice is older than that and his videos still sound unlike it', () => {
    const now = Date.now()
    localStorage.setItem('voice.profiles', JSON.stringify([voice(now - ASK_AGAIN_AFTER_MS - DAY)]))
    localStorage.setItem('voice.offCount', '2')
    expect(voiceReminder(now)).toBe('changed')
    localStorage.setItem('voice.offCount', '1')
    expect(voiceReminder(now)).toBeNull()
  })
})
