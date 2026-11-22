import { describe, expect, it } from 'vitest'

import { dropFor, loudness, snapToHit, songStart } from './beatDrop'

describe('a batch synced to its beat drop (his ask, 2026-11-23)', () => {
  it('starts the song so the drop lands on the switch', () => {
    // Drop at 31.5 s, reaction 4.2 s: the song from 27.3 s.
    expect(songStart(31.5, 4.2)).toBeCloseTo(27.3)
    // Music only from the switch (hook kept as filmed): from the drop.
    expect(songStart(31.5, 4.2, true)).toBe(31.5)
  })

  it('never cuts the reaction short: a drop too early just starts the song at its beginning', () => {
    expect(songStart(4, 6)).toBe(0)
  })

  it('only for a format synced to it, with the song marked', () => {
    const bank = { beatDrops: { s1: 12.4 } }
    expect(dropFor(bank, { syncDrop: true }, 's1')).toBe(12.4)
    expect(dropFor(bank, { syncDrop: true }, 's2')).toBeNull()
    expect(dropFor(bank, {}, 's1')).toBeNull()
    expect(dropFor(null, { syncDrop: true }, 's1')).toBeNull()
  })

  it('snaps a slightly late tap onto the hit', () => {
    const rate = 8000
    // Quiet for 3 s, then loud: the hit at 3.00 s.
    const song = new Float32Array(rate * 5)
    for (let i = 0; i < song.length; i++) song[i] = (i < rate * 3 ? 0.02 : 0.6) * Math.sin(i / 3)
    const level = loudness([song], rate)
    expect(snapToHit(level, 3.2)).toBeCloseTo(3, 1)
    // Nothing jumps near the tap: the tap as it was.
    expect(snapToHit(level, 1.5)).toBe(1.5)
  })
})
