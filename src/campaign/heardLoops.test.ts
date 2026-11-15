import { describe, expect, it } from 'vitest'

import { withoutLoops } from './heardLoops'

const words = (text: string) => text.split(' ').map((t, i) => ({ text: ` ${t}`, start: i * 0.2, end: i * 0.2 + 0.15 }))
const said = (list: { text: string }[]) => list.map((w) => w.text.trim()).join(' ')

describe('words the speech model made up', () => {
  it('one phrase looping over a clip he barely spoke in (his report, 2026-11-15: 83 French captions): nothing kept', () => {
    const heard = words(`C'est bon, ${'je vais vous dire que '.repeat(16).trim()} je`)
    expect(heard.length).toBeGreaterThan(80)
    expect(withoutLoops(heard).words).toEqual([])
  })

  it('a loop in the middle of real talking: the phrase once, the rest as said', () => {
    const heard = words('open the app and tap create tap create tap create then name your coin and press launch to see it go live today')
    expect(said(withoutLoops(heard).words)).toBe('open the app and tap create then name your coin and press launch to see it go live today')
  })

  it('what people really say is kept: a word said twice or three times, a phrase twice', () => {
    for (const text of ['no no no that is wrong', 'very very good stuff', 'do it do it now please']) {
      expect(said(withoutLoops(words(text)).words)).toBe(text)
    }
  })

  it('in English too, case and punctuation aside', () => {
    expect(withoutLoops(words('Thank you. thank you. Thank you! thank you.')).words).toEqual([])
  })
})
