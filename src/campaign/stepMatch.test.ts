// Dropped-in clips sorted into product steps by what he says in them
// (his ask, 2026-11-13).

import { describe, expect, it } from 'vitest'

import { withLeeway } from './prepareDrop'
import { PRESETS } from '../media/silenceMath'
import { learned, matchStep, wordsOf } from './stepMatch'

const steps = [
  { id: 'a', name: 'Step 1: Nope, do this instead' },
  { id: 'b', name: 'Open the app' },
  { id: 'c', name: 'Paste your prompt' },
]

describe('which step a clip goes to', () => {
  it('reads a step name without its "Step 1:"', () => {
    expect(wordsOf('Step 1: Nope, do this instead')).toEqual(['nope', 'do', 'this', 'instead'])
    expect(wordsOf("Don't do that")).toEqual(['dont', 'do', 'that'])
  })

  it('goes to the step whose name he says, sure of it', () => {
    expect(matchStep('Nope. Do this instead.', steps)).toEqual({ stepId: 'a', sure: true })
    expect(matchStep('okay so now you open the app right here', steps)).toEqual({ stepId: 'b', sure: true })
    expect(matchStep('then you paste your prompt in the box', steps)).toEqual({ stepId: 'c', sure: true })
  })

  it('says it is not sure when it is close or nothing fits', () => {
    expect(matchStep('nope, do it', steps)).toMatchObject({ stepId: 'a', sure: false })
    expect(matchStep('this is the best thing ever', steps).sure).toBe(false)
    // Clearly none of them (a hook, where the format takes hooks).
    expect(matchStep('hello everybody', steps)).toEqual({ stepId: null, sure: true })
  })

  it('learns how he says it from clips he moved there', () => {
    const taught = [...steps.slice(0, 2), { ...steps[2], heard: learned(undefined, 'drop the text you wrote in there') }]
    expect(matchStep('just drop the text you wrote in there', taught)).toEqual({ stepId: 'c', sure: true })
    // Remembered newest first, no repeats, at most a dozen.
    let heard: string[] = []
    for (let i = 0; i < 20; i++) heard = learned(heard, `phrase ${i}`)
    expect(heard).toHaveLength(12)
    expect(learned(['a', 'b'], 'b')).toEqual(['b', 'a'])
  })
})

describe('the cut of a dropped-in clip', () => {
  it('is his usual cut with a little more room', () => {
    const cut = withLeeway(PRESETS.balanced)
    expect(cut.minSilenceSec).toBeGreaterThan(PRESETS.balanced.minSilenceSec)
    expect(cut.paddingSec).toBeGreaterThan(PRESETS.balanced.paddingSec)
    expect(cut.thresholdDb).toBe(PRESETS.balanced.thresholdDb)
  })
})
