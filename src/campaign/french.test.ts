// French videos (his ask, 2026-11-12: "my friend is going to do a French
// video ... He doesn't have to choose. It just automatically sets those"):
// the language told from the model's scores, French as heard made ready for
// captions, French "euh"s, and what French hearing makes up over silence.

import { describe, expect, it } from 'vitest'

import { isFillerWord } from '../media/fillerWords'
import { languageFromScores, languageTokens, speechSample } from '../media/speechLanguage'
import { noSpeechIn } from './noTalk'
import { frenchWords } from './plan'

const tokens = { en: 1, fr: 2, all: [1, 2, 3, 4] }
const row = (en: number, fr: number, other = -5) => [0, en, fr, other, other]

describe('telling English from French', () => {
  it('is French when the model is clearly surer of French', () => {
    expect(languageFromScores(row(1, 4), tokens).language).toBe('fr')
  })

  it('is English when English wins, or when it is close - an accent is still English', () => {
    expect(languageFromScores(row(4, 1), tokens).language).toBe('en')
    expect(languageFromScores(row(2, 2.2), tokens).language).toBe('en')
  })

  it('is English when the scores make no sense', () => {
    expect(languageFromScores([0, NaN, NaN], tokens).language).toBe('en')
  })

  it("reads the model's language tokens", () => {
    expect(languageTokens({ '<|en|>': 50259, '<|fr|>': 50265, '<|de|>': 50261 })).toEqual({ en: 50259, fr: 50265, all: [50259, 50265, 50261] })
    expect(languageTokens(null)).toBeNull()
    expect(languageTokens({ '<|en|>': 1 })).toBeNull()
  })

  it('listens to his talking only, at most 30 seconds of it', () => {
    const rate = 100
    const samples = Float32Array.from({ length: 100 * rate }, (_, i) => i)
    const picked = speechSample(samples, rate, [{ start: 1, end: 2 }, { start: 5, end: 6 }], 0)
    expect(picked.length).toBe(200)
    expect(picked[0]).toBe(100)
    expect(picked[100]).toBe(500)
    expect(speechSample(samples, rate, [{ start: 0, end: 90 }], 0).length).toBe(30 * rate)
  })
})

describe('French as heard, for captions', () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.3 })

  it('keeps a "?" French writes after a space with its word', () => {
    const out = frenchWords([w(' Tu', 0), w(' vois', 0.4), w(' ?', 0.8)])
    expect(out.map((x) => x.text)).toEqual([' Tu', ' vois ?'])
  })

  it('drops the subtitle credits it makes up over silence, and keeps what he said', () => {
    const out = frenchWords([w(' Bonjour', 0), w(' à', 0.4), w(' tous.', 0.8), w(' Sous', 5), w('-titres', 5.3), w(' réalisés', 5.6), w(' par', 6), w(' la', 6.2), w(' communauté', 6.4), w(" d'Amara.org", 6.8)])
    expect(out.map((x) => x.text.trim())).toEqual(['Bonjour', 'à', 'tous.'])
  })

  it('cuts his "euh"s like "um"s', () => {
    expect(isFillerWord(' euh')).toBe(true)
    expect(isFillerWord('Euhh,')).toBe(true)
    // Said on purpose.
    expect(isFillerWord(' ben')).toBe(false)
  })

  it('takes the credits alone as nobody talking - a French take is talking', () => {
    expect(noSpeechIn([{ text: ' Sous-titres' }, { text: ' réalisés' }, { text: ' par' }, { text: ' la' }, { text: ' communauté' }, { text: " d'Amara.org" }])).toBe(true)
    expect(noSpeechIn([{ text: ' Merci.' }])).toBe(true)
    expect(noSpeechIn("C'est la meilleure appli que j'ai testée".split(' ').map((text) => ({ text: ` ${text}` })))).toBe(false)
  })
})

describe('the French model a phone hears with', () => {
  it('starts with the best, and steps down for good after the page died while listening', async () => {
    const { frenchStep } = await import('../media/transcribe')
    localStorage.clear()
    expect(frenchStep()).toBe(0)
    // The page died while French was being heard with the best model.
    localStorage.setItem('speech.frenchTrying', '0')
    expect(frenchStep()).toBe(1)
    expect(frenchStep()).toBe(1)
    localStorage.setItem('speech.frenchTrying', '1')
    expect(frenchStep()).toBe(2)
    // Never past the smallest.
    localStorage.setItem('speech.frenchTrying', '2')
    expect(frenchStep()).toBe(2)
  })

  it('does not step down when he closed the page himself', async () => {
    const { frenchStep } = await import('../media/transcribe')
    localStorage.clear()
    localStorage.setItem('speech.frenchTrying', '0')
    window.dispatchEvent(new Event('pagehide'))
    expect(frenchStep()).toBe(0)
  })
})
