// Where his voice starts and stops in a talking head's clip, so the joins
// between clips are as tight as a cut in his talking videos (his report,
// 2026-11-14: "in between clips, there's too much separation").

import { describe, expect, it } from 'vitest'

import { PRESETS, type Level } from '../media/silenceMath'
import { voiceSpanOf } from './voiceSpan'

/** 20 ms levels: `parts` as [seconds, dB] one after the other. */
function levels(...parts: [number, number][]): Level[] {
  const out: Level[] = []
  let t = 0
  for (const [seconds, db] of parts) {
    for (let k = 0; k < Math.round(seconds / 0.02); k++) out.push({ time: +(t + k * 0.02).toFixed(3), db })
    t += seconds
  }
  return out
}

describe("his voice's span in a clip", () => {
  it('from his first word to his last, the waits before and after left out', () => {
    const span = voiceSpanOf(levels([1, -62], [1.5, -18], [0.4, -60], [1, -20], [1.2, -61]), PRESETS.balanced)!
    expect(span.start).toBeGreaterThan(0.9)
    expect(span.start).toBeLessThanOrEqual(1.0)
    expect(span.end).toBeGreaterThanOrEqual(3.9)
    expect(span.end).toBeLessThan(4.1)
  })

  it("finds the short breath a clip the Cutter edited keeps before and after his words (his report, 2026-11-14)", () => {
    // 0.15 s before his first word, 0.2 s after his last - under his pause
    // setting's minimum, and found all the same.
    for (const preset of [PRESETS.natural, PRESETS.balanced, PRESETS.tight]) {
      const span = voiceSpanOf(levels([0.16, -62], [1.4, -18], [0.2, -61]), preset)!
      expect(span.start).toBeGreaterThan(0.1)
      expect(span.start).toBeLessThanOrEqual(0.16)
      expect(span.end).toBeGreaterThanOrEqual(1.54)
      expect(span.end).toBeLessThan(1.62)
    }
  })

  it('a short pause between his words is not where his voice ends', () => {
    const span = voiceSpanOf(levels([0.3, -62], [0.8, -18], [0.15, -60], [0.6, -19], [0.4, -62]), PRESETS.balanced)!
    expect(span.start).toBeLessThanOrEqual(0.3)
    expect(span.end).toBeGreaterThanOrEqual(1.8)
  })

  it('a click at the very start is not his first word', () => {
    const span = voiceSpanOf(levels([0.04, -15], [0.8, -62], [1, -18], [0.6, -62]), PRESETS.balanced)!
    expect(span.start).toBeGreaterThan(0.8)
  })

  it('a clip with no voice in it is left as it is', () => {
    expect(voiceSpanOf(levels([2, -62]), PRESETS.balanced)).toBeNull()
    expect(voiceSpanOf([], PRESETS.balanced)).toBeNull()
  })
})
