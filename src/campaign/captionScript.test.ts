import { describe, expect, it } from 'vitest'

import { fitToScript, scriptFrom } from './captionScript'

const heard = (text: string) => text.split(' ').map((t, i) => ({ text: t, start: i, end: i + 0.8 }))
const shown = (fit: { words: { text: string }[] }) => fit.words.map((w) => w.text).join(' ')

describe("a step's caption script (his ask, 2026-11-15)", () => {
  const script = 'Go to ChatGPT and paste this prompt.'

  it('the same words: matches, in the script\'s spelling and marks', () => {
    const fit = fitToScript(heard('go to chatgpt and paste this prompt'), script)
    expect(fit.matches).toBe(true)
    expect(shown(fit)).toBe('Go to ChatGPT and paste this prompt.')
  })

  it('"GPT" and "chat GPT" become "ChatGPT", on the heard times', () => {
    const one = fitToScript(heard('go to GPT and paste this prompt'), script)
    expect(one.matches).toBe(true)
    expect(shown(one)).toBe('Go to ChatGPT and paste this prompt.')
    const two = fitToScript(heard('go to chat GPT and paste this prompt'), script)
    expect(two.matches).toBe(true)
    expect(shown(two)).toBe('Go to ChatGPT and paste this prompt.')
    // "chat" (2) to "GPT" (3) made one word: from 2 to 3.8.
    expect(two.words[2]).toMatchObject({ start: 2, end: 3.8 })
    expect(two.respelled).toBe(1)
  })

  it('a small mishearing takes the script\'s word ("past" -> "paste")', () => {
    const fit = fitToScript(heard('go to chatgpt and past this prompt'), script)
    expect(fit.matches).toBe(true)
    expect(shown(fit)).toContain('paste')
  })

  it('what he really said differently is kept as heard and pointed out - never forced to the script', () => {
    const fit = fitToScript(heard('go to claude and paste this prompt'), script)
    expect(fit.matches).toBe(false)
    expect(shown(fit)).toContain('claude')
    expect(fit.diffs).toEqual([{ heard: 'claude', script: 'ChatGPT' }])
  })

  it('a word added or left out: no match, said where', () => {
    const added = fitToScript(heard('go to chatgpt and then paste this prompt'), script)
    expect(added.matches).toBe(false)
    expect(added.diffs).toEqual([{ heard: 'then', script: '' }])
    const missing = fitToScript(heard('go to chatgpt paste this prompt'), script)
    expect(missing.matches).toBe(false)
    expect(missing.diffs).toEqual([{ heard: '', script: 'and' }])
  })

  it('a script typed from approved captions', () => {
    expect(scriptFrom([{ text: ' Go ', start: 0, end: 1 }, { text: 'now!', start: 1, end: 2 }])).toBe('Go now!')
  })

  it('another form of a word he may really have said is never changed to the script\'s - it is pointed out', () => {
    for (const [said, wrote] of [
      ['prompts', 'prompt'],
      ['these', 'this'],
      ['used', 'use'],
      ['pasting', 'paste'],
    ] as const) {
      const fit = fitToScript(heard(`click ${said} now`), `Click ${wrote} now`)
      expect(fit.matches).toBe(false)
      expect(fit.words[1].text).toBe(said)
    }
  })

  it('words that only look a little alike are not swapped ("cat" for "chat", "app" for "apple")', () => {
    expect(fitToScript(heard('open the cat'), 'Open the chat').matches).toBe(false)
    expect(fitToScript(heard('open the app'), 'Open the apple').matches).toBe(false)
  })
})
