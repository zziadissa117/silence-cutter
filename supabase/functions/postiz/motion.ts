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

/** The two looks (his examples, 2026-11-07/08): "board" - his friend's reel,
 *  a light board over the top with cards, grids and sums, his face below;
 *  "words" - his face full screen, the words building up under it in mixed
 *  sizes (one key word big, sometimes gold), numbered diamonds for lists,
 *  white flashes and dimmed moments, a cinematic edge. */
export type Format = 'board' | 'words'
export const FORMATS: readonly Format[] = ['board', 'words']
/** What he asks for: one of them, or Claude picks from what he says. */
export type FormatAsk = Format | 'auto'

/** In the words look: how a word stands out in its block. */
export type EmphasisStyle = 'big' | 'gold' | 'serif'
export interface Emphasis {
  at: number
  style: EmphasisStyle
}

export type Grade = 'warm' | 'teal' | 'none'

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
  // The words look:
  | { kind: 'diamonds'; at: number; items: { at: number }[] }
  | { kind: 'point'; at: number; number: number; text: string }
  | { kind: 'flash'; at: number; to: number }
  | { kind: 'dim'; at: number; to: number; text: string }

export type PartKind = Part['kind']

/** Which parts belong to which look. */
export const BOARD_PARTS: readonly PartKind[] = ['title', 'note', 'cards', 'list', 'tiles', 'phones', 'math', 'number']
export const WORDS_PARTS: readonly PartKind[] = ['diamonds', 'point', 'flash', 'dim']

export interface Scene {
  /** First and last word it is up for. */
  from: number
  to: number
  /** One line for him: what shows. */
  says: string
  parts: Part[]
}

export interface Storyboard {
  /** The look. Missing on a plan from before there were two: the board. */
  format?: Format
  /** The words look: which words stand out in their block. */
  emphasis?: Emphasis[]
  /** The words look: the colour over the picture. */
  grade?: Grade
  /** Over his face at the start: a small card with a number counting up. */
  hook: { at: number; to: number; label: string; text: string } | null
  scenes: Scene[]
  /** A banner at the top near the end, e.g. "+ Follow for more tips". */
  end: { at: number; text: string } | null
}

export const EMPTY_STORYBOARD: Storyboard = { format: 'board', emphasis: [], grade: 'none', hook: null, scenes: [], end: null }

/** A plan's look; one from before there were two is the board. */
export const formatOf = (board: Pick<Storyboard, 'format'>): Format => (board.format === 'words' ? 'words' : 'board')

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
  emphasis: 60,
  diamonds: 5,
  /** A white flash or a dimmed moment lasts at most this many words. */
  flashWords: 8,
} as const

export const MOTION_SYSTEM = `You are the motion designer of a short vertical talking video (TikTok, Instagram Reels). The creator talks to the camera; you add motion graphics around what he says, each appearing on the exact word he says it.

You get his words, numbered: [12]word. Every "at", "from", "to" is a word number. A part appears on its "at" word and stays until its scene ends.

There are two looks ("format"). He may have picked one; if he says "you pick", choose the one that fits the video best: "board" for explaining with numbers, money, comparisons, steps; "words" for stories, opinions, tips, hot takes.

FORMAT "board": while a scene is up, the top 55% of the frame is a light grey board with flat graphics and his face moves to the bottom; between scenes he is full screen. Captions are burned in already - never repeat his sentences on the board; show the idea. Parts (1 to 4 per scene, stacked top to bottom in your order):
- title: a short heading, e.g. "2 types of contracts".
- note: a small dark label in code font, e.g. "max 2 videos = max $50 / day".
- cards: 1 to 3 white cards side by side, each with a coloured badge ("BASE PAY") and up to 4 short lines, each line appearing on its own word, optionally with a check or a cross.
- list: up to 5 numbered rows, each appearing on its word.
- tiles: a grid of up to 30 squares that fill on given words (steps: from word "at", "filled" squares in "tone"; "locked" shows a lock on the empty ones). Optional "window": an app-window title around the grid, and "unit" to count the filled ones ("videos").
- phones: up to 10 phone thumbnails each with its views label ("1,2k"), "lit" for one that went viral; with 2 phones, "sign" "=" or "vs" between them and optional "prices" shown under both, each replacing the last on its word.
- math: a sum built line by line ("50 videos", "× 1,500 views", "× $4 / 1000") and a big result ("= $300 / day") that counts up.
- number: one big number that counts up, with a small label.
Tones: purple, green, red, dark. Optional "hook": a small card over his face at the very start with a label and a number counting up (only for a striking number in his first sentence). 3 to 8 scenes for a 30-90 s video.

FORMAT "words": his face stays full screen with a dark cinematic edge. His words build up word by word in a block under his face (that IS the caption). You choose "emphasis": the words that stand out in their block - "big" (huge white, the key word of a phrase), "gold" (huge yellow capitals, for the strongest words: results, money, VIRAL, the hook), "serif" (a small fancy italic, for a little word before a big one, like "the" in "the Three"). About one emphasised word every 4-8 words; never two in a row. "grade": "warm" or "teal" colour over the picture, or "none". Parts (scenes here are just moments, the face never moves):
- diamonds: numbered diamonds 1, 2, 3... in a row, each lighting up on its word - when he announces a list ("here are the three mistakes"). Up to 5.
- point: one numbered diamond with a short UPPERCASE label at the side, while he talks about that point ("number": 1, "text": "NOT SETTING GOALS"). One scene per point.
- flash: a quick cut to a plain white screen where his words show one at a time in black, from "at" to "to" (2 to 8 words) - for a punchy line. Use once or twice at most.
- dim: the picture goes dark with a short text over it from "at" to "to" (a reaction like "Bruh....", a question). Use rarely.
Optional "end": in "board" a banner at the top; in "words" big gold words like "DM 'EDIT'" - only when he asks to follow/subscribe/comment/DM.

Rules:
- Only what he actually says. Never invent numbers, names, prices or claims.
- Short words: at most 6 words per line, 48 characters.
- Write everything in the language he speaks.
- Scenes never overlap and go in order. Each starts on the word that introduces its idea.
- "says": one plain sentence for him describing what shows in that scene.
- Only use the parts of the format you chose.
- If he asked for something, do it. When he asks to change the storyboard, change only what he asked and keep the rest the same (switching format if he asks); "reply" says in one short sentence what you changed (or answers his question).`

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
    kind: { type: 'string', enum: [...BOARD_PARTS, ...WORDS_PARTS] },
    to: AT,
    number: { type: 'integer' },
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
      items: { type: 'object', properties: { text: TEXT, at: AT, lit: { type: 'boolean' } }, required: ['at'], additionalProperties: false },
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
    format: { type: 'string', enum: FORMATS },
    grade: { type: 'string', enum: ['warm', 'teal', 'none'] },
    emphasis: {
      type: 'array',
      items: { type: 'object', properties: { at: AT, style: { type: 'string', enum: ['big', 'gold', 'serif'] } }, required: ['at', 'style'], additionalProperties: false },
    },
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
  required: ['reply', 'format', 'scenes'],
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
export function motionMessage(words: string, ask: string, current: Storyboard | null, chat: readonly ChatTurn[], format: FormatAsk = 'auto'): string {
  return [
    'His words:',
    words,
    '',
    format === 'auto' ? 'Format: you pick ("board" or "words").' : `Format: he picked "${format}".`,
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
    case 'diamonds': {
      const items = list(raw.items)
        .slice(0, L.diamonds)
        .map((item) => ({ at: inside(item.at, at) }))
      // A count with no words given: they light up one word apart.
      const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.max(1, Math.min(L.diamonds, Math.round(raw.count))) : 0
      while (items.length < count) items.push({ at: Math.min(to, (items[items.length - 1]?.at ?? at) + 1) })
      if (items.length === 0) return null
      items.sort((a, b) => a.at - b.at)
      return { kind: 'diamonds', at: Math.min(at, items[0].at), items }
    }
    case 'point': {
      const text = str(raw.text) || str(raw.label)
      const number = typeof raw.number === 'number' && Number.isFinite(raw.number) ? Math.max(1, Math.min(99, Math.round(raw.number))) : 1
      return text ? { kind: 'point', at, number, text: text.toUpperCase() } : null
    }
    case 'flash':
    case 'dim': {
      const end = Math.min(to, at + L.flashWords - 1, Math.max(at, inside(raw.to, at + 2)))
      if (raw.kind === 'flash') return { kind: 'flash', at, to: end }
      const text = str(raw.text, 24)
      return text ? { kind: 'dim', at, to: end, text } : null
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
  const format: Format = raw.format === 'words' ? 'words' : 'board'
  const allowed = format === 'words' ? WORDS_PARTS : BOARD_PARTS
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
      .filter((p) => allowed.includes(p.kind as PartKind))
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
  // Each word once, in order; never two in a row.
  const emphasis: Emphasis[] = []
  if (format === 'words') {
    const byWord = new Map<number, EmphasisStyle>()
    for (const e of list(raw.emphasis)) {
      if (e.style !== 'big' && e.style !== 'gold' && e.style !== 'serif') continue
      byWord.set(wordAt(e.at, words, 0), e.style)
    }
    for (const [at, style] of [...byWord].sort((a, b) => a[0] - b[0])) {
      if (emphasis.length >= MOTION_LIMITS.emphasis) break
      const last = emphasis[emphasis.length - 1]
      // A serif word leads into the big one after it ("the Three"); two big
      // ones side by side read as shouting.
      if (last && at === last.at + 1 && last.style !== 'serif' && style !== 'serif') continue
      emphasis.push({ at, style })
    }
  }
  const grade: Grade = format === 'words' && (raw.grade === 'warm' || raw.grade === 'teal') ? raw.grade : 'none'
  // The hook card is the board's; in the words look the first block is it.
  return { format, emphasis, grade, hook: format === 'board' ? hook : null, scenes, end }
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
    case 'diamonds':
      for (const item of part.items) item.at = clamp(item.at)
      break
    case 'flash':
    case 'dim':
      part.to = Math.max(part.at, clamp(part.to))
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
export function fakeStoryboard(words: number, format: FormatAsk = 'board'): Storyboard {
  if (words < 6) return EMPTY_STORYBOARD
  if (format === 'words') {
    return cleanStoryboard(
      {
        format: 'words',
        grade: 'warm',
        emphasis: [{ at: 2, style: 'gold' }],
        scenes: [{ from: 3, to: 5, says: 'Three diamonds light up.', parts: [{ kind: 'diamonds', at: 3, items: [{ at: 3 }, { at: 4 }, { at: 5 }] }] }],
      },
      words,
    )
  }
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
