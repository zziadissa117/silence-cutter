// Motion graphics (More -> Motion graphics): Claude reads what he says in a
// talking video and writes a storyboard - which graphics come up, with which
// words and numbers, on which spoken word - drawn by the phone's own render
// (src/campaign/motion/). His ask (2026-11-07): "I just drop in the videos, and
// it does it automatically", in the style of his friend's reel (light board
// over the top of the frame, his face below, cards / grids / sums appearing as
// he says them). He chats to fix it before it is made.
//
// Shared by the postiz function (Deno) and the phone: plain TypeScript, no
// imports. Times are WORD INDEXES into the words Claude was given, so the
// graphics land on the frame the word is said, whatever was cut.

export type Tone = 'purple' | 'green' | 'red' | 'dark'
export const TONES: readonly Tone[] = ['purple', 'green', 'red', 'dark']

export interface Line {
  text: string
  /** Word it appears on. */
  at: number
  mark: 'check' | 'cross' | null
}

export interface Card {
  badge: string
  tone: Tone
  at: number
  lines: Line[]
}

export interface TileStep {
  at: number
  /** How many tiles are filled from this word on. */
  filled: number
  tone: Tone
  /** The tiles not filled show a lock. */
  locked: boolean
}

export interface Phone {
  /** Its views, e.g. "1,2k". */
  label: string
  at: number
  /** Lit (a video that took off), or plain. */
  lit: boolean
}

export type Part =
  | { kind: 'title'; at: number; text: string }
  | { kind: 'note'; at: number; text: string }
  | { kind: 'cards'; at: number; cards: Card[] }
  | { kind: 'list'; at: number; items: { text: string; at: number }[] }
  | { kind: 'tiles'; at: number; count: number; steps: TileStep[]; window: string; unit: string }
  | { kind: 'phones'; at: number; items: Phone[]; sign: '=' | 'vs' | null; prices: { text: string; at: number }[] }
  | { kind: 'math'; at: number; lines: { text: string; at: number }[]; result: { text: string; at: number } }
  | { kind: 'number'; at: number; label: string; text: string }

export type PartKind = Part['kind']

export interface Scene {
  /** First and last word it is up for. */
  from: number
  to: number
  /** One line for him: what shows. */
  says: string
  parts: Part[]
}

export interface Storyboard {
  /** Over his face at the start: a small card with a number counting up. */
  hook: { at: number; to: number; label: string; text: string } | null
  scenes: Scene[]
  /** A banner at the top near the end, e.g. "+ Follow for more tips". */
  end: { at: number; text: string } | null
}

export const EMPTY_STORYBOARD: Storyboard = { hook: null, scenes: [], end: null }

/** The most of each thing, so a frame never overflows. */
export const MOTION_LIMITS = {
  scenes: 12,
  parts: 4,
  cards: 3,
  lines: 4,
  items: 5,
  tiles: 30,
  phones: 10,
  steps: 6,
  mathLines: 4,
  chars: 48,
  says: 160,
} as const

export const MOTION_SYSTEM = `You are the motion designer of a short vertical talking video (TikTok, Instagram Reels). The creator talks to the camera; you add clean, flat motion graphics that EXPLAIN what he says, appearing on the exact word he says it.

How it looks (fixed, you only fill it): while a scene is up, the top 55% of the frame is a light grey board with the graphics and his face moves to the bottom. Between scenes he is full screen. Captions are already burned in - never repeat his sentences on the board; show the idea (a number, a comparison, a list, a sum).

You get his words, numbered: [12]word. Every "at", "from", "to" is a word number. A part appears on its "at" word and stays until its scene ends.

Building blocks (a scene has 1 to 4 parts, stacked top to bottom in the order you give):
- title: a short heading, e.g. "2 types of contracts".
- note: a small dark label in code font, e.g. "max 2 videos = max $50 / day".
- cards: 1 to 3 white cards side by side, each with a coloured badge ("BASE PAY") and up to 4 short lines, each line appearing on its own word, optionally with a check or a cross.
- list: up to 5 numbered rows, each appearing on its word.
- tiles: a grid of up to 30 squares that fill on given words (steps: from word "at", "filled" squares in "tone"; "locked" shows a lock on the empty ones). Optional "window": an app-window title around the grid, and "unit" to count the filled ones ("videos").
- phones: up to 10 phone thumbnails each with its views label ("1,2k"), "lit" for one that went viral; with 2 phones, "sign" "=" or "vs" between them and optional "prices" shown under both, each replacing the last on its word.
- math: a sum built line by line ("50 videos", "× 1,500 views", "× $4 / 1000") and a big result ("= $300 / day") that counts up.
- number: one big number that counts up, with a small label.
Tones: purple, green, red, dark.

Also, optional: "hook" - a small card over his face at the very start with a label and a number counting up (only if he says a striking number or result in his first sentence); "end" - a short banner near the end when he asks to follow/subscribe/comment.

Rules:
- Only what he actually says. Never invent numbers, names, prices or claims.
- Short words on the board: at most 6 words per line, 48 characters.
- Write the board in the language he speaks.
- 3 to 8 scenes for a 30-90 s video; leave the hook and quick asides on his face. Scenes never overlap and go in order.
- Each scene starts on the word that introduces its idea; parts come up as he says each piece.
- "says": one plain sentence for him describing what shows in that scene.
- If he asked for something, do it. When he asks to change the storyboard, change only what he asked and keep the rest the same; "reply" says in one short sentence what you changed (or answers his question).`

const TONE = { type: 'string', enum: TONES }
const AT = { type: 'integer' }
const TEXT = { type: 'string' }
const LINE = {
  type: 'object',
  properties: { text: TEXT, at: AT, mark: { type: 'string', enum: ['check', 'cross', 'none'] } },
  required: ['text', 'at'],
  additionalProperties: false,
}
const TIMED_TEXT = { type: 'object', properties: { text: TEXT, at: AT }, required: ['text', 'at'], additionalProperties: false }

// One flat shape per part, with the fields of every kind optional: simpler
// for the model than a union, and cleanStoryboard keeps what fits its kind.
const PART = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['title', 'note', 'cards', 'list', 'tiles', 'phones', 'math', 'number'] },
    at: AT,
    text: TEXT,
    label: TEXT,
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { badge: TEXT, tone: TONE, at: AT, lines: { type: 'array', items: LINE } },
        required: ['badge', 'tone', 'at', 'lines'],
        additionalProperties: false,
      },
    },
    items: {
      type: 'array',
      items: { type: 'object', properties: { text: TEXT, at: AT, lit: { type: 'boolean' } }, required: ['text', 'at'], additionalProperties: false },
    },
    count: { type: 'integer' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { at: AT, filled: { type: 'integer' }, tone: TONE, locked: { type: 'boolean' } },
        required: ['at', 'filled', 'tone', 'locked'],
        additionalProperties: false,
      },
    },
    window: TEXT,
    unit: TEXT,
    sign: { type: 'string', enum: ['=', 'vs', 'none'] },
    prices: { type: 'array', items: TIMED_TEXT },
    lines: { type: 'array', items: TIMED_TEXT },
    result: TIMED_TEXT,
  },
  required: ['kind', 'at'],
  additionalProperties: false,
}

export const MOTION_SCHEMA = {
  type: 'object',
  properties: {
    reply: TEXT,
    // Left out when there is none (optional fields, not a union: simpler for
    // the model, and cleanStoryboard reads a missing one as none).
    hook: { type: 'object', properties: { at: AT, to: AT, label: TEXT, text: TEXT }, required: ['at', 'to', 'label', 'text'], additionalProperties: false },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { from: AT, to: AT, says: TEXT, parts: { type: 'array', items: PART } },
        required: ['from', 'to', 'says', 'parts'],
        additionalProperties: false,
      },
    },
    end: { type: 'object', properties: { at: AT, text: TEXT }, required: ['at', 'text'], additionalProperties: false },
  },
  required: ['reply', 'scenes'],
  additionalProperties: false,
}

/** His words as Claude reads them: numbered, a line every few seconds with
 *  its time in the finished video. */
export function numberedWords(words: readonly string[], times: readonly number[] = []): string {
  const lines: string[] = []
  let line: string[] = []
  let lineStart = 0
  words.forEach((word, i) => {
    if (line.length === 0) lineStart = i
    line.push(`[${i}]${word.replace(/\s+/g, ' ').trim()}`)
    if (line.length >= 12 || /[.!?]$/.test(word.trim()) || i === words.length - 1) {
      const t = times[lineStart]
      lines.push(`${typeof t === 'number' && Number.isFinite(t) ? `${t.toFixed(1)}s ` : ''}${line.join(' ')}`)
      line = []
    }
  })
  return lines.join('\n')
}

/** One turn of the chat: his words or Claude's reply. */
export interface ChatTurn {
  from: 'him' | 'claude'
  text: string
}

/** What Claude is told: the words, what he asked, and - when fixing - the
 *  storyboard as it is now and the chat so far. */
export function motionMessage(words: string, ask: string, current: Storyboard | null, chat: readonly ChatTurn[]): string {
  return [
    'His words:',
    words,
    '',
    ask.trim() ? `What he asked for this video: ${ask.trim().slice(0, 600)}` : 'He asked for nothing in particular: you decide.',
    ...(current
      ? [
          '',
          'The storyboard now:',
          JSON.stringify(current),
          '',
          'The chat so far:',
          ...chat.slice(-12).map((turn) => `${turn.from === 'him' ? 'Him' : 'You'}: ${turn.text.slice(0, 600)}`),
          '',
          'Change the storyboard as he asks in his last message.',
        ]
      : []),
  ].join('\n')
}

const str = (value: unknown, max: number = MOTION_LIMITS.chars): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

const toneOf = (value: unknown, fallback: Tone): Tone => (TONES.includes(value as Tone) ? (value as Tone) : fallback)

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object') : []

/** A word number made safe: a whole number inside the words. */
function wordAt(value: unknown, words: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(0, Math.min(words - 1, n))
}

/** One part made safe, or null when nothing of it is usable. `from`/`to`:
 *  its scene's words, every time kept inside them. */
function cleanPart(raw: Record<string, unknown>, from: number, to: number, words: number): Part | null {
  const inside = (value: unknown, fallback: number) => Math.max(from, Math.min(to, wordAt(value, words, fallback)))
  const at = inside(raw.at, from)
  const L = MOTION_LIMITS
  switch (raw.kind) {
    case 'title':
    case 'note': {
      const text = str(raw.text) || str(raw.label)
      return text ? { kind: raw.kind, at, text } : null
    }
    case 'cards': {
      const cards = list(raw.cards)
        .slice(0, L.cards)
        .map((card, i) => ({
          badge: str(card.badge, 20).toUpperCase(),
          tone: toneOf(card.tone, i === 0 ? 'purple' : 'green'),
          at: inside(card.at, at),
          lines: list(card.lines)
            .slice(0, L.lines)
            .flatMap((line) => {
              const text = str(line.text)
              const mark: Line['mark'] = line.mark === 'check' || line.mark === 'cross' ? line.mark : null
              return text ? [{ text, at: Math.max(inside(card.at, at), inside(line.at, at)), mark }] : []
            }),
        }))
        .filter((card) => card.badge || card.lines.length > 0)
      return cards.length > 0 ? { kind: 'cards', at: Math.min(at, ...cards.map((c) => c.at)), cards } : null
    }
    case 'list': {
      const items = list(raw.items)
        .slice(0, L.items)
        .flatMap((item) => (str(item.text) ? [{ text: str(item.text), at: inside(item.at, at) }] : []))
      return items.length > 0 ? { kind: 'list', at: Math.min(at, ...items.map((i) => i.at)), items } : null
    }
    case 'tiles': {
      const count = Math.max(1, Math.min(L.tiles, typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.round(raw.count) : 10))
      const steps = list(raw.steps)
        .slice(0, L.steps)
        .map((step) => ({
          at: inside(step.at, at),
          filled: Math.max(0, Math.min(count, typeof step.filled === 'number' && Number.isFinite(step.filled) ? Math.round(step.filled) : 0)),
          tone: toneOf(step.tone, 'purple'),
          locked: step.locked === true,
        }))
        .sort((a, b) => a.at - b.at)
      return { kind: 'tiles', at, count, steps, window: str(raw.window), unit: str(raw.unit, 20) }
    }
    case 'phones': {
      const items = list(raw.items)
        .slice(0, L.phones)
        .map((item) => ({ label: str(item.text, 12) || str(item.label, 12), at: inside(item.at, at), lit: item.lit === true }))
      if (items.length === 0) return null
      const sign = items.length === 2 && (raw.sign === '=' || raw.sign === 'vs') ? raw.sign : null
      const prices =
        items.length === 2
          ? list(raw.prices)
              .slice(0, L.steps)
              .flatMap((p) => (str(p.text, 16) ? [{ text: str(p.text, 16), at: inside(p.at, at) }] : []))
              .sort((a, b) => a.at - b.at)
          : []
      return { kind: 'phones', at: Math.min(at, ...items.map((i) => i.at)), items, sign, prices }
    }
    case 'math': {
      const lines = list(raw.lines)
        .slice(0, L.mathLines)
        .flatMap((line) => (str(line.text) ? [{ text: str(line.text), at: inside(line.at, at) }] : []))
      const result = raw.result && typeof raw.result === 'object' ? (raw.result as Record<string, unknown>) : {}
      const resultText = str(result.text, 32)
      if (lines.length === 0 && !resultText) return null
      const resultAt = Math.max(inside(result.at, to), ...lines.map((l) => l.at))
      return { kind: 'math', at: Math.min(at, ...lines.map((l) => l.at), resultAt), lines, result: { text: resultText, at: resultAt } }
    }
    case 'number': {
      const text = str(raw.text, 24)
      return text ? { kind: 'number', at, label: str(raw.label), text } : null
    }
    default:
      return null
  }
}

/** Claude's storyboard made safe to draw: every word number inside the
 *  words, scenes in order and apart, every list at most its limit, every
 *  text short. `words`: how many words there are. */
export function cleanStoryboard(value: unknown, words: number): Storyboard {
  if (!value || typeof value !== 'object' || words <= 0) return EMPTY_STORYBOARD
  const raw = value as Record<string, unknown>
  const scenes: Scene[] = []
  const rawScenes = list(raw.scenes)
    .map((s) => ({ s, from: wordAt(s.from, words, 0) }))
    .sort((a, b) => a.from - b.from)
  for (const { s, from } of rawScenes) {
    if (scenes.length >= MOTION_LIMITS.scenes) break
    const last = scenes[scenes.length - 1]
    // Never on top of the one before: it ends where this one starts.
    if (last && from <= last.from) continue
    if (last && last.to >= from) last.to = from - 1
    const to = Math.max(from, wordAt(s.to, words, from))
    const parts = list(s.parts)
      .slice(0, MOTION_LIMITS.parts)
      .flatMap((p) => cleanPart(p, from, to, words) ?? [])
    if (parts.length === 0) continue
    scenes.push({ from, to, says: str(s.says, MOTION_LIMITS.says), parts })
  }
  // A scene shortened by the next one keeps its parts inside it.
  for (const scene of scenes) for (const part of scene.parts) clampPart(part, scene.from, scene.to)
  const hookRaw = raw.hook && typeof raw.hook === 'object' ? (raw.hook as Record<string, unknown>) : null
  const firstScene = scenes[0]?.from ?? words
  let hook: Storyboard['hook'] = null
  if (hookRaw && str(hookRaw.text, 24)) {
    const at = wordAt(hookRaw.at, words, 0)
    const to = Math.min(firstScene - 1, Math.max(at, wordAt(hookRaw.to, words, at + 8)))
    if (to >= at) hook = { at, to, label: str(hookRaw.label, 32), text: str(hookRaw.text, 24) }
  }
  const endRaw = raw.end && typeof raw.end === 'object' ? (raw.end as Record<string, unknown>) : null
  const end = endRaw && str(endRaw.text) ? { at: wordAt(endRaw.at, words, words - 1), text: str(endRaw.text) } : null
  return { hook, scenes, end }
}

function clampPart(part: Part, from: number, to: number): void {
  const clamp = (n: number) => Math.max(from, Math.min(to, n))
  part.at = clamp(part.at)
  switch (part.kind) {
    case 'cards':
      for (const card of part.cards) {
        card.at = clamp(card.at)
        for (const line of card.lines) line.at = clamp(line.at)
      }
      break
    case 'list':
      for (const item of part.items) item.at = clamp(item.at)
      break
    case 'tiles':
      for (const step of part.steps) step.at = clamp(step.at)
      break
    case 'phones':
      for (const item of part.items) item.at = clamp(item.at)
      for (const price of part.prices) price.at = clamp(price.at)
      break
    case 'math':
      for (const line of part.lines) line.at = clamp(line.at)
      part.result.at = clamp(part.result.at)
      break
    default:
      break
  }
}

/** Claude's one-line reply, made safe. */
export function cleanReply(value: unknown): string {
  return value && typeof value === 'object' ? str((value as { reply?: unknown }).reply, 300) : ''
}

/** A storyboard for testing without Claude (the FAKE_CLAUDE key). */
export function fakeStoryboard(words: number): Storyboard {
  if (words < 6) return EMPTY_STORYBOARD
  const mid = Math.floor(words / 2)
  return cleanStoryboard(
    {
      hook: { at: 0, to: 2, label: 'PER MONTH', text: '+10 000 $' },
      scenes: [
        {
          from: 3,
          to: mid,
          says: 'Two cards come up side by side.',
          parts: [
            { kind: 'title', at: 3, text: '2 types of contracts' },
            { kind: 'cards', at: 4, cards: [{ badge: 'Base pay', tone: 'purple', at: 4, lines: [{ text: 'per video', at: 5, mark: 'check' }] }, { badge: 'CPM', tone: 'green', at: 5, lines: [] }] },
          ],
        },
        {
          from: mid + 1,
          to: words - 1,
          says: 'A sum builds up.',
          parts: [{ kind: 'math', at: mid + 1, lines: [{ text: '50 videos', at: mid + 1 }], result: { text: '= $300 / day', at: words - 1 } }],
        },
      ],
      end: null,
    },
    words,
  )
}
