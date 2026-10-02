import { describe, expect, it } from 'vitest'

import { joinPlans, type CampaignPlan } from './plan'

const plan = (duration: number, keep: [number, number][], words: [string, number, number][]): CampaignPlan => ({
  keep: keep.map(([start, end]) => ({ start, end })),
  duration,
  silences: keep.length - 1,
  fillerWords: 1,
  stutters: 0,
  words: words.map(([text, start, end]) => ({ text, start, end })),
  spoken: words.map(([text, start, end]) => ({ text, start, end })),
  aligned: true,
  cleanSpeech: false,
})

describe('joinPlans', () => {
  it("moves each part's cuts and words to where it sits in the joined file", () => {
    const selfie = plan(6, [[0.5, 2], [3, 5.5]], [['oh', 0.6, 0.8], ['no', 3.1, 3.3]])
    const back = plan(4, [[0.2, 3.8]], [['look', 0.3, 0.6]])
    const joined = joinPlans([selfie, back], [0, 6.02], 10.02)
    expect(joined.duration).toBe(10.02)
    expect(joined.keep).toEqual([
      { start: 0.5, end: 2 },
      { start: 3, end: 5.5 },
      { start: 6.22, end: 9.82 },
    ])
    expect(joined.words.map((w) => [w.text, +w.start.toFixed(2)])).toEqual([
      ['oh', 0.6],
      ['no', 3.1],
      ['look', 6.32],
    ])
    expect(joined.spoken).toHaveLength(3)
    expect(joined.aligned).toBe(true)
    expect(joined.silences).toBe(1)
    expect(joined.fillerWords).toBe(2)
  })

  it('a part heard before caption timing existed leaves the words to be timed as heard', () => {
    const old = { ...plan(3, [[0, 3]], [['hi', 0.1, 0.3]]), spoken: undefined, aligned: undefined }
    const joined = joinPlans([old, plan(2, [[0, 2]], [])], [0, 3], 5)
    expect(joined.spoken).toBeUndefined()
    expect(joined.aligned).toBeUndefined()
  })
})
