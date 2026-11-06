import { describe, expect, it } from 'vitest'

import { clipTexts, clipsOf, headlineSeconds, noSpeechIn } from './noTalk'
import { clipStarts, ringFraction } from './Recorder'

describe('a video with no talking: a reaction', () => {
  it('no talking: nothing heard, or a word or two the model made up', () => {
    expect(noSpeechIn([])).toBe(true)
    expect(noSpeechIn([{ text: ' you' }])).toBe(true)
    expect(noSpeechIn([{ text: '[Music]' }, { text: '(laughs)' }, { text: 'you' }, { text: 'oh' }])).toBe(true)
    expect(noSpeechIn([{ text: 'this' }, { text: 'app' }, { text: 'is' }, { text: 'crazy' }])).toBe(false)
    expect(noSpeechIn('Thank you. Thanks for watching!'.split(' ').map((text) => ({ text })))).toBe(true)
    // One phrase looping over a sound: made up.
    const loop = "you're not going to be a good one, ".repeat(5).trim().split(' ').map((text) => ({ text }))
    expect(noSpeechIn(loop)).toBe(true)
    // A real take repeats words too, but not like that.
    const real = 'so I tried this app for a week and honestly it changed how I edit my videos every single day'.split(' ').map((text) => ({ text }))
    expect(noSpeechIn(real)).toBe(false)
  })

  it('clips from where he flipped or paused', () => {
    expect(clipsOf([4.2, 9], 15)).toEqual([
      { start: 0, end: 4.2 },
      { start: 4.2, end: 9 },
      { start: 9, end: 15 },
    ])
    expect(clipsOf(undefined, 10)).toEqual([{ start: 0, end: 10 }])
  })

  it('the headline the whole video, or the first clip only', () => {
    const clips = clipsOf([4], 12)
    expect(headlineSeconds(true, clips, 3)).toBe(12)
    expect(headlineSeconds(false, clips, 3)).toBe(4)
    // One clip: the angle's own time.
    expect(headlineSeconds(false, clipsOf([], 12), 3)).toBe(3)
  })

  it('words on clip 2 and on, each up for its clip', () => {
    const texts = clipTexts(['', 'Here it is'], clipsOf([4, 8], 12), 'snap')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatchObject({ at: 8, seconds: 4, source: { kind: 'text', text: 'Here it is', style: 'snap' } })
  })
})

describe('the recorder', () => {
  it('marks where clips start, one per flip or pause, never at the very start or end', () => {
    expect(clipStarts([4200, 4300, 9000, 200, 14_900], 15_000)).toEqual([4.2, 9])
  })
  it('fills the ring a minute a lap, and goes round again after', () => {
    expect(ringFraction(0)).toBe(0)
    expect(ringFraction(30_000)).toBe(0.5)
    expect(ringFraction(60_000)).toBe(1)
    expect(ringFraction(90_000)).toBe(0.5)
  })
})
