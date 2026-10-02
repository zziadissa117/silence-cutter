import { describe, expect, it } from 'vitest'

import {
  CAPTION_LEAD,
  HEARD_LATE_SEC,
  MIN_SHOW_SEC,
  captionAt,
  captionWords,
  captionedIndices,
  bareWord,
  cleanWord,
  drawCaption,
  drawnWords,
  cutTime,
  phrasesOf,
  popScale,
  retimePhrase,
  snapToOnsets,
  spokenWords,
} from './captions'

describe('cleanWord', () => {
  it('drops spaces and trailing commas and full stops, keeps ? and !', () => {
    expect(cleanWord(' Hello,')).toBe('Hello')
    expect(cleanWord(' week.')).toBe('week')
    expect(cleanWord(' really?')).toBe('really?')
    expect(cleanWord(' wow!')).toBe('wow!')
    expect(cleanWord(" don't")).toBe("don't")
  })
})

describe('snapToOnsets', () => {
  const levels = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4].map((time) => ({ time, db: time < 0.2 ? -60 : -10 }))

  it('moves a start out of quiet onto the moment his voice starts', () => {
    const [word] = snapToOnsets([{ text: 'Hey', start: 0.28, end: 0.5 }], levels, -35)
    expect(word.start).toBeCloseTo(0.2)
  })

  it('leaves a word alone with no start close by', () => {
    const [word] = snapToOnsets([{ text: 'later', start: 0.36, end: 0.6 }], levels, -35)
    expect(word.start).toBe(0.36)
  })
})

describe('spokenWords', () => {
  it('brings every word back to when it is really said', () => {
    const [word] = spokenWords([{ text: ' Hey', start: 1, end: 1.3 }])
    expect(word.start).toBeCloseTo(1 - HEARD_LATE_SEC)
    expect(word.end).toBeCloseTo(1.3 - HEARD_LATE_SEC)
  })

  it('puts a number written in pieces back together', () => {
    const heard = [
      { text: ' rate', start: 1, end: 1.2 },
      { text: ' of', start: 1.2, end: 1.3 },
      { text: ' 2', start: 1.3, end: 1.4 },
      { text: '.8', start: 1.4, end: 1.6 },
      { text: '%,', start: 1.6, end: 1.8 },
      { text: ' makes', start: 2, end: 2.2 },
      { text: ' $20', start: 2.2, end: 2.4 },
      { text: ',000', start: 2.4, end: 2.7 },
    ]
    expect(spokenWords(heard).map((w) => w.text.trim())).toEqual(['rate', 'of', '2.8%,', 'makes', '$20,000'])
  })
})

describe('captionWords', () => {
  it('keeps only the words still in the video, punctuation and all', () => {
    const words = [
      { text: ' So,', start: 0.1, end: 0.3 },
      { text: ' um', start: 1.0, end: 1.2 },
      { text: ' listen.', start: 2.0, end: 2.4 },
      { text: ' .', start: 2.4, end: 2.5 },
    ]
    const keep = [
      { start: 0, end: 0.9 },
      { start: 1.8, end: 3 },
    ]
    expect(captionWords(words, keep).map((w) => w.text)).toEqual(['So,', 'listen.'])
  })

  it('keeps the last word before a pause that the model heard late', () => {
    const words = [
      { text: ' a', start: 4.4, end: 4.55 },
      { text: ' month.', start: 4.8, end: 5.2 },
      { text: ' Well,', start: 6, end: 6.3 },
    ]
    const keep = [
      { start: 3, end: 4.7 },
      { start: 5.9, end: 7 },
    ]
    const captions = captionWords(words, keep)
    expect(captions.map((w) => w.text)).toEqual(['a', 'month.', 'Well,'])
    expect(captions[1].start).toBeLessThan(4.7)
  })

  it('does not bring back a stumble or an "um" that was cut', () => {
    const words = [
      { text: ' I', start: 1, end: 1.1 },
      { text: ' I', start: 1.3, end: 1.4 },
      { text: ' um', start: 2.1, end: 2.3 },
      { text: ' think', start: 2.6, end: 2.9 },
    ]
    const keep = [
      { start: 0.5, end: 1.2 },
      { start: 2.5, end: 3.5 },
    ]
    expect(captionWords(words, keep).map((w) => w.text)).toEqual(['I', 'think'])
  })

  it('gives every word long enough to be seen', () => {
    const crowded = ['it', "'s", 'a', 'deal'].map((text, i) => ({ text: ` ${text}`, start: 1 + i * 0.01, end: 1.4 }))
    const words = captionWords(crowded, [{ start: 0, end: 5 }])
    words.slice(1).forEach((w, i) => expect(w.start - words[i].start).toBeGreaterThanOrEqual(MIN_SHOW_SEC - 1e-9))
    const starts = words.map((w) => w.start)
    const seen = new Set<number>()
    for (let t = 0.9; t < 2; t += 1 / 30) seen.add(captionAt(starts, words, t))
    for (let i = 0; i < words.length; i++) expect(seen.has(i)).toBe(true)
  })
})

describe('phrasesOf', () => {
  const said = (text: string, start: number) => ({ text, start, end: start + 0.2 })

  it('starts a new phrase after a full stop or a pause, and splits a long one evenly', () => {
    const words = [
      said('This', 0), said('is', 0.2), said('it.', 0.4),
      said('Then', 0.6), said('a', 0.8),
      said('pause', 1.6),
      ...'one two three four five six'.split(' ').map((t, i) => said(t, 2 + i * 0.2)),
    ]
    expect(phrasesOf(words).map((p) => p.map((w) => w.text).join(' '))).toEqual([
      'This is it.',
      'Then a',
      'pause one two three',
      'four five six',
    ])
  })

  it('splits at a comma once a phrase has a few words', () => {
    const words = 'So, if you sell abroad, you pay'.split(' ').map((t, i) => said(t, i * 0.2))
    expect(phrasesOf(words).map((p) => p.map((w) => w.text).join(' '))).toEqual(['So, if you sell abroad,', 'you pay'])
  })
})

describe('retimePhrase', () => {
  const phrase = [
    { text: 'we', start: 1, end: 1.2 },
    { text: 'here', start: 1.2, end: 1.5 },
  ]

  it('keeps every moment when the words are only corrected', () => {
    expect(retimePhrase(phrase, 'we hear')).toEqual([
      { text: 'we', start: 1, end: 1.2 },
      { text: 'hear', start: 1.2, end: 1.5 },
    ])
  })

  it('shares the phrase out when a missed word is typed in', () => {
    const words = retimePhrase(phrase, "we can't hear")
    expect(words.map((w) => w.text)).toEqual(['we', "can't", 'hear'])
    expect(words[0].start).toBe(1)
    expect(words[2].end).toBeCloseTo(1.5)
    words.slice(1).forEach((w, i) => expect(w.start).toBeGreaterThan(words[i].start))
  })

  it('keeps an emptied phrase, with nothing to show', () => {
    expect(retimePhrase(phrase, '  ').map((w) => w.text)).toEqual(['', ''])
  })
})

describe('captionAt', () => {
  const words = [
    { text: 'one', start: 0, end: 0.3 },
    { text: 'two', start: 0.3, end: 0.6 },
    { text: '', start: 0.6, end: 0.9 },
    { text: 'four', start: 2, end: 2.2 },
  ]
  const starts = [1, 1.3, 1.6, 3]

  it('shows each word from just before it is said until the next', () => {
    expect(captionAt(starts, words, 1 - CAPTION_LEAD)).toBe(0)
    expect(captionAt(starts, words, 1.2)).toBe(0)
    expect(captionAt(starts, words, 1.3)).toBe(1)
  })

  it('shows nothing before the first word, in a long gap, or for a word taken out', () => {
    expect(captionAt(starts, words, 0.5)).toBe(-1)
    expect(captionAt(starts, words, 1.65)).toBe(-1)
    expect(captionAt(starts, words, 2.6)).toBe(-1)
  })
})

describe('popScale', () => {
  it('pops past full size and settles', () => {
    expect(popScale(0)).toBeLessThan(0.8)
    expect(popScale(0.09)).toBeGreaterThan(1.05)
    expect(popScale(0.3)).toBe(1)
  })
})

describe('cutTime', () => {
  const keep = [
    { start: 1, end: 3 },
    { start: 5, end: 8 },
  ]

  it('counts only what was kept', () => {
    expect(cutTime(2, keep)).toBe(1)
    expect(cutTime(6, keep)).toBe(3)
  })

  it('puts a moment in a cut gap where the next range starts', () => {
    expect(cutTime(4, keep)).toBe(2)
    expect(cutTime(0.5, keep)).toBe(0)
  })
})

describe('captionedIndices', () => {
  const keep = [{ start: 0, end: 10 }]
  const words = [0.5, 2, 3.9, 4.1, 6].map((start) => ({ text: 'w', start, end: start + 0.3 }))

  it('leaves out every word said while the headline is up', () => {
    expect(captionedIndices(words, keep, 4)).toEqual([3, 4])
  })

  it('captions everything when there is no headline', () => {
    expect(captionedIndices(words, keep, 0)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('captions with no punctuation', () => {
  it('leave off ? and ! and quotes too', () => {
    expect(bareWord('what?!')).toBe('what')
    expect(bareWord(' "really?" ')).toBe('really')
    expect(bareWord('(wait)')).toBe('wait')
    expect(bareWord('so…')).toBe('so')
    expect(bareWord('Hello,')).toBe('Hello')
  })

  it("keep what belongs to the word", () => {
    expect(bareWord("don't")).toBe("don't")
    expect(bareWord('well-known,')).toBe('well-known')
    expect(bareWord('2.5')).toBe('2.5')
    expect(bareWord('10,000.')).toBe('10,000')
    expect(bareWord('50%!')).toBe('50%')
    expect(bareWord('$20?')).toBe('$20')
  })

  it('drop a word that was only punctuation, and leave the rest alone when off', () => {
    const words = [
      { text: 'wait', start: 0, end: 0.3 },
      { text: '—', start: 0.3, end: 0.4 },
      { text: 'what?', start: 0.4, end: 0.8 },
    ]
    expect(drawnWords(words, true)).toEqual([
      { text: 'wait', start: 0, end: 0.3 },
      { text: 'what', start: 0.4, end: 0.8 },
    ])
    expect(drawnWords(words, false)).toBe(words)
  })
})

describe('drawing a caption', () => {
  const drawn = (text: string, bare: boolean) => {
    const said: string[] = []
    const ctx = new Proxy(
      { measureText: () => ({ width: 10 }), fillText: (t: string) => said.push(t) },
      { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => {}), set: () => true },
    ) as unknown as CanvasRenderingContext2D
    drawCaption(ctx, 1080, 1920, text, 1, bare)
    return said
  }

  it('keeps ? and ! unless he asked for none', () => {
    expect(drawn('what?!', false)).toEqual(['what?!'])
    expect(drawn('what?!', true)).toEqual(['what'])
  })
})
