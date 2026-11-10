import { describe, expect, it } from 'vitest'

import { cleanSong } from '../../supabase/functions/cutter/songs'
import { isPicture, isSound, isVideo, longestFor, ownFile, type ManualPicture } from './manualPictures'
import { mergeSongs } from './musicBank'
import { playedFor } from './render'

const sound = (from: 'bank' | 'effect' | 'phone', length?: number): ManualPicture => ({
  id: 's1',
  source: { kind: 'sound', from, ref: from === 'effect' ? 'whoosh' : 'x', name: 'Whoosh', ...(from === 'phone' ? { type: 'audio/mpeg' } : {}), volumeDb: -6 },
  at: 1,
  seconds: 2,
  position: 'middle',
  widthPct: 0,
  ...(length ? { length } : {}),
})

describe('sounds put on in the edit screen', () => {
  it('are never seen on the video', () => {
    for (const from of ['bank', 'effect', 'phone'] as const) {
      expect(isSound(sound(from))).toBe(true)
      expect(isPicture(sound(from))).toBe(false)
      expect(isVideo(sound(from))).toBe(false)
    }
  })

  it('keep a file with the video only when it came from his phone', () => {
    expect(ownFile(sound('phone'))).toBe('audio/mpeg')
    expect(ownFile(sound('bank'))).toBeNull()
    expect(ownFile(sound('effect'))).toBeNull()
  })

  it('play no longer than they are', () => {
    expect(longestFor(sound('bank', 12))).toBe(12)
  })

  it('are cut to how long he set, ending without a click', () => {
    const rate = 1000
    const [out] = playedFor([new Float32Array(3000).fill(1)], 2, rate)
    expect(out.length).toBe(2000)
    expect(out[1999]).toBeCloseTo(0)
    expect(out[1000]).toBe(1)
    // Shorter than that: as it is.
    expect(playedFor([new Float32Array(500).fill(1)], 2, rate)[0].length).toBe(500)
  })

  it('come from a sound effects bank shared like the songs', () => {
    const sha = 'a'.repeat(64)
    expect(cleanSong({ id: 'e1', name: 'Boom', type: 'audio/mpeg', size: 10, sha, sfx: true })?.sfx).toBe(true)
    expect(cleanSong({ id: 's1', name: 'Song', type: 'audio/mpeg', size: 10, sha })?.sfx).toBeUndefined()
    const merged = mergeSongs([], [{ id: 'e1', name: 'Boom', type: 'audio/mpeg', size: 10, sha, addedAt: 1, sfx: true }])
    expect(merged[0].sfx).toBe(true)
  })
})
