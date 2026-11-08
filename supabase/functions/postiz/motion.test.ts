import { describe, expect, it } from 'vitest'

import { MOTION_ANSWER, MOTION_SYSTEM, cleanReply, cleanStoryboard, fakeStoryboard, motionMessage, numberedWords, parseMotionAnswer } from './motion.ts'

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
    expect(board.end).toEqual({ at: 11, text: 'Follow for more' })
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
{"reply":"Planned it.","format":"words","grade":"teal","emphasis":[{"at":2,"style":"gold"}],
 "scenes":[{"from":3,"to":6,"says":"Three diamonds.","parts":[{"kind":"diamonds","at":3,"items":[{"at":4},{"at":5},{"at":6}]}]}]}
\`\`\``)
    const board = cleanStoryboard(answer, 10)
    expect(board.format).toBe('words')
    expect(board.scenes[0].parts[0]).toMatchObject({ kind: 'diamonds' })
    expect(cleanReply(answer)).toBe('Planned it.')
    expect(MOTION_ANSWER).toContain('"kind": "diamonds"')
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
