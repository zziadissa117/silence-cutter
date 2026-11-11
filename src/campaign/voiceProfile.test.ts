import { describe, expect, it } from 'vitest'

import { PRESETS, type Level } from '../media/silenceMath'
import { measureProfile, pickProfile, soundsLike, withProfile } from './voiceProfile'

function levelsOf(spans: [number, number, number][]): Level[] {
  const out: Level[] = []
  for (const [from, to, db] of spans) for (let t = from; t < to - 1e-9; t += 0.02) out.push({ time: Math.round(t * 100) / 100, db })
  return out
}

// 3 s of room, then talking: words with short gaps and their quiet ends, a
// long pause, "um"s.
const setup = levelsOf([
  [0, 3, -62],
  ...Array.from({ length: 30 }, (_, i): [number, number, number][] => [
    [3 + i * 0.5, 3 + i * 0.5 + 0.3, -18],
    [3 + i * 0.5 + 0.3, 3 + i * 0.5 + 0.38, -40], // the word's quiet end
    [3 + i * 0.5 + 0.38, 3 + i * 0.5 + 0.5, -60], // the gap
  ]).flat(),
  [18, 19, -61],
  [19, 19.5, -26],
  [19.5, 20, -61],
  [20, 20.4, -27],
  [20.4, 21, -61],
])

describe('your voice, measured once (his ask, 2026-11-11)', () => {
  it('reads the room, the voice, how words end, the natural gap and the "um"', () => {
    const p = measureProfile(setup, { quietEnd: 3, readStart: 3, readEnd: 18, umStart: 18.5, umEnd: 21 }, 'iPhone Microphone', 1)!
    expect(p.roomDb).toBe(-62)
    expect(p.speechDb).toBe(-18)
    expect(p.tailDb).toBeLessThanOrEqual(-38)
    expect(p.gapSec).toBeGreaterThan(0.08)
    expect(p.gapSec).toBeLessThan(0.2)
    expect(p.umDb).toBeGreaterThan(-28)
    expect(p.mic).toBe('iPhone Microphone')
  })

  it("can't be read when there is no voice above the room", () => {
    expect(measureProfile(levelsOf([[0, 20, -50]]), { quietEnd: 3, readStart: 3, readEnd: 18 })).toBeNull()
  })

  it('puts the line under his word endings, keeps his natural gaps, and is left out on another mic', () => {
    const p = measureProfile(setup, { quietEnd: 3, readStart: 3, readEnd: 18 })!
    const take = setup.slice(0, 900)
    const tuned = withProfile(PRESETS.tight, take, p)
    expect(tuned.used).toBe(true)
    expect(tuned.settings.thresholdDb).toBeLessThan(PRESETS.tight.thresholdDb)
    expect(tuned.settings.thresholdDb).toBeLessThan(p.tailDb)
    expect(tuned.settings.minSilenceSec).toBeGreaterThanOrEqual(PRESETS.tight.minSilenceSec)
    // A far louder voice: another mic - left as it was.
    const loud = take.map((l) => ({ ...l, db: l.db + 20 }))
    expect(soundsLike(loud, p)).toBe(false)
    expect(withProfile(PRESETS.tight, loud, p)).toEqual({ settings: PRESETS.tight, used: false, profile: null })
    expect(withProfile(PRESETS.tight, take, null).used).toBe(false)
  })
})

describe('several voices: with his mic, without (his ask, 2026-11-11)', () => {
  const p = measureProfile(setup, { quietEnd: 3, readStart: 3, readEnd: 18 })!
  const mic = { ...p, id: 'mic', name: 'Rode' }
  const phone = { ...p, id: 'phone', name: 'Phone mic', speechDb: p.speechDb - 9, roomDb: p.roomDb + 6, tailDb: p.tailDb - 3 }
  const take = setup.slice(0, 900)

  it('each video takes the voice it sounds most like', () => {
    expect(pickProfile(take, [phone, mic]).profile?.id).toBe('mic')
    const quieter = take.map((l) => ({ ...l, db: l.db - 9 }))
    expect(pickProfile(quieter, [mic, phone]).profile?.id).toBe('phone')
  })

  it('a pinned voice is used whatever the video sounds like; none matching is none', () => {
    const loud = take.map((l) => ({ ...l, db: l.db + 25 }))
    expect(pickProfile(loud, [mic, phone]).profile).toBeNull()
    expect(pickProfile(loud, [mic, phone], 'phone')).toEqual({ profile: phone, pinned: true })
    expect(withProfile(PRESETS.tight, loud, [mic, phone], 'phone').used).toBe(true)
  })
})
