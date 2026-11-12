// The "glass" look of motion graphics (Format 2 since 2026-11-08, from his
// example reel: "I want the formats to look a little more like this. I want
// claude to be able to edit just like this"). His face stays full screen and,
// every few seconds, a frosted glass card comes and goes: a label with a bold
// line and one word in an orange pill, a row of blocks losing its red ones, a
// number counting up over growing bars, a picture. Sometimes the card is
// BEHIND him - his head and shoulders cut out and drawn back over it ("there's
// my face, and then there's the glass behind me"). For a list of steps the
// whole screen turns light blue and his video shrinks into a box under the
// list. A title over his head at the start, the captions in a dark bar, and
// always a call to action at the end.
//
// The captions here are the look's own (in the old Format 2 too): the bar is
// drawn from his checked words, so the Cutter's caption screen still edits them.
// Drawn by drawMotion (draw.ts) on every frame of the render and every still.

import { DEFAULT_CTA, type EmphasisStyle, type Part, type Place, type Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import { HEADLINE_FAMILY } from '../headlineFont'
import { confetti, countText, type Timing } from './draw'
import { drawIcon, drawIconBadge } from './icons'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Canvas = OffscreenCanvas | HTMLCanvasElement

/** His words for the captions: what shows, when each is said (`timing`, on
 *  the finished video), which phrase each is in, and which stand out. */
export interface Kinetic {
  words: readonly { text: string }[]
  timing: Timing
  /** [first, end) of each phrase, in order. */
  phrases: readonly (readonly [number, number])[]
  styleOf: (i: number) => EmphasisStyle | null
  /** Where the bar's middle sits, as a share of the frame's height - from
   *  where he put the captions (CAPTION_CENTER). */
  centerY?: number
  /** His caption size, 1 for normal. */
  scale?: number
}

/** Where the caption bar sits for each caption position he can pick on the
 *  caption screen - clear of TikTok's top bar and bottom buttons. */
export const CAPTION_CENTER: Record<'top' | 'middle' | 'usual' | 'bottom', number> = { top: 0.2, middle: 0.5, usual: 0.7, bottom: 0.77 }

const SANS = HEADLINE_FAMILY
export const GLASS_COLOURS = {
  ink: '#141826',
  grey: '#6b7186',
  blue: '#3d5afe',
  blueLight: '#7b93ff',
  orange: '#ec7a4f',
  orangeLight: '#f59a6c',
  red: '#ef5a6f',
  green: '#22b45e',
  bar: 'rgba(20, 28, 62, 0.8)',
  stage: '#e9f2fb',
  stageLow: '#d4e4f5',
} as const
/** The steps' number badges, in turn. */
const STEP_COLOURS = ['#2bb6c9', '#3d5afe', '#7b5cf0', '#ec7a4f', '#e2508f', '#22b45e']

const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : Number.isFinite(n) ? n : 0)
const easeOut = (p: number) => 1 - (1 - p) ** 3
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
const easeBack = (p: number) => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2
/** Things come up this much before their word, like the captions. */
const LEAD = 0.05
const IN_SEC = 0.38
const OUT_SEC = 0.28
/** A card stays this long after its last word. */
const HOLD = 0.35
/** The light screen of the steps takes this long to come and go. */
const STAGE_SEC = 0.5
/** The square in the middle of the frame that every graphic stays inside -
 *  where viewers look (his rule, 2026-11-11: "imagine a sort of square in
 *  the middle of the video ... I want all the visuals to go inside that
 *  square"). As wide as the frame on a vertical video, centred up and down. */
export function squareOf(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height)
  return { x: (width - size) / 2, y: (height - size) / 2, size }
}
/** Graphics are drawn this much smaller than they used to be, to sit well
 *  inside the square ("the visuals are a little bit too large"). */
const CARD_SCALE = 0.85
/** The small words on a card (labels, tags, notes), in u: never smaller, so
 *  they read on a phone (2026-11-12: some were 2.1u, about 8 pt). */
const LABEL_PX = 3.4

/** Most words in one caption phrase, and a pause that ends one. */
const PHRASE_WORDS = 5
const PHRASE_PAUSE = 0.45
/** A caption phrase stays a moment after its last word. */
const PHRASE_HOLD = 0.5

// ---------------------------------------------------------------------------
// The captions' phrases

/** His words split into phrases for the bar: at most PHRASE_WORDS, ending at
 *  a sentence or comma, or a pause. */
export function kineticPhrases(words: readonly { text: string; start: number; end: number }[]): [number, number][] {
  const phrases: [number, number][] = []
  let first = 0
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1]
    const ends = !next || i - first + 1 >= PHRASE_WORDS || /[.!?,;:…]["'”)]*$/.test(words[i].text.trim()) || next.start - words[i].end > PHRASE_PAUSE
    if (ends) {
      phrases.push([first, i + 1])
      first = i + 1
    }
  }
  return phrases
}

/** A word as it shows in the bar: no trailing comma or full stop (an
 *  ellipsis, a question or an exclamation mark stays). */
export function barText(text: string): string {
  const trimmed = text.trim().replace(/^["'“(]+/, '').replace(/["'”)]+$/, '')
  return /\.{2,}$|…$/.test(trimmed) ? trimmed : trimmed.replace(/[.,;:]+$/, '')
}

/** The phrase up at `t`, if any: the newest one started, until the next
 *  starts or a moment after its last word. */
export function phraseAt(kinetic: Kinetic, t: number): { phrase: readonly [number, number]; fade: number; since: number } | null {
  let found = -1
  for (let k = 0; k < kinetic.phrases.length; k++) {
    if (kinetic.timing.start(kinetic.phrases[k][0]) - LEAD <= t) found = k
    else break
  }
  if (found < 0) return null
  const phrase = kinetic.phrases[found]
  const next = kinetic.phrases[found + 1]
  const start = kinetic.timing.start(phrase[0]) - LEAD
  const until = Math.min(kinetic.timing.end(phrase[1] - 1) + PHRASE_HOLD, next ? kinetic.timing.start(next[0]) - LEAD : Infinity)
  if (t >= until) return null
  return { phrase, fade: clamp01((until - t) / 0.12), since: t - start }
}

// ---------------------------------------------------------------------------
// Canvas helpers

function makeCanvas(width: number, height: number): Canvas | null {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return null
}

const kept = new Map<string, Canvas>()
/** A canvas of this size kept for the whole render, one per `name`. */
function scratch(name: string, width: number, height: number): { canvas: Canvas; ctx: Ctx } | null {
  const key = `${name}:${Math.round(width)}x${Math.round(height)}`
  let canvas = kept.get(key) ?? null
  if (!canvas) {
    canvas = makeCanvas(width, height)
    if (!canvas) return null
    kept.set(key, canvas)
  }
  const ctx = canvas.getContext('2d') as Ctx | null
  return ctx ? { canvas, ctx } : null
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function font(px: number, weight = 700): string {
  return `${weight} ${Math.round(px)}px ${SANS}`
}

function textWidth(ctx: Ctx, text: string, px: number, weight = 700): number {
  ctx.font = font(px, weight)
  return ctx.measureText(text).width
}

function text(ctx: Ctx, value: string, x: number, y: number, px: number, colour: string, weight = 700, align: CanvasTextAlign = 'left', maxWidth?: number): void {
  ctx.font = font(px, weight)
  ctx.fillStyle = colour
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (maxWidth) ctx.fillText(value, x, y, maxWidth)
  else ctx.fillText(value, x, y)
}

/** The frame as it is now, before anything of the look is drawn on it. */
interface Frame {
  /** The frame itself, for his video in the steps' box and for him over a
   *  card behind him. */
  copy: Canvas | null
  /** A blurred copy, for the frost of the glass - made when first needed. */
  frost: () => Canvas | null
}

function grabFrame(ctx: Ctx, width: number, height: number): Frame {
  const source = (ctx as { canvas?: unknown }).canvas as CanvasImageSource | undefined
  if (!source || typeof (source as { width?: unknown }).width !== 'number') return { copy: null, frost: () => null }
  const copy = scratch('frame', width, height)
  if (!copy) return { copy: null, frost: () => null }
  copy.ctx.globalCompositeOperation = 'copy'
  copy.ctx.drawImage(source, 0, 0, width, height)
  copy.ctx.globalCompositeOperation = 'source-over'
  let frost: Canvas | null | undefined
  return {
    copy: copy.canvas,
    frost: () => {
      if (frost !== undefined) return frost
      // Blurred by shrinking it twice and growing it back: works on every
      // phone, where a canvas blur filter does not (Safari).
      const small = scratch('frost-a', width / 10, height / 10)
      const tiny = scratch('frost-b', width / 34, height / 34)
      if (!small || !tiny) return (frost = null)
      for (const s of [small, tiny]) {
        s.ctx.imageSmoothingEnabled = true
        s.ctx.imageSmoothingQuality = 'high'
      }
      small.ctx.drawImage(copy.canvas, 0, 0, small.canvas.width, small.canvas.height)
      tiny.ctx.drawImage(small.canvas, 0, 0, tiny.canvas.width, tiny.canvas.height)
      small.ctx.drawImage(tiny.canvas, 0, 0, small.canvas.width, small.canvas.height)
      return (frost = small.canvas)
    },
  }
}

/** A frosted glass panel: the frame behind it blurred and lightened, a soft
 *  shadow, a bright edge. `dark` for the picture card. */
function glassPanel(ctx: Ctx, frame: Frame, width: number, height: number, x: number, y: number, w: number, h: number, r: number, u: number, dark = false): void {
  ctx.save()
  ctx.shadowColor = 'rgba(10, 14, 30, 0.28)'
  ctx.shadowBlur = 4 * u
  ctx.shadowOffsetY = 1.2 * u
  ctx.fillStyle = dark ? 'rgba(18, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.55)'
  roundRect(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, w, h, r)
  ctx.clip()
  const frost = frame.frost()
  if (frost) {
    // Drawn where it is on the frame, whatever the card's own move.
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(frost, 0, 0, width, height)
    ctx.restore()
  }
  ctx.fillStyle = dark ? 'rgba(16, 18, 28, 0.72)' : 'rgba(250, 251, 255, 0.72)'
  ctx.fillRect(x, y, w, h)
  // Light catching the top edge.
  const shine = ctx.createLinearGradient(0, y, 0, y + h)
  shine.addColorStop(0, dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.6)')
  shine.addColorStop(0.45, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = shine
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.95)'
  ctx.lineWidth = Math.max(1, 0.28 * u)
  roundRect(ctx, x, y, w, h, r)
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// One at a time: when each graphic comes in and when it is gone

/** When a graphic starts coming in and when it is fully gone, on the
 *  finished video. */
export interface Slot {
  start: number
  gone: number
}

/** A graphic is up at least this long, even when the next one comes soon. */
const MIN_UP = 1.4
/** A beat of just him between two graphics. */
const BREATH = 0.12

/** Every graphic of the look in turn - the title, each card or steps screen,
 *  the call to action - never two at once (2026-11-12: a card came up while
 *  the steps screen was still leaving, the call to action over the last
 *  card). One that would start before the last is gone cuts the last short,
 *  down to MIN_UP; if that is not enough, it waits. `time`: the plan's own
 *  timing, every word known (the render's fills in as it goes). */
export function glassSlots(board: Storyboard, time: Timing): Map<object, Slot> {
  const items: { key: object; start: number; gone: number }[] = []
  if (board.title) items.push({ key: board.title, start: 0, gone: time.end(board.title.to) + HOLD + OUT_SEC })
  const parts = board.scenes.flatMap((scene) => scene.parts).sort((a, b) => a.at - b.at)
  for (const part of parts) {
    if (!('to' in part)) continue
    const stage = part.kind === 'steps'
    items.push({ key: part, start: time.start(part.at) - LEAD, gone: time.end(part.to) + HOLD + (stage ? STAGE_SEC * 0.4 : 0) })
  }
  if (board.end) items.push({ key: board.end, start: time.start(board.end.at) - LEAD, gone: Infinity })
  const slots = new Map<object, Slot>()
  let last: { key: object; start: number; gone: number } | null = null
  for (const item of items) {
    if (!Number.isFinite(item.start)) continue
    if (last && item.start < last.gone + BREATH) {
      last.gone = Math.max(last.start + MIN_UP, item.start - BREATH)
      if (item.start < last.gone + BREATH) item.start = last.gone + BREATH
      if (item.gone < item.start + MIN_UP) item.gone = item.start + MIN_UP
      slots.set(last.key, { start: last.start, gone: last.gone })
    }
    slots.set(item.key, { start: item.start, gone: item.gone })
    last = item
  }
  return slots
}

// ---------------------------------------------------------------------------
// The cards

type CardPart = Extract<Part, { kind: 'tag' | 'blocks' | 'stat' | 'picture' | 'compare' }>
const isCard = (p: Part): p is CardPart => p.kind === 'tag' || p.kind === 'blocks' || p.kind === 'stat' || p.kind === 'picture' || p.kind === 'compare'

/** How far a card is in (0 to 1) at `t`, and how far out at its end - in
 *  its slot (glassSlots), so never over another graphic. */
function cardLife(slot: Slot | undefined, t: number): { p: number; out: number; at: number } | null {
  if (!slot || !(t >= slot.start) || t > slot.gone) return null
  return { p: clamp01((t - slot.start) / IN_SEC), out: clamp01((slot.gone - t) / OUT_SEC), at: slot.start + LEAD }
}

/** A card's size in u (a hundredth of the width). */
function cardSize(ctx: Ctx, part: CardPart, u: number): { w: number; h: number } {
  switch (part.kind) {
    case 'tag': {
      const label = part.label ? textWidth(ctx, part.label, LABEL_PX * u, 700) + 8 * u : 0
      const line = textWidth(ctx, part.text, 6.4 * u, 800) + (part.mark ? 3 * u : 0)
      return { w: Math.min(88 * u, Math.max(46 * u, label, line) + 7 * u), h: part.label ? 21 * u : 13 * u }
    }
    case 'blocks':
      return { w: 82 * u, h: 22 * u }
    case 'stat':
      return { w: 44 * u, h: 40 * u }
    case 'picture':
      return { w: 34 * u, h: 36 * u }
    case 'compare':
      return { w: 84 * u, h: 26 * u }
  }
}

/** Where a card of `size` sits for `place`, inside the square: over his
 *  face ("face"), right of his head ("side"), over his chest ("low"); a card
 *  behind him is placed by behindBox, beside his head. */
function cardBox(place: Place, size: { w: number; h: number }, width: number, height: number, u: number): { x: number; y: number; scale: number } {
  const sq = squareOf(width, height)
  const scale = Math.min(CARD_SCALE, (sq.size - 14 * u) / size.w)
  const w = size.w * scale
  const h = size.h * scale
  const inside = (y: number) => Math.max(sq.y + 3 * u, Math.min(sq.y + sq.size - 3 * u - h, y))
  // Every card, whatever its place: above his face, over his forehead, at the
  // top of the square - never under his face or beside it (his strict rule,
  // 2026-11-11). A plan made before with "low" or "side" is drawn there too.
  void place
  return { x: width / 2 - w / 2, y: inside(sq.y + 3 * u), scale }
}

/** Where a card behind him goes: beside his head, on the side with more room
 *  behind him at that moment (read off his cut-out), in the top of the square -
 *  so his head covers at most its edge, never half of it (his report,
 *  2026-11-11: "half of them are getting covered"). Too little room either
 *  side: null - it is drawn in front, over his face, instead. Worked out once,
 *  as the card comes up, and kept for its life. */
const behindBoxes = new WeakMap<object, { x: number; y: number; scale: number } | null>()
function behindBox(part: CardPart, size: { w: number; h: number }, width: number, height: number, u: number, cutout: CanvasImageSource | null | undefined): { x: number; y: number; scale: number } | null {
  if (behindBoxes.has(part)) return behindBoxes.get(part)!
  const sq = squareOf(width, height)
  // Room either side of him, as shares of the width; a still without his
  // cut-out takes the usual: his head in the middle third.
  const room = cutout ? roomBeside(cutout, height, sq) : { left: 0.33, right: 0.33 }
  const side = room.right >= room.left ? 'right' : 'left'
  const free = Math.max(room.left, room.right) * width
  const scale = Math.min(CARD_SCALE, (free + 6 * u) / size.w)
  let box: { x: number; y: number; scale: number } | null = null
  if (size.w * scale >= 30 * u) {
    const w = size.w * scale
    box = { x: side === 'right' ? sq.x + sq.size - 4 * u - w : sq.x + 4 * u, y: sq.y + 4 * u, scale }
  }
  behindBoxes.set(part, box)
  return box
}

/** How much of the frame's width is free of him, left and right of his head,
 *  in the top third of the square - from his cut-out (white where he is). */
function roomBeside(cutout: CanvasImageSource, height: number, sq: { y: number; size: number }): { left: number; right: number } {
  const W = 40
  const H = 71
  const small = scratch('room', W, H)
  if (!small) return { left: 0.33, right: 0.33 }
  try {
    small.ctx.clearRect(0, 0, W, H)
    small.ctx.drawImage(cutout, 0, 0, W, H)
    const data = small.ctx.getImageData(0, 0, W, H).data
    const from = Math.floor((sq.y / height) * H)
    // Head height only: his shoulders further down never decide the side.
    const to = Math.ceil(((sq.y + sq.size * 0.32) / height) * H)
    const him = new Array<boolean>(W).fill(false)
    for (let y = from; y < Math.min(H, to); y++) {
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4
        if (data[k] > 128 && data[k + 3] > 128) him[x] = true
      }
    }
    const first = him.indexOf(true)
    if (first < 0) return { left: 0.5, right: 0.5 }
    const last = him.lastIndexOf(true)
    return { left: first / W, right: (W - 1 - last) / W }
  } catch {
    return { left: 0.33, right: 0.33 }
  }
}

/** The fixed pattern of red blocks for a row: three or four, never side by
 *  side, the same every frame. */
export function redBlocks(count: number, seed: number): Set<number> {
  const red = new Set<number>()
  let state = (seed * 2654435761 + 11) >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let tries = 0; red.size < 4 && tries < 40; tries++) {
    const i = 1 + Math.floor(next() * (count - 2))
    if (!red.has(i - 1) && !red.has(i + 1)) red.add(i)
  }
  return red
}

function drawCardInside(ctx: Ctx, part: CardPart, x: number, y: number, w: number, h: number, u: number, t: number, time: Timing, at: number): void {
  switch (part.kind) {
    case 'tag': {
      let rowY = y + h / 2
      if (part.label) {
        // The label in a thin pill with a dot, then the line under it.
        const lp = clamp01((t - at - 0.1) / 0.3)
        ctx.save()
        ctx.globalAlpha *= lp
        const label = part.label
        const lw = textWidth(ctx, label, LABEL_PX * u, 700) + 7 * u
        const ly = y + 6 * u
        ctx.strokeStyle = 'rgba(236, 122, 79, 0.45)'
        ctx.lineWidth = Math.max(1, 0.22 * u)
        roundRect(ctx, x + 3.5 * u, ly - 2.5 * u, Math.min(lw, w - 7 * u), 5 * u, 2.5 * u)
        ctx.stroke()
        ctx.fillStyle = GLASS_COLOURS.orange
        ctx.beginPath()
        ctx.arc(x + 5.8 * u, ly, 0.7 * u, 0, Math.PI * 2)
        ctx.fill()
        text(ctx, label, x + 7.6 * u, ly + 0.1 * u, LABEL_PX * u, GLASS_COLOURS.orange, 700, 'left', w - 12 * u)
        ctx.restore()
        rowY = y + 14.2 * u
      }
      // The line, the marked words in an orange pill that wipes in.
      const px = Math.min(6.4 * u, (6.4 * u * (w - 9 * u)) / Math.max(1, textWidth(ctx, part.text, 6.4 * u, 800) + (part.mark ? 3 * u : 0)))
      const lower = part.text.toLowerCase()
      const from = part.mark ? lower.indexOf(part.mark.toLowerCase()) : -1
      const pieces = from >= 0 ? [part.text.slice(0, from), part.text.slice(from, from + part.mark.length), part.text.slice(from + part.mark.length)] : [part.text, '', '']
      let cx = x + 3.5 * u
      const pad = 1.5 * u
      for (let k = 0; k < 3; k++) {
        const piece = pieces[k]
        if (!piece) continue
        const pw = textWidth(ctx, piece, px, 800)
        if (k === 1) {
          const mp = clamp01((t - at - 0.35) / 0.32)
          ctx.save()
          const grad = ctx.createLinearGradient(cx, 0, cx + pw + 2 * pad, 0)
          grad.addColorStop(0, GLASS_COLOURS.orange)
          grad.addColorStop(1, GLASS_COLOURS.orangeLight)
          ctx.fillStyle = grad
          roundRect(ctx, cx, rowY - px * 0.68, (pw + 2 * pad) * easeOut(mp), px * 1.36, 1.4 * u)
          ctx.fill()
          ctx.restore()
          text(ctx, piece, cx + pad, rowY, px, mp > 0.5 ? '#ffffff' : GLASS_COLOURS.ink, 800)
          cx += pw + 2 * pad
        } else {
          text(ctx, piece, cx, rowY, px, GLASS_COLOURS.ink, 800)
          cx += pw
        }
      }
      return
    }
    case 'blocks': {
      const count = 12
      const red = redBlocks(count, part.at)
      const after = part.after ? clamp01((t - time.start(part.after.at)) / 0.4) : 0
      const title = after > 0.5 && part.after ? part.after.text : part.title
      ctx.save()
      ctx.globalAlpha *= after > 0 ? Math.abs(after - 0.5) * 2 : 1
      text(ctx, title, x + 3.5 * u, y + 6 * u, 5.2 * u, GLASS_COLOURS.ink, 800, 'left', w - (part.tag ? 26 : 7) * u)
      ctx.restore()
      if (part.tag) text(ctx, part.tag, x + w - 3.5 * u, y + 6 * u, LABEL_PX * u, GLASS_COLOURS.blue, 700, 'right')
      // The row: each block pops in in turn; on "after" the red ones close up.
      const rowX = x + 3.5 * u
      const rowW = w - 7 * u
      const gap = 1 * u
      const sizeOf = (i: number) => (red.has(i) ? 1 - easeInOut(after) : 1)
      const total = Array.from({ length: count }, (_, i) => sizeOf(i)).reduce((a, b) => a + b, 0)
      const unit = (rowW - gap * (count - 1)) / count
      const stretch = (rowW - gap * (total - 1)) / Math.max(0.001, total * unit)
      let bx = rowX
      for (let i = 0; i < count; i++) {
        const share = sizeOf(i)
        const bw = unit * share * stretch
        // From the moment the card is in: never an empty card.
        const bp = clamp01((t - at + 0.05 - i * 0.03) / 0.2)
        if (bw > 0.2 && bp > 0) {
          const by = y + 11.6 * u
          const bh = 7 * u
          ctx.save()
          ctx.globalAlpha *= bp
          const grad = ctx.createLinearGradient(0, by, 0, by + bh)
          grad.addColorStop(0, red.has(i) ? '#ff7a8c' : GLASS_COLOURS.blueLight)
          grad.addColorStop(1, red.has(i) ? GLASS_COLOURS.red : GLASS_COLOURS.blue)
          ctx.fillStyle = grad
          const s = 0.7 + 0.3 * easeBack(bp)
          roundRect(ctx, bx + (bw * (1 - s)) / 2, by + (bh * (1 - s)) / 2, bw * s, bh * s, 1 * u)
          ctx.fill()
          ctx.restore()
        }
        bx += bw + gap * Math.min(1, share * 2)
      }
      return
    }
    case 'stat': {
      if (part.tag) text(ctx, part.tag, x + w - 3.5 * u, y + 5 * u, LABEL_PX * u, GLASS_COLOURS.blue, 700, 'right', w - 6 * u)
      const counted = clamp01((t - at - 0.1) / 1)
      text(ctx, countText(part.text, easeOut(counted)), x + w - 3.5 * u, y + 12.4 * u, 9 * u, GLASS_COLOURS.ink, 800, 'right', w - 6 * u)
      if (part.sub) text(ctx, part.sub, x + w - 3.5 * u, y + 19 * u, LABEL_PX * u, GLASS_COLOURS.grey, 600, 'right', w - 6 * u)
      // The bars grow in turn, then breathe a little - under the words,
      // never over the small line.
      const bars = [0.5, 0.72, 0.46, 0.9, 0.66, 0.98]
      const areaY = y + h - 3.5 * u
      const areaH = 13 * u
      const gap = 1.2 * u
      const bw = (w - 7 * u - gap * (bars.length - 1)) / bars.length
      bars.forEach((height, i) => {
        const bp = easeOut(clamp01((t - at - 0.2 - i * 0.08) / 0.5))
        const bh = areaH * height * bp * (1 + 0.04 * Math.sin((t - at) * 3 + i))
        if (bh <= 0) return
        const bx = x + 3.5 * u + i * (bw + gap)
        const grad = ctx.createLinearGradient(0, areaY - bh, 0, areaY)
        grad.addColorStop(0, GLASS_COLOURS.blueLight)
        grad.addColorStop(1, GLASS_COLOURS.blue)
        ctx.fillStyle = grad
        roundRect(ctx, bx, areaY - bh, bw, bh, 0.9 * u)
        ctx.fill()
      })
      confetti(ctx, x + w * 0.6, y + 12.4 * u, u, t - at - 1.1, part.at)
      return
    }
    case 'picture': {
      if (part.tag) {
        const tw = textWidth(ctx, part.tag, LABEL_PX * u, 700) + 4 * u
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.lineWidth = Math.max(1, 0.2 * u)
        roundRect(ctx, x + 2.6 * u, y + 2.6 * u, Math.min(tw, w - 5.2 * u), 5 * u, 2.5 * u)
        ctx.stroke()
        text(ctx, part.tag, x + 4.6 * u, y + 5.2 * u, LABEL_PX * u, '#ffffff', 700, 'left', w - 9 * u)
      }
      const life = t - at
      const bob = Math.sin(life * 2.4) * 0.9 * u
      const pp = easeBack(clamp01((life - 0.12) / 0.4))
      const cx = x + w / 2
      const cy = y + h / 2 + 2.6 * u + bob
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(pp, pp)
      // A glow under it.
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 13 * u)
      glow.addColorStop(0, 'rgba(255, 150, 90, 0.35)')
      glow.addColorStop(1, 'rgba(255, 150, 90, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(-14 * u, -14 * u, 28 * u, 28 * u)
      if (part.emoji) {
        ctx.font = `${Math.round(17 * u)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        ctx.fillText(part.emoji, 0, 0)
      } else if (part.icon) drawIcon(ctx, part.icon, 0, 0, 18 * u, '#ffffff', life)
      ctx.restore()
      return
    }
    case 'compare': {
      // Left: the usual way, its words crossed out once it is read. Right:
      // his way, sliding in on its own word, ticked, on a green tint.
      const gutter = 8 * u
      const half = (w - 7 * u - gutter) / 2
      const lx = x + 3.5 * u
      const rx = lx + half + gutter
      const labelY = y + 6.6 * u
      const textY = y + 16 * u
      const fit = (value: string) => Math.min(6.2 * u, (6.2 * u * (half - 1 * u)) / Math.max(1, textWidth(ctx, value, 6.2 * u, 800)))
      if (part.left.label) text(ctx, part.left.label, lx, labelY, LABEL_PX * u, GLASS_COLOURS.grey, 700, 'left', half - 7 * u)
      const leftPx = fit(part.left.text)
      const strike = easeOut(clamp01((t - at - 0.45) / 0.3))
      text(ctx, part.left.text, lx, textY, leftPx, strike >= 1 ? GLASS_COLOURS.grey : GLASS_COLOURS.ink, 800, 'left', half)
      if (strike > 0) {
        const lw = Math.min(half, textWidth(ctx, part.left.text, leftPx, 800))
        ctx.save()
        ctx.strokeStyle = GLASS_COLOURS.red
        ctx.lineWidth = Math.max(1, 0.55 * u)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(lx, textY)
        ctx.lineTo(lx + lw * strike, textY)
        ctx.stroke()
        ctx.restore()
        cross(ctx, lx + half - 2.6 * u, labelY, 4.2 * u * easeBack(strike))
      }
      // Between them, a thin line with "vs" on it.
      ctx.save()
      ctx.strokeStyle = 'rgba(20, 24, 38, 0.12)'
      ctx.lineWidth = Math.max(1, 0.2 * u)
      const mid = lx + half + gutter / 2
      ctx.beginPath()
      ctx.moveTo(mid, y + 3.5 * u)
      ctx.lineTo(mid, y + h - 3.5 * u)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(mid, textY, 3 * u, 0, Math.PI * 2)
      ctx.fill()
      text(ctx, 'vs', mid, textY + 0.1 * u, 2.7 * u, GLASS_COLOURS.grey, 800, 'center')
      ctx.restore()
      const rp = clamp01((t - time.start(part.right.at) + LEAD) / 0.35)
      if (rp > 0) {
        ctx.save()
        ctx.globalAlpha *= rp
        const slide = (1 - easeOut(rp)) * 6 * u
        ctx.fillStyle = 'rgba(34, 180, 94, 0.13)'
        roundRect(ctx, rx - 2 * u + slide, y + 2 * u, half + 3.5 * u, h - 4 * u, 2.4 * u)
        ctx.fill()
        if (part.right.label) text(ctx, part.right.label, rx + slide, labelY, LABEL_PX * u, GLASS_COLOURS.green, 800, 'left', half - 7 * u)
        text(ctx, part.right.text, rx + slide, textY, fit(part.right.text), GLASS_COLOURS.ink, 800, 'left', half)
        ctx.restore()
        const ticked = 4.6 * u * easeBack(clamp01((t - time.start(part.right.at) - 0.15) / 0.35))
        if (ticked > 0) tick(ctx, rx + half - 2.6 * u, labelY, ticked)
      }
      return
    }
  }
}

/** A small red square with a cross: the way that doesn't work. */
function cross(ctx: Ctx, cx: number, cy: number, size: number): void {
  if (size <= 0) return
  ctx.save()
  ctx.fillStyle = GLASS_COLOURS.red
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.25)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = size * 0.14
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.2, cy - size * 0.2)
  ctx.lineTo(cx + size * 0.2, cy + size * 0.2)
  ctx.moveTo(cx + size * 0.2, cy - size * 0.2)
  ctx.lineTo(cx - size * 0.2, cy + size * 0.2)
  ctx.stroke()
  ctx.restore()
}

/** Where a card goes this frame, and whether it is behind him: a card meant
 *  for behind him with no room beside his head comes in front instead. */
function placeCard(ctx: Ctx, part: CardPart, width: number, height: number, cutout?: CanvasImageSource | null): { box: { x: number; y: number; scale: number }; size: { w: number; h: number }; inside: { w: number; h: number }; behind: boolean } {
  const u = width / 100
  const inside = cardSize(ctx, part, u)
  // Never behind him beside his head any more (his strict rule, 2026-11-11):
  // above his face like the rest.
  void behindBox
  void cutout
  return { box: cardBox(part.place, inside, width, height, u), size: inside, inside, behind: false }
}

/** How a card comes in - one of a few, picked by where it is in the video,
 *  so they don't all move the same way (his report, 2026-11-11: "they're
 *  very, very, very repetitive"). */
function entranceOf(part: CardPart): number {
  return Math.abs(Math.round(part.at * 7 + part.to * 3)) % 4
}

function drawCard(ctx: Ctx, frame: Frame, part: CardPart, width: number, height: number, t: number, time: Timing, cutout: CanvasImageSource | null | undefined, slot: Slot | undefined): void {
  const life = cardLife(slot, t)
  if (!life) return
  const u = width / 100
  const { box, size, inside } = placeCard(ctx, part, width, height, cutout)
  ctx.save()
  ctx.globalAlpha *= clamp01(life.p * 2) * life.out
  const cx = box.x + (size.w * box.scale) / 2
  const cy = box.y + (size.h * box.scale) / 2
  const settle = 1 - easeOut(life.p)
  const drift = Math.sin((t - life.at) * 1.8) * 0.4 * u
  let s = box.scale * (0.96 + 0.04 * life.out)
  let dx = 0
  let dy = drift
  switch (entranceOf(part)) {
    case 0:
      // Rises in, a touch small, and settles.
      s *= 0.92 + 0.08 * easeBack(life.p)
      dy += settle * 5 * u
      break
    case 1:
      // Slides in from the left.
      dx = -settle * 14 * u
      break
    case 2:
      // Slides in from the right.
      dx = settle * 14 * u
      break
    default:
      // Pops up from small.
      s *= 0.6 + 0.4 * easeBack(life.p)
  }
  ctx.translate(cx + dx, cy + dy)
  ctx.scale(s, s)
  ctx.translate(-size.w / 2, -size.h / 2)
  glassPanel(ctx, frame, width, height, 0, 0, size.w, size.h, 3.2 * u, u, part.kind === 'picture')
  drawCardInside(ctx, part, 0, 0, inside.w, inside.h, u, t, time, life.at)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// The steps: the light screen, his video in a box

/** How far the light screen of a steps part is up at `t`, 0 to 1, in its slot. */
function stageOf(slot: Slot | undefined, t: number): number {
  if (!slot || !(t >= slot.start) || t > slot.gone) return 0
  return easeInOut(Math.min(clamp01((t - slot.start) / STAGE_SEC), clamp01((slot.gone - t) / STAGE_SEC)))
}

/** The steps part up at `t`, with how far its screen is up. */
export function stageAt(board: Storyboard, time: Timing, t: number, plan: Timing = time): { part: Extract<Part, { kind: 'steps' }>; up: number } | null {
  const slots = glassSlots(board, plan)
  for (const scene of board.scenes) {
    for (const part of scene.parts) {
      if (part.kind !== 'steps') continue
      const up = stageOf(slots.get(part), t)
      if (up > 0) return { part, up }
    }
  }
  return null
}

/** Where his video sits on the light screen: a box under the list. */
/** The steps' rows, inside the square: where the first starts and how far
 *  apart they are. */
function rowsOf(width: number, height: number, u: number): { top: number; pitch: number; x: number; w: number; h: number } {
  const sq = squareOf(width, height)
  return { top: sq.y + 9 * u, pitch: 11.4 * u, x: sq.x + 6 * u, w: sq.size - 12 * u, h: 9.6 * u }
}

function stageBox(rows: number, width: number, height: number, u: number): { x: number; y: number; w: number; h: number } {
  const sq = squareOf(width, height)
  const list = rowsOf(width, height, u)
  const top = list.top + rows * list.pitch + 3 * u
  const h = Math.max(20 * u, Math.min(64 * u, sq.y + sq.size - 3 * u - top))
  const w = h / 1.22
  return { x: width / 2 - w / 2, y: top, w, h }
}

function drawStage(ctx: Ctx, frame: Frame, part: Extract<Part, { kind: 'steps' }>, up: number, width: number, height: number, t: number, time: Timing): void {
  const u = width / 100
  ctx.save()
  ctx.globalAlpha = up
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, GLASS_COLOURS.stage)
  bg.addColorStop(1, GLASS_COLOURS.stageLow)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  const glow = ctx.createRadialGradient(width * 0.2, height * 0.15, 0, width * 0.2, height * 0.15, width * 0.8)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.7)')
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
  // His video: from the whole frame into its box, and back.
  const box = stageBox(part.items.length, width, height, u)
  const lerp = (a: number, b: number) => a + (b - a) * up
  const x = lerp(0, box.x)
  const y = lerp(0, box.y)
  const w = lerp(width, box.w)
  const h = lerp(height, box.h)
  if (frame.copy) {
    // The part of the frame the box shows: as tall as it can, around his face.
    const aspect = w / h
    const srcH = Math.min(height, width / aspect)
    const srcW = srcH * aspect
    const sx = Math.max(0, Math.min(width - srcW, width * 0.5 - srcW / 2))
    const sy = Math.max(0, Math.min(height - srcH, height * 0.42 - srcH / 2))
    ctx.save()
    if (up > 0.05) {
      ctx.shadowColor = `rgba(20, 30, 60, ${0.3 * up})`
      ctx.shadowBlur = 5 * u
      ctx.shadowOffsetY = 1.5 * u
      ctx.fillStyle = '#000'
      roundRect(ctx, x, y, w, h, 3.4 * u * up)
      ctx.fill()
      ctx.shadowColor = 'transparent'
    }
    roundRect(ctx, x, y, w, h, 3.4 * u * up)
    ctx.clip()
    ctx.drawImage(frame.copy, sx, sy, srcW, srcH, x, y, w, h)
    ctx.restore()
    if (up > 0.05) {
      ctx.save()
      ctx.globalAlpha = up
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.lineWidth = 0.5 * u
      roundRect(ctx, x, y, w, h, 3.4 * u)
      ctx.stroke()
      ctx.restore()
    }
  }
  // The list.
  ctx.save()
  ctx.globalAlpha = clamp01(up * 1.6)
  const list = rowsOf(width, height, u)
  if (part.tag) text(ctx, part.tag, list.x + u, list.top - 4.2 * u, 3.8 * u, GLASS_COLOURS.blue, 800, 'left', list.w)
  part.items.forEach((item, i) => {
    const at = time.start(item.at)
    const p = clamp01((t - at + LEAD) / 0.35)
    if (p <= 0) return
    const rowY = list.top + i * list.pitch
    const rowX = list.x + (1 - easeOut(p)) * -8 * u
    const rowW = list.w
    const rowH = list.h
    const colour = STEP_COLOURS[i % STEP_COLOURS.length]
    ctx.save()
    ctx.globalAlpha *= clamp01(p * 1.8)
    ctx.shadowColor = 'rgba(30, 50, 90, 0.12)'
    ctx.shadowBlur = 2.6 * u
    ctx.shadowOffsetY = 0.6 * u
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    roundRect(ctx, rowX, rowY, rowW, rowH, 2.2 * u)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    // A strip of its colour down the left edge, as in the example.
    ctx.save()
    roundRect(ctx, rowX, rowY, rowW, rowH, 2.2 * u)
    ctx.clip()
    ctx.fillStyle = colour
    ctx.fillRect(rowX, rowY, 0.8 * u, rowH)
    ctx.restore()
    const mid = rowY + rowH / 2
    ctx.fillStyle = colour
    roundRect(ctx, rowX + 2.6 * u, mid - 3.4 * u, 6.8 * u, 6.8 * u, 1.6 * u)
    ctx.fill()
    text(ctx, String(i + 1), rowX + 6 * u, mid + 0.1 * u, 3.8 * u, '#ffffff', 800, 'center')
    let tx = rowX + 12 * u
    if (item.icon) {
      drawIcon(ctx, item.icon, tx + 2.8 * u, mid, 5.6 * u, colour, t - at)
      tx += 7.6 * u
    }
    const pillW = item.pill ? textWidth(ctx, item.pill, 2.8 * u, 800) + 4 * u : 0
    const room = rowX + rowW - tx - (item.pill ? pillW + 4 * u : 3 * u)
    const textPx = Math.min(5 * u, (5 * u * room) / Math.max(1, textWidth(ctx, item.text, 5 * u, 800) + (item.note ? textWidth(ctx, item.note, 3.2 * u, 500) + 2 * u : 0)))
    const notePx = Math.max(LABEL_PX * u * 0.85, (textPx / (5 * u)) * 3.2 * u)
    text(ctx, item.text, tx, mid + 0.1 * u, Math.max(3.6 * u, textPx), GLASS_COLOURS.ink, 800, 'left', room)
    const tw = Math.min(room, textWidth(ctx, item.text, Math.max(3.6 * u, textPx), 800))
    if (item.note && room - tw > 6 * u) text(ctx, item.note, tx + tw + 2 * u, mid + 0.3 * u, notePx, GLASS_COLOURS.grey, 500, 'left', room - tw - 2 * u)
    if (item.pill) {
      const px = rowX + rowW - 2.6 * u - pillW
      ctx.fillStyle = i % 2 === 0 ? '#7b5cf0' : GLASS_COLOURS.orange
      roundRect(ctx, px, mid - 2.5 * u, pillW, 5 * u, 2.5 * u)
      ctx.fill()
      text(ctx, item.pill, px + pillW / 2, mid + 0.1 * u, 2.8 * u, '#ffffff', 800, 'center')
    }
    ctx.restore()
  })
  ctx.restore()
}

// ---------------------------------------------------------------------------
// The title, the captions, the call to action

function drawTitle(ctx: Ctx, title: NonNullable<Storyboard['title']>, slot: Slot | undefined, width: number, height: number, t: number): void {
  const u = width / 100
  // Gone by the time the first card comes up (glassSlots).
  if (!slot || t > slot.gone) return
  const out = clamp01((slot.gone - t) / OUT_SEC)
  const px = 6.6 * u
  // At most two lines, as even as can be.
  const words = title.text.split(/\s+/).filter(Boolean)
  let lines = [words]
  if (textWidth(ctx, title.text, px, 800) > 86 * u && words.length > 1) {
    let best = 1
    let bestDiff = Infinity
    for (let k = 1; k < words.length; k++) {
      const diff = Math.abs(textWidth(ctx, words.slice(0, k).join(' '), px, 800) - textWidth(ctx, words.slice(k).join(' '), px, 800))
      if (diff < bestDiff) {
        bestDiff = diff
        best = k
      }
    }
    lines = [words.slice(0, best), words.slice(best)]
  }
  const widest = Math.max(...lines.map((l) => textWidth(ctx, l.join(' '), px, 800)))
  const fit = Math.min(1, (88 * u) / Math.max(1, widest))
  const size = px * fit
  const space = textWidth(ctx, ' ', size, 800)
  let k = 0
  lines.forEach((line, row) => {
    // At the top of the square, not the top of the frame (his ask, 2026-11-11:
    // "the headline is too high up").
    const y = squareOf(width, height).y + 8 * u + (row - (lines.length - 1) / 2) * size * 1.15
    let x = width / 2 - textWidth(ctx, line.join(' '), size, 800) / 2
    for (const word of line) {
      // Word by word, quickly, rising into place.
      const p = clamp01((t - 0.05 - k * 0.07) / 0.3)
      const ww = textWidth(ctx, word, size, 800)
      if (p > 0) {
        ctx.save()
        ctx.globalAlpha = clamp01(p * 1.6) * out
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
        ctx.shadowBlur = size * 0.25
        ctx.shadowOffsetY = size * 0.05
        text(ctx, word, x, y + (1 - easeOut(p)) * 2 * u, size, '#ffffff', 800)
        ctx.restore()
      }
      x += ww + space
      k++
    }
  })
}

function tick(ctx: Ctx, cx: number, cy: number, size: number): void {
  ctx.fillStyle = GLASS_COLOURS.green
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.25)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = size * 0.14
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.24, cy + size * 0.02)
  ctx.lineTo(cx - size * 0.06, cy + size * 0.2)
  ctx.lineTo(cx + size * 0.26, cy - size * 0.2)
  ctx.stroke()
}

function drawCaptions(ctx: Ctx, kinetic: Kinetic, width: number, height: number, t: number): void {
  const up = phraseAt(kinetic, t)
  if (!up) return
  const [first, end] = up.phrase
  const u = (width / 100) * (kinetic.scale ?? 1)
  const words: { i: number; text: string }[] = []
  for (let i = first; i < end; i++) {
    const value = barText(kinetic.words[i]?.text ?? '')
    if (value) words.push({ i, text: value })
  }
  if (words.length === 0) return
  const pill = words.some((w) => kinetic.styleOf(w.i) === 'pill')
  let px = (pill ? 4.8 : 4.5) * u
  const space = () => textWidth(ctx, ' ', px, pill ? 800 : 700)
  const full = () => words.reduce((sum, w) => sum + textWidth(ctx, w.text, px, pill ? 800 : 700), 0) + space() * (words.length - 1)
  const room = width * 0.82 - (pill ? 8 * u : 0)
  if (full() > room) px *= room / full()
  const lineW = full()
  const cy = height * (kinetic.centerY ?? CAPTION_CENTER.usual)
  const padX = 3 * u
  const barW = lineW + 2 * padX + (pill ? 6 * u : 0)
  const barH = px * 2
  const x0 = width / 2 - barW / 2
  ctx.save()
  ctx.globalAlpha = up.fade
  if (pill) {
    // A key phrase: a white pill that pops, a green tick at its end.
    const p = easeBack(clamp01(up.since / 0.3))
    ctx.translate(width / 2, cy)
    ctx.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p)
    ctx.translate(-width / 2, -cy)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
    ctx.shadowBlur = 2.4 * u
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, x0, cy - barH / 2, barW, barH, barH / 2)
    ctx.fill()
    ctx.shadowColor = 'transparent'
  } else {
    ctx.fillStyle = GLASS_COLOURS.bar
    roundRect(ctx, x0, cy - barH / 2, barW, barH, 1.4 * u)
    ctx.fill()
    ctx.strokeStyle = 'rgba(140, 160, 255, 0.35)'
    ctx.lineWidth = Math.max(1, 0.2 * u)
    ctx.stroke()
  }
  let x = x0 + padX
  for (const w of words) {
    const ww = textWidth(ctx, w.text, px, pill ? 800 : 700)
    const p = clamp01((t - (kinetic.timing.start(w.i) - LEAD)) / 0.12)
    if (p > 0) {
      ctx.save()
      ctx.globalAlpha *= p
      const accent = kinetic.styleOf(w.i) === 'accent'
      text(ctx, w.text, x, cy + 0.1 * u, px, pill ? GLASS_COLOURS.ink : accent ? GLASS_COLOURS.orangeLight : '#ffffff', pill || accent ? 800 : 700)
      ctx.restore()
    }
    x += ww + space()
  }
  if (pill) {
    const last = kinetic.timing.end(words[words.length - 1].i)
    const tp = easeBack(clamp01((t - last + 0.1) / 0.3))
    if (tp > 0) {
      ctx.save()
      const cx = x0 + barW - padX - 2.4 * u
      ctx.translate(cx, cy)
      ctx.scale(tp, tp)
      tick(ctx, 0, 0, 4.4 * u)
      ctx.restore()
    }
  }
  ctx.restore()
}

function drawCallToAction(ctx: Ctx, frame: Frame, end: NonNullable<Storyboard['end']>, width: number, height: number, t: number, slot: Slot | undefined): void {
  if (!slot || !(t >= slot.start)) return
  const at = slot.start + LEAD
  const u = width / 100
  const p = clamp01((t - at + LEAD) / 0.45)
  const value = end.text || DEFAULT_CTA
  const px = 6 * u
  const badge = 10 * u
  const w = Math.min(90 * u, badge + 3 * u + textWidth(ctx, value, px, 800) + 8 * u)
  const h = 15 * u
  const x = width / 2 - w / 2
  // Over his head, at the top of the square, or in the middle as it always
  // was - a place of its own per video (his ask, 2026-11-12).
  const y = end.place === 'top' ? squareOf(width, height).y + 6 * u : height * 0.53 - h / 2
  ctx.save()
  ctx.globalAlpha = clamp01(p * 2)
  ctx.translate(width / 2, y + h / 2 + (1 - easeOut(p)) * 6 * u)
  const s = 0.9 + 0.1 * easeBack(p)
  ctx.scale(s, s)
  ctx.translate(-width / 2, -(y + h / 2))
  glassPanel(ctx, frame, width, height, x, y, w, h, h / 2, u)
  // A ring that pulses out every so often, to catch the eye.
  const ring = ((t - at) % 1.6) / 1.6
  if (t - at > 0.5) {
    ctx.save()
    ctx.globalAlpha *= (1 - ring) * 0.6
    ctx.strokeStyle = GLASS_COLOURS.orange
    ctx.lineWidth = 0.6 * u
    roundRect(ctx, x - ring * 3 * u, y - ring * 3 * u, w + ring * 6 * u, h + ring * 6 * u, h / 2 + ring * 3 * u)
    ctx.stroke()
    ctx.restore()
  }
  drawIconBadge(ctx, end.icon ?? 'chat', x + 3 * u + badge / 2, y + h / 2, badge, GLASS_COLOURS.orange, t - at)
  text(ctx, value, x + 3 * u + badge + 2.6 * u, y + h / 2 + 0.2 * u, px, GLASS_COLOURS.ink, 800, 'left', w - badge - 9 * u)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// The whole frame

/** Whether a card behind him is up at `t` - only then is he cut out of the
 *  frame (render.ts runs the cut-out tool for those frames alone). */
export function behindAt(_board: Storyboard, _time: Timing, _t: number): boolean {
  // No card goes behind him any more - every one is above his face (his
  // strict rule, 2026-11-11) - so he is never cut out.
  return false
}

/** Everything of the glass look at `t`. `cutout`: his mask for this frame
 *  (white where he is), so a card behind him has him drawn back over it;
 *  without it such a card is simply drawn over him. */
export function drawGlassLook(ctx: Ctx, width: number, height: number, board: Storyboard, time: Timing, t: number, kinetic?: Kinetic, cutout?: CanvasImageSource | null, plan: Timing = time): void {
  const frame = grabFrame(ctx, width, height)
  // One graphic at a time, from the plan's own timing (glassSlots).
  const slots = glassSlots(board, plan)
  const stage = stageAt(board, time, t, plan)
  if (stage) drawStage(ctx, frame, stage.part, stage.up, width, height, t, time)
  const full = stage !== null && stage.up > 0.5
  if (!full) {
    const cards = board.scenes.flatMap((scene) => scene.parts.filter(isCard))
    const behind = cards.filter((p) => p.place === 'behind' && cardLife(slots.get(p), t) && placeCard(ctx, p, width, height, cutout).behind)
    for (const part of behind) drawCard(ctx, frame, part, width, height, t, time, cutout, slots.get(part))
    if (behind.length > 0 && cutout && frame.copy) {
      // Him, cut out of the frame, back over the card.
      const him = scratch('him', width, height)
      if (him) {
        him.ctx.globalCompositeOperation = 'copy'
        him.ctx.drawImage(frame.copy, 0, 0)
        him.ctx.globalCompositeOperation = 'destination-in'
        him.ctx.imageSmoothingEnabled = true
        him.ctx.drawImage(cutout, 0, 0, width, height)
        him.ctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(him.canvas, 0, 0)
      }
    }
    for (const part of cards) if (!behind.includes(part)) drawCard(ctx, frame, part, width, height, t, time, cutout, slots.get(part))
    if (board.title) drawTitle(ctx, board.title, slots.get(board.title), width, height, t)
    if (kinetic) drawCaptions(ctx, kinetic, width, height, t)
  }
  if (board.end) drawCallToAction(ctx, frame, board.end, width, height, t, slots.get(board.end))
}
