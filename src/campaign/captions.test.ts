import { describe, expect, it } from 'vitest'

import {
  CAPTION_LEAD,
  HEARD_LATE_SEC,
  MIN_SHOW_SEC,
  captionAt,
  captionWords,
  withRestored,
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
  CAPTION_STYLES,
  captionRanges,
  layoutPlainPhrase,
  drawStyledCaption,
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
  it('keeps a first word whose soft start sits in the cut before its stretch', () => {
    const words = [
      { text: ' So', start: 0.85, end: 1.25 },
      { text: ' listen.', start: 1.3, end: 1.7 },
    ]
    const keep = [{ start: 1.1, end: 2 }]
    const captions = captionWords(words, keep)
    expect(captions.map((w) => w.text)).toEqual(['So', 'listen.'])
    expect(captions[0].start).toBe(1.1)
  })

  it('still leaves out an "um" or a repeat cut just before a stretch', () => {
    const keep = [{ start: 1.1, end: 2 }]
    expect(captionWords([{ text: ' um', start: 0.8, end: 1.2 }, { text: ' listen', start: 1.3, end: 1.7 }], keep).map((w) => w.text)).toEqual(['listen'])
    expect(captionWords([{ text: ' I', start: 0.8, end: 1.2 }, { text: ' I', start: 1.3, end: 1.5 }], keep).map((w) => w.text)).toEqual(['I'])
  })

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

  it('keeps the last word of a phrase heard half a second late when the letter model could not time them', () => {
    const words = [
      { text: ' it', start: 3.9, end: 4.1 },
      { text: ' works.', start: 4.95, end: 5.4 },
      { text: ' And', start: 6.2, end: 6.4 },
    ]
    const keep = [
      { start: 3, end: 4.5 },
      { start: 6.1, end: 7 },
    ]
    // The sentence hasn't ended at "it", so "works." is its last word either way.
    expect(captionWords(words, keep).map((w) => w.text)).toEqual(['it', 'works.', 'And'])
    const rough = captionWords(words, keep, { rough: true })
    expect(rough.map((w) => w.text)).toEqual(['it', 'works.', 'And'])
    expect(rough[1].start).toBeLessThan(4.5)
  })

  it('always keeps the last words of the take, inside the video', () => {
    const words = [
      { text: ' link', start: 9.0, end: 9.2 },
      { text: ' in', start: 9.25, end: 9.35 },
      { text: ' bio.', start: 10.1, end: 10.5 },
    ]
    const keep = [{ start: 8, end: 9.4 }]
    const captions = captionWords(words, keep)
    expect(captions.map((w) => w.text)).toEqual(['link', 'in', 'bio.'])
    for (const c of captions) expect(c.start).toBeLessThan(9.4)
    captions.slice(1).forEach((c, i) => expect(c.start).toBeGreaterThan(captions[i].start))
  })

  it('pulls back several words heard late, in order, each with its moment', () => {
    const words = [
      { text: ' this', start: 1.0, end: 1.2 },
      { text: ' is', start: 2.05, end: 2.15 },
      { text: ' it.', start: 2.2, end: 2.4 },
      { text: ' Next', start: 4, end: 4.3 },
    ]
    const keep = [
      { start: 0.5, end: 2.0 },
      { start: 3.9, end: 5 },
    ]
    const captions = captionWords(words, keep)
    expect(captions.map((w) => w.text)).toEqual(['this', 'is', 'it.', 'Next'])
    expect(captions[1].start).toBeLessThan(captions[2].start)
    expect(captions[2].start).toBeLessThan(2.0)
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

  it("keeps a sentence's first word the model timed just before its stretch", () => {
    const words = [
      { text: ' it.', start: 1.5, end: 1.8 },
      { text: ' And', start: 2.55, end: 2.7 },
      { text: ' then', start: 2.9, end: 3.1 },
    ]
    const keep = [
      { start: 0, end: 1.9 },
      { start: 2.8, end: 4 },
    ]
    const captions = captionWords(words, keep)
    expect(captions.map((w) => w.text)).toEqual(['it.', 'And', 'then'])
    expect(captions[1].start).toBe(2.8)
  })

  it("gives each of a sentence's last words a quarter of a second, never a flash", () => {
    const words = [
      { text: ' this', start: 1.0, end: 1.2 },
      { text: ' is', start: 1.9, end: 1.98 },
      { text: ' it.', start: 2.1, end: 2.4 },
      { text: ' Next', start: 4, end: 4.3 },
    ]
    const keep = [
      { start: 0.5, end: 2.0 },
      { start: 3.9, end: 5 },
    ]
    const captions = captionWords(words, keep)
    expect(captions.map((w) => w.text)).toEqual(['this', 'is', 'it.', 'Next'])
    expect(2.0 - captions[2].start).toBeGreaterThanOrEqual(0.25 - 1e-9)
    expect(captions[2].start - captions[1].start).toBeGreaterThanOrEqual(0.25 - 1e-9)
    // On screen, each is up for that long before the next sentence comes in.
    const starts = captions.map((w) => w.start)
    const frames = (k: number) => Array.from({ length: 150 }, (_, f) => f / 30).filter((t) => captionAt(starts, captions, t) === k).length
    expect(frames(1)).toBeGreaterThanOrEqual(7)
    expect(frames(2)).toBeGreaterThanOrEqual(7)
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

  it('leaves out every phrase said while the headline is up', () => {
    expect(captionedIndices(words, keep, 4.5)).toEqual([4])
  })

  it('never starts the captions in the middle of a phrase', () => {
    // "This app changed my life", the headline going just after "This".
    const said = ['This', 'app', 'changed', 'my', 'life.'].map((text, i) => ({ text, start: 2.8 + i * 0.25, end: 3.0 + i * 0.25 }))
    expect(captionedIndices(said, keep, 3)).toEqual([0, 1, 2, 3, 4])
    // Mostly said under it: left out whole, the next phrase starts clean.
    const more = [...said, { text: 'Seriously.', start: 5, end: 5.4 }]
    expect(captionedIndices(more, keep, 3.6)).toEqual([5])
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

import { CAPTION_POSITIONS, CAPTION_SIZES, captionScale, captionY } from './captions'

describe('where the caption sits', () => {
  it('goes top to bottom in order, and usual is where it has always been', () => {
    const ys = CAPTION_POSITIONS.map((p) => p.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(captionY('usual')).toBe(0.66)
    expect(captionY('top')).toBeLessThan(captionY('middle'))
    expect(captionY('bottom')).toBeGreaterThan(captionY('usual'))
  })
})

describe('caption size', () => {
  it('normal is what captions have always been, and sizes grow in order', () => {
    expect(captionScale('normal')).toBe(1)
    const scales = CAPTION_SIZES.map((s) => s.scale)
    expect(scales).toEqual([...scales].sort((a, b) => a - b))
    expect(captionScale('small')).toBeLessThan(1)
    expect(captionScale('huge')).toBeGreaterThan(captionScale('large'))
  })
})

import { HIGHLIGHT_WORDS, phraseAt, phraseRanges, phrasesOf as phrasesFor } from './captions'

describe('Highlight: the phrase each word is shown in', () => {
  // "putting this on is gonna fix it, and honestly it took a week to see"
  const said = ['putting', 'this', 'on', 'is', 'gonna', 'fix', 'it,', 'and', 'honestly', 'it', 'took', 'a', 'week', 'to', 'see.']
  const words = said.map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }))

  it('never puts more than four words in a phrase, nor leaves one on its own', () => {
    const phrases = phrasesFor(words, HIGHLIGHT_WORDS)
    expect(Math.max(...phrases.map((p) => p.length))).toBeLessThanOrEqual(4)
    expect(Math.min(...phrases.map((p) => p.length))).toBeGreaterThan(1)
    expect(phrases.flat()).toEqual(words)
  })

  it('leaves the review list as it was: up to five words a phrase', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({ text: `w${i}`, start: i * 0.3, end: i * 0.3 + 0.25 }))
    expect(phrasesFor(long).map((p) => p.length)).toEqual([5, 5])
    expect(phrasesFor(long, HIGHLIGHT_WORDS).map((p) => p.length)).toEqual([4, 4, 2])
  })

  it('finds each word in its phrase, across phrase edges', () => {
    const ranges = phraseRanges(words)
    // Every word belongs to exactly one phrase, in order.
    words.forEach((_, i) => {
      const range = phraseAt(ranges, i)
      expect(range).not.toBeNull()
      expect(i).toBeGreaterThanOrEqual(range![0])
      expect(i).toBeLessThan(range![1])
    })
    expect(ranges[0][0]).toBe(0)
    expect(ranges[ranges.length - 1][1]).toBe(words.length)
    expect(phraseAt(ranges, -1)).toBeNull()
  })
})

describe('the Phrase style', () => {
  const said = (text: string, start: number) => text.split(' ').map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.25 }))
  const measure = (text: string, px: number) => text.length * px * 0.55

  it('is offered as the third style', () => {
    expect(CAPTION_STYLES.map((s) => s.label)).toEqual(['One word', 'Highlight', 'Phrase'])
  })

  it('takes longer phrases than Highlight, breaking at a full stop or a pause, never past seven words', () => {
    const words = [...said('so I tried this app.', 0), ...said('it made me four hundred dollars in a single day honestly', 2)]
    const plain = captionRanges(words, 'phrase')
    expect(plain[0]).toEqual([0, 5])
    for (const [from, to] of plain) expect(to - from).toBeLessThanOrEqual(7)
    expect(captionRanges(words, 'highlight').every(([f, t]) => t - f <= 4)).toBe(true)
  })

  it('is all lowercase, two lines at most, smaller than a headline', () => {
    const layout = layoutPlainPhrase(measure, 1080, 1920, said('Claude Made Me FOUR Hundred Dollars In One Day', 0))!
    expect(layout.lines.join(' ')).toBe('claude made me four hundred dollars in one day')
    expect(layout.lines.length).toBeLessThanOrEqual(2)
    expect(layout.fontPx).toBeLessThan(1080 * 0.066)
  })

  it('shrinks a long phrase rather than going to a third line', () => {
    const layout = layoutPlainPhrase(measure, 1080, 1920, said('extraordinarily unbelievable incomprehensibly overwhelming phenomenal astonishing breathtaking', 0))!
    expect(layout.lines.length).toBeLessThanOrEqual(2)
    for (const line of layout.lines) expect(measure(line, layout.fontPx)).toBeLessThanOrEqual(1080 * 0.84)
  })

  it('shows the same whole phrase for every word in it', () => {
    const words = said('this app changed everything', 0)
    const ranges = captionRanges(words, 'phrase')
    const drawn: string[] = []
    const ctx = {
      save() {},
      restore() {},
      set font(_: string) {},
      measureText: (t: string) => ({ width: t.length * 30 }),
      strokeText() {},
      fillText: (t: string) => drawn.push(t),
    } as unknown as CanvasRenderingContext2D
    for (let i = 0; i < words.length; i++) drawStyledCaption(ctx, 1080, 1920, words, ranges, i, 0, false, 'usual', 'normal', 'phrase')
    expect(new Set(drawn)).toEqual(new Set(['this app changed everything']))
    expect(drawn).toHaveLength(4)
  })
})

describe('withRestored', () => {
  const heard = [
    { text: ' So', start: 0.2, end: 0.5 },
    { text: ' um', start: 1.0, end: 1.2 },
    { text: ' listen.', start: 2.0, end: 2.4 },
  ]
  it('brings back the words of a part he has put back, keeping his fixes', () => {
    const fixed = [{ text: 'So,', start: 0.2, end: 0.5 }, { text: 'LISTEN.', start: 2.0, end: 2.4 }]
    const out = withRestored(fixed, heard, [{ start: 0, end: 0.9 }, { start: 1.8, end: 3 }], [{ start: 0, end: 3 }])
    expect(out.map((w) => w.text)).toEqual(['So,', 'um', 'LISTEN.'])
  })
  it('changes nothing when no part came back', () => {
    const fixed = [{ text: 'So,', start: 0.2, end: 0.5 }]
    expect(withRestored(fixed, heard, [{ start: 0, end: 3 }], [{ start: 0, end: 0.9 }])).toBe(fixed)
  })
})
