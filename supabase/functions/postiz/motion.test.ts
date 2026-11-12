import { describe, expect, it } from 'vitest'

import { DEFAULT_CTA, MOTION_ANSWER, MOTION_SYSTEM, cleanReply, cleanStoryboard, fakeStoryboard, motionMessage, numberedWords, parseMotionAnswer } from './motion.ts'

describe('the motion graphics storyboard Claude writes, made safe', () => {
  it('keeps every word number inside the words and scenes apart, in order', () => {
    const board = cleanStoryboard(
      {
        hook: null,
        end: null,
        scenes: [
          { from: 20, to: 40, says: 'b', parts: [{ kind: 'title', at: 99, text: 'Second' }] },
          { from: 2, to: 25, says: 'a', parts: [{ kind: 'title', at: 1, text: 'First' }] },
        ],
      },
      30,
    )
    expect(board.scenes.map((s) => [s.from, s.to])).toEqual([
      [2, 19],
      [20, 29],
    ])
    expect(board.scenes[0].parts[0].at).toBe(2)
    expect(board.scenes[1].parts[0].at).toBe(29)
  })

  it('drops parts it cannot draw and scenes left empty', () => {
    const board = cleanStoryboard(
      { hook: null, end: null, scenes: [{ from: 0, to: 5, says: '', parts: [{ kind: 'video', at: 1 }, { kind: 'title', at: 1, text: '  ' }] }] },
      10,
    )
    expect(board.scenes).toEqual([])
  })

  it('caps lists, keeps tones it knows, and keeps prices only for two phones', () => {
    const board = cleanStoryboard(
      {
        hook: null,
        end: null,
        scenes: [
          {
            from: 0,
            to: 9,
            says: 'x',
            parts: [
              { kind: 'cards', at: 0, cards: Array.from({ length: 5 }, () => ({ badge: 'cpm', tone: 'pink', at: 0, lines: [] })) },
              { kind: 'phones', at: 1, items: [{ text: '50', at: 1 }, { text: '10 000', at: 2, lit: true }], sign: '=', prices: [{ text: '25 $', at: 3 }] },
              { kind: 'tiles', at: 2, count: 400, steps: [{ at: 3, filled: 99, tone: 'green', locked: true }] },
            ],
          },
        ],
      },
      10,
    )
    const [cards, phones, tiles] = board.scenes[0].parts
    expect(cards.kind === 'cards' && cards.cards.length).toBe(3)
    expect(cards.kind === 'cards' && cards.cards[0]).toMatchObject({ badge: 'CPM', tone: 'purple' })
    expect(phones.kind === 'phones' && phones.sign).toBe('=')
    expect(phones.kind === 'phones' && phones.prices).toEqual([{ text: '25 $', at: 3 }])
    expect(tiles.kind === 'tiles' && [tiles.count, tiles.steps[0].filled]).toEqual([30, 30])
  })

  it('keeps the hook before the first scene', () => {
    const board = cleanStoryboard(
      { hook: { at: 0, to: 20, label: 'per month', text: '+10 000 $' }, end: { at: 50, text: 'Follow for more' }, scenes: [{ from: 6, to: 9, says: '', parts: [{ kind: 'note', at: 6, text: 'hi' }] }] },
      12,
    )
    expect(board.hook).toMatchObject({ at: 0, to: 5 })
    expect(board.end).toMatchObject({ at: 11, text: 'Follow for more' })
  })

  it('answers nothing for nothing', () => {
    expect(cleanStoryboard(null, 10).scenes).toEqual([])
    expect(cleanStoryboard({ scenes: [] }, 0).scenes).toEqual([])
    expect(cleanReply({ reply: '  Made the title bigger.  ' })).toBe('Made the title bigger.')
    expect(fakeStoryboard(20).scenes.length).toBe(2)
  })

  it('numbers the words for Claude, a line per sentence with its time', () => {
    const text = numberedWords(['I', 'make', '10K.', 'Here', 'is', 'how.'], [0, 0.4, 0.8, 1.5, 1.8, 2])
    expect(text).toBe('0.0s [0]I [1]make [2]10K.\n1.5s [3]Here [4]is [5]how.')
    const message = motionMessage(text, '', { hook: null, scenes: [], end: null }, [{ from: 'him', text: 'bigger' }])
    expect(message).toContain('Him: bigger')
    expect(message).toContain('The storyboard now:')
  })
})


describe("Claude's answer as plain JSON (the strict schema was too complex for the API)", () => {
  it('reads the JSON with or without a code fence or words around it', () => {
    expect(parseMotionAnswer('{"reply":"ok","scenes":[]}')).toEqual({ reply: 'ok', scenes: [] })
    expect(parseMotionAnswer('```json\n{"reply":"ok"}\n```')).toEqual({ reply: 'ok' })
    expect(parseMotionAnswer('Here it is: {"a":1} done')).toEqual({ a: 1 })
    expect(parseMotionAnswer('no json')).toBeNull()
    expect(parseMotionAnswer('{broken')).toBeNull()
  })

  it('a full answer in the shape Claude is shown comes through cleaned', () => {
    const answer = parseMotionAnswer(`\`\`\`
{"reply":"Planned it.","format":"glass","title":{"text":"I Automated My Editing","to":5},"emphasis":[{"at":2,"style":"pill"},{"at":3,"style":"big"}],
 "scenes":[{"from":3,"to":6,"says":"A card behind him.","parts":[{"kind":"tag","at":3,"to":6,"place":"behind","label":"100% edited by Claude","text":"edited end-to-end","mark":"end-to-end"}]}]}
\`\`\``)
    const board = cleanStoryboard(answer, 10)
    expect(board.format).toBe('glass')
    expect(board.title).toEqual({ text: 'I Automated My Editing', to: 5 })
    expect(board.emphasis).toEqual([{ at: 2, style: 'pill' }])
    // Kept as written: no forced capitals (they read as an AI-made edit, 2026-11-11).
    // Asked behind him, put above his face: every card is (his strict rule, 2026-11-11).
    expect(board.scenes[0].parts[0]).toMatchObject({ kind: 'tag', place: 'face', label: '100% edited by Claude', mark: 'end-to-end' })
    expect(cleanReply(answer)).toBe('Planned it.')
    expect(MOTION_ANSWER).toContain('"kind": "steps"')
  })
})

describe('drawings on the board (his ask: "less plain ... some drawings")', () => {
  it('keeps the icons it knows on titles, cards, list rows, numbers and the icons row; drops the rest', () => {
    const board = cleanStoryboard(
      {
        format: 'board',
        scenes: [
          {
            from: 0,
            to: 9,
            says: '',
            parts: [
              { kind: 'title', at: 0, text: 'Grow', icon: 'chart-up' },
              { kind: 'cards', at: 1, cards: [{ badge: 'a', tone: 'purple', at: 1, icon: 'unicorn', lines: [] }] },
              { kind: 'icons', at: 2, items: [{ icon: 'video', text: 'Film', at: 2 }, { icon: 'nope', text: 'x', at: 3 }, { icon: 'money', text: 'Earn', at: 4, tone: 'green' }] },
              { kind: 'number', at: 5, text: '300 $', icon: 'money' },
            ],
          },
        ],
      },
      10,
    )
    const [title, cards, icons, number] = board.scenes[0].parts
    expect(title).toMatchObject({ kind: 'title', icon: 'chart-up' })
    expect(cards.kind === 'cards' && cards.cards[0].icon).toBeUndefined()
    expect(icons.kind === 'icons' && icons.items.map((i) => i.icon)).toEqual(['video', 'money'])
    expect(number).toMatchObject({ icon: 'money' })
    expect(MOTION_SYSTEM).toContain('chart-up')
  })
})

describe('Format 1: the board for a few moments, pop cards over his face the rest (his ask, 2026-11-08)', () => {
  it('keeps a pop card alone in its scene, short, with a known drawing', () => {
    const board = cleanStoryboard(
      { format: 'board', scenes: [{ from: 2, to: 30, says: '', parts: [{ kind: 'pop', at: 2, to: 40, icon: 'fire', text: 'Goes viral', tone: 'red' }] }] },
      60,
    )
    const [scene] = board.scenes
    expect(scene.parts[0]).toMatchObject({ kind: 'pop', at: 2, icon: 'fire', text: 'Goes viral', tone: 'red' })
    const pop = scene.parts[0] as { to: number }
    expect(pop.to).toBeLessThanOrEqual(12)
    expect(scene.to).toBe(pop.to)
  })

  it('a pop card with board parts is left out; the board parts stay', () => {
    const board = cleanStoryboard(
      { format: 'board', scenes: [{ from: 0, to: 9, says: '', parts: [{ kind: 'title', at: 0, text: 'Hi' }, { kind: 'pop', at: 1, to: 4, text: 'x' }] }] },
      20,
    )
    expect(board.scenes[0].parts.map((p) => p.kind)).toEqual(['title'])
  })

  it('cuts a long board scene short and leaves out what came after its end', () => {
    const board = cleanStoryboard(
      { format: 'board', scenes: [{ from: 0, to: 80, says: '', parts: [{ kind: 'title', at: 0, text: 'A' }, { kind: 'note', at: 60, text: 'late' }] }] },
      100,
    )
    expect(board.scenes[0].to).toBe(22)
    expect(board.scenes[0].parts.map((p) => p.kind)).toEqual(['title'])
  })

  it('tells Claude the board is for a few moments, and about pop cards', () => {
    expect(MOTION_SYSTEM).toContain('NOT the default')
    expect(MOTION_ANSWER).toContain('"kind": "pop"')
  })

  it('pop cards are not a part of the glass look', () => {
    const board = cleanStoryboard({ format: 'glass', scenes: [{ from: 0, to: 5, says: '', parts: [{ kind: 'pop', at: 0, to: 4, text: 'x' }] }] }, 10)
    expect(board.scenes).toEqual([])
  })
})


describe('Format 2, the glass look (his example reel, 2026-11-08)', () => {
  it('keeps one card a scene, short, with a place it knows; a mark only if it is in the line', () => {
    expect(cleanStoryboard({ format: 'glass', scenes: [{ from: 0, to: 9, says: '', parts: [{ kind: 'tag', at: 0, to: 5, text: 'hi', place: 'face' }] }] }, 10).scenes[0].parts[0]).toMatchObject({ place: 'face' })
    const board = cleanStoryboard(
      {
        format: 'glass',
        scenes: [
          { from: 2, to: 50, says: '', parts: [{ kind: 'stat', at: 2, to: 50, text: '94%', tag: 'graphics', place: 'nowhere' }, { kind: 'tag', at: 3, text: 'x' }] },
          { from: 60, to: 70, says: '', parts: [{ kind: 'tag', at: 60, to: 66, text: 'edited fast', mark: 'slow', place: 'side' }] },
        ],
      },
      100,
    )
    expect(board.scenes[0].parts).toHaveLength(1)
    expect(board.scenes[0].parts[0]).toMatchObject({ kind: 'stat', place: 'face', tag: 'graphics' })
    expect(board.scenes[0].to).toBeLessThanOrEqual(18)
    expect(board.scenes[1].parts[0]).toMatchObject({ mark: '', place: 'face' })
  })

  it('a list of steps needs two rows, as Claude wrote them (no forced capitals, 2026-11-11), in order', () => {
    const board = cleanStoryboard(
      { format: 'glass', scenes: [{ from: 0, to: 30, says: '', parts: [{ kind: 'steps', at: 0, to: 30, tag: 'the pipeline', items: [{ text: 'rough cut', at: 6, icon: 'tools' }, { text: 'intake', note: 'copy raw in', at: 2, icon: 'nope' }] }] }] },
      40,
    )
    const steps = board.scenes[0].parts[0]
    expect(steps.kind === 'steps' && steps.items.map((i) => i.text)).toEqual(['intake', 'rough cut'])
    expect(steps.kind === 'steps' && steps.items[0].icon).toBeUndefined()
    expect(cleanStoryboard({ format: 'glass', scenes: [{ from: 0, to: 9, says: '', parts: [{ kind: 'steps', at: 0, items: [{ text: 'one', at: 1 }] }] }] }, 10).scenes).toEqual([])
  })

  it('always ends on a call to action: his own, or one written for the video', () => {
    expect(cleanStoryboard({ format: 'glass', scenes: [] }, 30).end).toMatchObject({ at: 24, text: DEFAULT_CTA })
    expect(cleanStoryboard({ format: 'board', scenes: [], end: { at: 27, text: 'Comment UGC for the guide' } }, 30).end).toMatchObject({ at: 27, text: 'Comment UGC for the guide' })
    expect(DEFAULT_CTA).toBe('Comment "UGC"')
    expect(MOTION_SYSTEM).toContain('ALWAYS')
    // Not "Comment UGC" every time (his ask, 2026-11-12).
    expect(MOTION_SYSTEM).toContain('not the same one every video')
  })

  it('puts the call to action in a place of its own per video, and where he asks', () => {
    const placeFor = (words: number, text: string, format: 'board' | 'glass' = 'board') =>
      cleanStoryboard({ format, scenes: [], end: { at: words - 2, text } }, words).end!.place
    const places = new Set([10, 11, 12, 13, 14, 15].map((n) => placeFor(n, 'Save this for later')))
    expect(places.size).toBeGreaterThan(1)
    // The glass look keeps it above his face: never low.
    for (let n = 10; n < 20; n++) expect(placeFor(n, 'Follow for more', 'glass')).not.toBe('low')
    expect(cleanStoryboard({ format: 'board', scenes: [], end: { at: 8, text: 'Follow', place: 'low' } }, 10).end!.place).toBe('low')
    expect(cleanStoryboard({ format: 'glass', scenes: [], end: { at: 8, text: 'Follow', place: 'low' } }, 10).end!.place).not.toBe('low')
  })

  it("keeps the call to action's icon when it is one of the drawings", () => {
    expect(cleanStoryboard({ format: 'glass', scenes: [], end: { at: 8, text: 'Save this', icon: 'star' } }, 10).end!.icon).toBe('star')
    expect(cleanStoryboard({ format: 'glass', scenes: [], end: { at: 8, text: 'Save this', icon: 'unicorn' } }, 10).end!.icon).toBeUndefined()
  })

  it('the old Format 2 is gone: a plan saying "words" is drawn as the board', () => {
    expect(cleanStoryboard({ format: 'words', scenes: [{ from: 0, to: 4, says: '', parts: [{ kind: 'title', at: 0, text: 'Hi' }] }] }, 10).format).toBe('board')
    expect(MOTION_SYSTEM).not.toContain('"words"')
  })
})
