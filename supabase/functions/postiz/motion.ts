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
 *  "glass" - his example of 2026-11-08 ("I want the formats to look a little
 *  more like this"): his face full screen, frosted glass cards over him and
 *  behind him, a light screen with the steps and his video in a box, captions
 *  in a dark bar, a title over his head at the start. It replaced the old
 *  Format 2 ("words"), which he had taken out. */
export type Format = 'board' | 'glass'
export const FORMATS: readonly Format[] = ['board', 'glass']
/** What he asks for: one of them, or Claude picks from what he says. */
export type FormatAsk = Format | 'auto'

/** In the glass look: how a word stands out in the captions - in orange
 *  ("accent"), or its whole phrase in a white pill with a green tick
 *  ("pill", for a key phrase). */
export type EmphasisStyle = 'accent' | 'pill'
export interface Emphasis {
  at: number
  style: EmphasisStyle
}

export type Tone = 'purple' | 'green' | 'red' | 'dark'
export const TONES: readonly Tone[] = ['purple', 'green', 'red', 'dark']

export interface Line {
  text: string
  /** Word it appears on. */
  at: number
  mark: 'check' | 'cross' | null
}

/** The drawings on the board (src/campaign/motion/icons.ts): simple line
 *  icons in the board's colours, drawn from code. His ask (2026-11-08): "make
 *  the white part on top less plain right now its just text could be nice if
 *  we had some drawings". */
export const ICONS = [
  'money', 'coins', 'chart-up', 'chart-down', 'video', 'camera', 'phone', 'eye', 'heart', 'star', 'fire', 'bolt',
  'clock', 'calendar', 'user', 'users', 'target', 'bulb', 'lock', 'gift', 'cart', 'megaphone', 'trophy', 'warning',
  'question', 'chat', 'play', 'globe', 'home', 'rocket', 'check', 'cross', 'arrow', 'hashtag', 'brain', 'tools',
] as const
export type Icon = (typeof ICONS)[number]

export interface Card {
  badge: string
  tone: Tone
  at: number
  lines: Line[]
  /** A drawing in its corner. */
  icon?: Icon
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
  | { kind: 'title'; at: number; text: string; icon?: Icon }
  | { kind: 'note'; at: number; text: string }
  | { kind: 'cards'; at: number; cards: Card[] }
  | { kind: 'list'; at: number; items: { text: string; at: number; icon?: Icon }[] }
  /** 2 to 4 big drawings in a row, a word under each - the key ideas. */
  | { kind: 'icons'; at: number; items: { icon: Icon; text: string; at: number; tone: Tone }[] }
  | { kind: 'tiles'; at: number; count: number; steps: TileStep[]; window: string; unit: string }
  | { kind: 'phones'; at: number; items: Phone[]; sign: '=' | 'vs' | null; prices: { text: string; at: number }[] }
  | { kind: 'math'; at: number; lines: { text: string; at: number }[]; result: { text: string; at: number } }
  | { kind: 'number'; at: number; label: string; text: string; icon?: Icon }
  /** A small card that pops up over his face - a drawing and a few words -
   *  with the board staying down: most moments get one of these instead of
   *  the board ("I don't want the white screen to always be there", his ask
   *  2026-11-08). Alone in its scene; from "at" to "to". */
  | { kind: 'pop'; at: number; to: number; text: string; icon?: Icon; tone: Tone }
  // The glass look - each card from "at" to "to", where Claude puts it
  // ("place"): low over his chest, at the side, or behind him (his head and
  // body in front of it).
  /** A small label and a bold line, one word of it in an orange pill. */
  | { kind: 'tag'; at: number; to: number; label: string; text: string; mark: string; place: Place }
  /** A row of blocks, some red - the bits cut out - with a title; on "after"
   *  the red ones go and the title changes ("tight. no filler."). */
  | { kind: 'blocks'; at: number; to: number; title: string; tag: string; after: { at: number; text: string } | null; place: Place }
  /** A big number counting up with bars growing under it. */
  | { kind: 'stat'; at: number; to: number; tag: string; text: string; sub: string; place: Place }
  /** A picture: a big emoji (or a drawing) with a small label. */
  | { kind: 'picture'; at: number; to: number; tag: string; emoji: string; icon?: Icon; place: Place }
  /** Two halves side by side: the usual way, crossed out, and his way,
   *  ticked, coming in on its own word ("most people: 1 video a week" -
   *  "me: 25 a day"). Added 2026-11-12: a contrast had no card of its own. */
  | { kind: 'compare'; at: number; to: number; left: { label: string; text: string }; right: { label: string; text: string; at: number }; place: Place }
  /** The full light screen: numbered steps, each on its word, his video
   *  shrunk into a box under them. */
  | { kind: 'steps'; at: number; to: number; tag: string; items: { text: string; note: string; at: number; icon?: Icon; pill: string }[] }

export type PartKind = Part['kind']

/** Which parts belong to which look. */
export const BOARD_PARTS: readonly PartKind[] = ['title', 'note', 'cards', 'list', 'icons', 'tiles', 'phones', 'math', 'number', 'pop']

/** A scene of pop cards only: over his face, the board stays down. */
export const popScene = (scene: Pick<Scene, 'parts'>): boolean => scene.parts.length > 0 && scene.parts.every((p) => p.kind === 'pop')
export const GLASS_PARTS: readonly PartKind[] = ['tag', 'blocks', 'stat', 'picture', 'compare', 'steps']

/** Where a glass card sits. Only 'face' is made now - above his face, over
 *  his forehead; the others stay for plans made before (drawn there too). */
export type Place = 'face' | 'low' | 'side' | 'behind'

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
  /** The glass look: which words stand out in the captions. */
  emphasis?: Emphasis[]
  /** The glass look: the title over his head at the start, until word "to". */
  title?: { text: string; to: number } | null
  /** Over his face at the start: a small card with a number counting up. */
  hook: { at: number; to: number; label: string; text: string } | null
  scenes: Scene[]
  /** The call to action at the end - always one (his ask, 2026-11-08):
   *  what he says, or one that fits the video - not always "Comment UGC",
   *  nor always in the same place (his ask, 2026-11-12). */
  end: { at: number; text: string; place?: CtaPlace; icon?: Icon } | null
}

/** Where the call to action shows: over his head, in the middle, or low
 *  (the board look only - the glass look keeps everything above his face). */
export type CtaPlace = 'top' | 'middle' | 'low'
export const CTA_PLACES: Record<Format, readonly CtaPlace[]> = { board: ['top', 'middle', 'low'], glass: ['top', 'middle'] }

export const EMPTY_STORYBOARD: Storyboard = { format: 'board', emphasis: [], title: null, hook: null, scenes: [], end: null }

/** The call to action when he says none: his own most common one. */
export const DEFAULT_CTA = 'Comment "UGC"'

/** A plan's look; one from before there were two is the board. */
export const formatOf = (board: Pick<Storyboard, 'format'>): Format => (board.format === 'glass' ? 'glass' : 'board')

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
  /** Rows on the glass look's light screen. */
  stepItems: 6,
  /** A glass card is up for at most this many words. */
  cardWords: 16,
  /** The board is up for at most this many words at a time (about 7 s). */
  boardWords: 22,
  /** A pop card over his face, at most this many words. */
  popWords: 10,
} as const

export const MOTION_SYSTEM = `You are the motion designer of a short vertical talking video (TikTok, Instagram Reels). The creator talks to the camera; you add motion graphics around what he says, each appearing on the exact word he says it.

You get his words, numbered: [12]word. Every "at", "from", "to" is a word number. A part appears on its "at" word and stays until its scene ends.

There are two looks ("format"). He may have picked one; if he says "you pick", choose the one that fits the video best: "board" for explaining with numbers, money, comparisons, sums; "glass" for everything else - tips, stories, how he does things, tools, opinions.

FORMAT "board": while a board scene is up, the top 45% of the frame is a light grey board with flat graphics and his face moves to the bottom; between scenes he is full screen. The board is the big moment, NOT the default: use it only for the 2 to 4 moments that need a picture (a comparison, a sum, a grid, a list of steps), each 3 to 7 seconds (at most 20 words), with at least as long of his face between two boards - his face is on screen most of the video. Everywhere else he makes a point worth seeing, use a "pop" scene instead: a small card with a drawing and 1 to 4 words popping up over his face, the board staying down (aim for 3 to 6 of them). Captions are burned in already - never repeat his sentences on the board; show the idea. Parts (1 to 4 per scene, stacked top to bottom in your order):
- title: a short heading, e.g. "2 types of contracts".
- note: a small dark label in code font, e.g. "max 2 videos = max $50 / day".
- cards: 1 to 3 white cards side by side, each with a coloured badge ("BASE PAY") and up to 4 short lines, each line appearing on its own word, optionally with a check or a cross.
- list: up to 5 numbered rows, each appearing on its word.
- tiles: a grid of up to 30 squares that fill on given words (steps: from word "at", "filled" squares in "tone"; "locked" shows a lock on the empty ones). Optional "window": an app-window title around the grid, and "unit" to count the filled ones ("videos").
- phones: up to 10 phone thumbnails each with its views label ("1,2k"), "lit" for one that went viral; with 2 phones, "sign" "=" or "vs" between them and optional "prices" shown under both, each replacing the last on its word.
- math: a sum built line by line ("50 videos", "× 1,500 views", "× $4 / 1000") and a big result ("= $300 / day") that counts up.
- number: one big number that counts up, with a small label.
- icons: 2 to 4 big drawings in a row, one short word under each, each on its word - for the key ideas, e.g. "video" "Film", "chart-up" "Grow", "money" "Earn".
- pop: ALONE in its scene, no board: a card over his face with an "icon" and 1 to 4 words ("text"), from "at" to "to" (3 to 10 words), e.g. "fire" "Goes viral", "clock" "Only 2 hours". Tone for its colour.
Tones: purple, green, red, dark.
Drawings ("icon"): give most titles, cards, list rows and numbers an "icon" that fits, so the board is never just text, and use an "icons" part in some scenes. Only these: ${ICONS.join(', ')}. Optional "hook": a small card over his face at the very start with a label and a number counting up (only for a striking number in his first sentence). 3 to 8 scenes for a 30-90 s video.

FORMAT "glass": his face stays full screen; now and then a frosted glass card comes and goes over him. It must look like a person edited it, not a tool: viewers now recognise the same AI-made edit everywhere, and he does not want his to look like it.
- Fewer, better moments: a card only where it adds something he says - about one every 8 to 12 seconds on average, at UNEVEN gaps (sometimes two close together, sometimes 15 seconds of just him talking). 4 to 8 scenes for a 30-90 s video, the first within his first two sentences. Each card up 2 to 5 seconds (at most 15 words), one at a time. Each scene holds ONE part.
- Variety: never the same kind of part twice in a row; across the video use at least three different kinds.
- Words like his own: short, plain, in his voice and his language, sentence case - the way he would write a text. No marketing labels, no words like "AI", "Claude", "automated", "edited by", "100%", "zero human" unless he says them himself. Most tags have NO "label"; give one only when it says something (at most a third of them). Emoji pictures rarely (at most once).
- Where a card sits is fixed, his strict rule: ALWAYS above his face, over his forehead, at the top of the middle square. NEVER under his face, NEVER beside his head, NEVER behind him. Give every card "place": "face" - it means above his face. If he asks for a card anywhere else, it still goes above his face; say so in your reply.
Parts:
- tag: an optional small "label" and a short "text" ("cut every pause"), one or two words of it in an orange pill ("mark": "pause") - or no mark. For the main point of a moment.
- blocks: a row of blue blocks with some red ones (the waste), a "title" ("the dead space") and an optional small "tag"; optional "after": on its word the red ones disappear and the title becomes its "text" ("no more filler"). For before/after, removing waste, saving time.
- stat: a big number counting up ("2x", "$3,000", "25 a day") with an optional small "tag" and "sub", bars growing under it. Only numbers he says.
- picture: a card with a big "emoji" that shows the thing and a small "tag" naming it. Rarely.
- compare: two halves side by side - "left", the usual way (what most people do, before, the old way), crossed out; "right", his way (after, the new way), ticked, coming in on its own word ("right.at", when he says his side). Each a small "label" ("most people", "me") and a short "text" ("1 video a week", "25 a day"). For a contrast he actually makes - them vs him, before vs after.
- steps: the whole screen turns light blue with his video in a box under a numbered list; optional "tag" over it and up to 5 "items", each on its word: "text" one or two words, "note" a few small words, an "icon", optional "pill". Only when he lists steps - at most once a video, 4 to 10 seconds.
Also in "glass":
- "title": written over his head at the very start, 2 to 6 words in his own words - the promise of the video - until word "to" (about 3 seconds). Leave it out if his first sentence makes no promise.
- The captions are the Cutter's own and are burned in already: never repeat his sentence word for word on a card.

Call to action ("end"), in both looks, ALWAYS, at his last sentence:
- "text": if he says one ("comment UGC", "follow for more"), his words, short ('Comment "UGC"'). If he says none, write one that fits this video, 2 to 5 words, in his language - and not the same one every video: 'Comment "UGC"' only when the video is about UGC; others like 'Follow for more', 'Save this for later', 'Send this to a friend', 'Try it yourself', 'Follow for part 2'. Never promise something the video doesn't (a link, a guide, a giveaway).
- "place": only when he asks where it goes - "top" (over his head), "middle", or "low" (the board look only). Otherwise leave it out: the Cutter puts it in a different place from video to video.
- "icon": one from the list that fits it ("chat" for a comment, "user" or "heart" for a follow, "star" for a save, "arrow" for a share, "play" for a part 2).

Rules:
- Only what he actually says. Never invent numbers, names, prices or claims.
- Short words: at most 6 words per line, 48 characters.
- Write everything in the language he speaks.
- Scenes never overlap and go in order. Each starts on the word that introduces its idea.
- "says": one plain sentence for him describing what shows in that scene.
- Only use the parts of the format you chose. Every icon only from the list.
- If he asked for something, do it. When he asks to change the storyboard, change only what he asked and keep the rest the same (switching format if he asks); "reply" says in one short sentence what you changed (or answers his question).`

/** How Claude answers: plain JSON, shaped like this. Not a strict output
 *  schema - with two looks and every part's fields the schema was "too
 *  complex" for the API (his first try, 2026-11-08); cleanStoryboard keeps
 *  what is usable of whatever comes back. */
export const MOTION_ANSWER = `Answer with ONE JSON object and nothing else - no code fence, no words before or after:
{
  "reply": "one short sentence for him",
  "format": "board" or "glass",
  "title": {"text": "how I post 25 a day", "to": 8},    (glass only, optional)
  "hook": {"at": 0, "to": 6, "label": "PER MONTH", "text": "+10 000 $"},   (board only, optional)
  "scenes": [
    {"from": 14, "to": 40, "says": "what shows, for him", "parts": [ ...parts... ]}
  ],
  "end": {"at": 120, "text": "Save this for later", "icon": "star"}             (always; "place" only when he asks)
}
Parts - "kind" and its fields:
  {"kind": "title", "at": 14, "text": "...", "icon": "chart-up"}
  {"kind": "note", "at": 15, "text": "..."}
  {"kind": "icons", "at": 15, "items": [{"icon": "video", "text": "Film", "at": 15, "tone": "purple"}]}
  {"kind": "cards", "at": 15, "cards": [{"badge": "BASE PAY", "tone": "purple", "at": 15, "icon": "money", "lines": [{"text": "...", "at": 18, "mark": "check" | "cross" | "none"}]}]}
  {"kind": "list", "at": 15, "items": [{"text": "...", "at": 16, "icon": "clock"}]}
  {"kind": "tiles", "at": 15, "count": 10, "window": "", "unit": "videos", "steps": [{"at": 16, "filled": 2, "tone": "purple", "locked": true}]}
  {"kind": "phones", "at": 15, "items": [{"text": "1,2k", "at": 15, "lit": false}], "sign": "=" | "vs" | "none", "prices": [{"text": "25 $", "at": 20}]}
  {"kind": "math", "at": 15, "lines": [{"text": "50 videos", "at": 15}], "result": {"text": "= 300 $ / day", "at": 22}}
  {"kind": "number", "at": 15, "label": "a day", "text": "300 $", "icon": "money"}
  {"kind": "pop", "at": 15, "to": 21, "icon": "fire", "text": "Goes viral", "tone": "red"}
  {"kind": "tag", "at": 15, "to": 24, "place": "face", "label": "", "text": "cut every pause", "mark": "pause"}
  {"kind": "blocks", "at": 15, "to": 26, "place": "low", "title": "the dead space", "tag": "", "after": {"at": 22, "text": "no more filler"}}
  {"kind": "stat", "at": 15, "to": 22, "place": "side", "tag": "views", "text": "2x", "sub": "in one week"}
  {"kind": "picture", "at": 15, "to": 21, "place": "side", "tag": "the app", "emoji": "📱"}
  {"kind": "compare", "at": 15, "to": 27, "place": "face", "left": {"label": "most people", "text": "1 video a week"}, "right": {"label": "me", "text": "25 a day", "at": 21}}
  {"kind": "steps", "at": 15, "to": 40, "tag": "my setup", "items": [{"text": "Film", "note": "one take", "at": 16, "icon": "video", "pill": ""}]}
Every "at", "from", "to" is a word number.`

/** Claude's answer as an object: the JSON in it, even with a code fence or a
 *  word around it; null when there is none. */
export function parseMotionAnswer(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
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
    format === 'auto' ? 'Format: you pick ("board" or "glass").' : `Format: he picked "${format}".`,
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

/** A drawing it knows, or none. */
const iconOf = (value: unknown): Icon | undefined => (ICONS.includes(value as Icon) ? (value as Icon) : undefined)
const withIcon = (value: unknown) => {
  const icon = iconOf(value)
  return icon ? { icon } : {}
}

/** Every glass card goes above his face, over his forehead - never under it,
 *  beside it or behind him (his strict rule, 2026-11-11: "It has to be above
 *  my face and never below my face ... on top of my forehead, not next to my
 *  face"). Whatever Claude says. */
const ABOVE_FACE: Place = 'face'

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
  /** A glass card's last word: its "to", at most cardWords after it comes up. */
  const cardEnd = (value: unknown) => Math.min(to, at + L.cardWords, Math.max(at + 2, inside(value, at + 8)))
  switch (raw.kind) {
    case 'title': {
      const text = str(raw.text) || str(raw.label)
      return text ? { kind: 'title', at, text, ...withIcon(raw.icon) } : null
    }
    case 'note': {
      const text = str(raw.text) || str(raw.label)
      return text ? { kind: 'note', at, text } : null
    }
    case 'icons': {
      const items = list(raw.items)
        .slice(0, 4)
        .flatMap((item, i) => {
          const icon = iconOf(item.icon)
          return icon ? [{ icon, text: str(item.text, 20), at: inside(item.at, at), tone: toneOf(item.tone, i % 2 === 0 ? 'purple' : 'green') }] : []
        })
      return items.length > 0 ? { kind: 'icons', at: Math.min(at, ...items.map((i) => i.at)), items } : null
    }
    case 'cards': {
      const cards = list(raw.cards)
        .slice(0, L.cards)
        .map((card, i) => ({
          badge: str(card.badge, 20).toUpperCase(),
          tone: toneOf(card.tone, i === 0 ? 'purple' : 'green'),
          at: inside(card.at, at),
          ...withIcon(card.icon),
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
        .flatMap((item) => (str(item.text) ? [{ text: str(item.text), at: inside(item.at, at), ...withIcon(item.icon) }] : []))
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
      return text ? { kind: 'number', at, label: str(raw.label), text, ...withIcon(raw.icon) } : null
    }
    case 'pop': {
      const text = str(raw.text, 32) || str(raw.label, 32)
      if (!text) return null
      const end = Math.min(to, at + L.popWords, Math.max(at + 2, inside(raw.to, at + 5)))
      return { kind: 'pop', at, to: end, text, ...withIcon(raw.icon), tone: toneOf(raw.tone, 'purple') }
    }
    case 'tag': {
      const text = str(raw.text, 40)
      if (!text) return null
      const mark = str(raw.mark, 40)
      return { kind: 'tag', at, to: cardEnd(raw.to), label: str(raw.label, 48), text, mark: mark && text.toLowerCase().includes(mark.toLowerCase()) ? mark : '', place: ABOVE_FACE }
    }
    case 'blocks': {
      const title = str(raw.title, 32) || str(raw.text, 32)
      if (!title) return null
      const end = cardEnd(raw.to)
      const afterRaw = raw.after && typeof raw.after === 'object' ? (raw.after as Record<string, unknown>) : null
      const afterText = afterRaw ? str(afterRaw.text, 32) : ''
      const afterAt = afterRaw ? Math.max(at + 1, Math.min(end, inside(afterRaw.at, end))) : end
      return { kind: 'blocks', at, to: end, title, tag: str(raw.tag, 20), after: afterText && afterAt > at ? { at: afterAt, text: afterText } : null, place: ABOVE_FACE }
    }
    case 'stat': {
      const text = str(raw.text, 12)
      return text ? { kind: 'stat', at, to: cardEnd(raw.to), tag: str(raw.tag, 24), text, sub: str(raw.sub, 32), place: ABOVE_FACE } : null
    }
    case 'picture': {
      const emoji = typeof raw.emoji === 'string' ? [...raw.emoji.trim()].slice(0, 4).join('') : ''
      const icon = iconOf(raw.icon)
      if (!emoji && !icon) return null
      return { kind: 'picture', at, to: cardEnd(raw.to), tag: str(raw.tag, 24), emoji, ...(icon ? { icon } : {}), place: ABOVE_FACE }
    }
    case 'compare': {
      const half = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
      const left = half(raw.left)
      const right = half(raw.right)
      const leftText = str(left.text, 24)
      const rightText = str(right.text, 24)
      if (!leftText || !rightText) return null
      const end = cardEnd(raw.to)
      const rightAt = Math.max(at, Math.min(end, inside(right.at, Math.round((at + end) / 2))))
      return { kind: 'compare', at, to: end, left: { label: str(left.label, 20), text: leftText }, right: { label: str(right.label, 20), text: rightText, at: rightAt }, place: ABOVE_FACE }
    }
    case 'steps': {
      const items = list(raw.items)
        .slice(0, L.stepItems)
        .flatMap((item) => {
          const text = str(item.text, 18)
          return text ? [{ text, note: str(item.note, 24), at: inside(item.at, at), ...withIcon(item.icon), pill: str(item.pill, 12) }] : []
        })
        .sort((a, b) => a.at - b.at)
      if (items.length < 2) return null
      const end = Math.max(items[items.length - 1].at + 2, inside(raw.to, to))
      return { kind: 'steps', at: Math.min(at, items[0].at), to: Math.min(to, end), tag: str(raw.tag, 40), items }
    }
    default:
      return null
  }
}

/** Claude's storyboard made safe to draw: every word number inside the
 *  words, scenes in order and apart, every list at most its limit, every
 *  text short. `words`: how many words there are. */
/** The call to action's place: Claude's when it fits the look, else one
 *  picked by `seed` (the video's own), so videos differ. */
export function ctaPlace(format: Format, asked: unknown, seed: number): CtaPlace {
  const places = CTA_PLACES[format]
  if (typeof asked === 'string' && (places as readonly string[]).includes(asked)) return asked as CtaPlace
  return places[Math.abs(Math.round(seed)) % places.length]
}

export function cleanStoryboard(value: unknown, words: number): Storyboard {
  if (!value || typeof value !== 'object' || words <= 0) return EMPTY_STORYBOARD
  const raw = value as Record<string, unknown>
  const format: Format = raw.format === 'glass' ? 'glass' : 'board'
  const allowed = format === 'glass' ? GLASS_PARTS : BOARD_PARTS
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
    let to = Math.max(from, wordAt(s.to, words, from))
    let parts = list(s.parts)
      .slice(0, MOTION_LIMITS.parts)
      .filter((p) => allowed.includes(p.kind as PartKind))
      .flatMap((p) => cleanPart(p, from, to, words) ?? [])
    if (format === 'board') {
      // A pop card is alone in its scene: with board parts it would sit on
      // the board, so there the board parts win.
      if (parts.some((p) => p.kind !== 'pop')) parts = parts.filter((p) => p.kind !== 'pop')
      else parts = parts.slice(0, 1)
      // The board is up for a moment, not a minute: a long scene is cut
      // short, and what came after its end is left out.
      if (!popScene({ parts }) && to - from > MOTION_LIMITS.boardWords) {
        to = from + MOTION_LIMITS.boardWords
        parts = parts.filter((p) => p.at <= to)
      }
      if (popScene({ parts })) to = Math.min(to, (parts[0] as { to: number }).to)
    } else {
      // One card at a time: the scene is its one part, as long as it is up.
      parts = parts.slice(0, 1)
      if (parts[0] && 'to' in parts[0]) to = Math.min(to, parts[0].to)
    }
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
  // Always a call to action at the end (his ask, 2026-11-08): his own, or
  // DEFAULT_CTA over his last words.
  const endRaw = raw.end && typeof raw.end === 'object' ? (raw.end as Record<string, unknown>) : null
  const endText = (endRaw && str(endRaw.text, 32)) || DEFAULT_CTA
  const end = {
    at: endRaw && str(endRaw.text, 32) ? wordAt(endRaw.at, words, Math.max(0, words - 6)) : Math.max(0, words - 6),
    text: endText,
    // Where Claude put it, or - not said - a place of its own for this
    // video, so they aren't all in the same spot (his ask, 2026-11-12).
    place: ctaPlace(format, endRaw?.place, words + endText.length),
    ...(endRaw && typeof endRaw.icon === 'string' && (ICONS as readonly string[]).includes(endRaw.icon) ? { icon: endRaw.icon as Icon } : {}),
  }
  // Each word once, in order.
  const emphasis: Emphasis[] = []
  if (format === 'glass') {
    const byWord = new Map<number, EmphasisStyle>()
    for (const e of list(raw.emphasis)) {
      if (e.style !== 'accent' && e.style !== 'pill') continue
      byWord.set(wordAt(e.at, words, 0), e.style)
    }
    for (const [at, style] of [...byWord].sort((a, b) => a[0] - b[0])) {
      if (emphasis.length >= MOTION_LIMITS.emphasis) break
      emphasis.push({ at, style })
    }
  }
  const titleRaw = raw.title && typeof raw.title === 'object' ? (raw.title as Record<string, unknown>) : null
  const titleText = format === 'glass' && titleRaw ? str(titleRaw.text, 60) : ''
  const title = titleText ? { text: titleText, to: Math.max(2, Math.min(words - 1, wordAt(titleRaw!.to, words, 8), 20)) } : null
  return { format, emphasis, title, hook: format === 'board' ? hook : null, scenes, end }
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
    case 'icons':
      for (const item of part.items) item.at = clamp(item.at)
      break
    case 'pop':
    case 'tag':
    case 'stat':
    case 'picture':
      part.to = Math.max(part.at, clamp(part.to))
      break
    case 'blocks':
      part.to = Math.max(part.at, clamp(part.to))
      if (part.after) part.after.at = Math.max(part.at, Math.min(part.to, part.after.at))
      break
    case 'compare':
      part.to = Math.max(part.at, clamp(part.to))
      part.right.at = Math.max(part.at, Math.min(part.to, part.right.at))
      break
    case 'steps':
      part.to = Math.max(part.at, clamp(part.to))
      for (const item of part.items) item.at = clamp(item.at)
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
  if (format === 'glass') {
    return cleanStoryboard(
      {
        format: 'glass',
        title: { text: 'How I do it', to: 2 },
        emphasis: [{ at: 2, style: 'accent' }],
        scenes: [{ from: 3, to: 5, says: 'A card over your chest.', parts: [{ kind: 'tag', at: 3, to: 5, label: 'Test', text: 'edited end-to-end', mark: 'end-to-end', place: 'low' }] }],
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
