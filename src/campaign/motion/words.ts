// The "words" look of motion graphics (Format #2, his example 2026-11-08): his
// face stays full screen under a dark cinematic edge, and what he says builds
// up word by word in a block under his face - small words, one key word big
// (white) or huge in gold capitals, a little fancy italic word before a big
// one ("the Three"). Plus numbered diamonds for a list, a diamond with an
// UPPERCASE label for each point, a white flash with his words in black, a
// dimmed moment with a word over it, and big gold words at the end
// ("DM 'EDIT'").
//
// The block is the caption: in this look the usual captions are not drawn.
// Drawn by drawMotion (draw.ts) on every frame and every still.

import type { EmphasisStyle, Part, Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import { HEADLINE_FAMILY } from '../headlineFont'
import type { Timing } from './draw'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** His words for the block: what shows, when each is said (`timing`, on the
 *  finished video), which phrase each is in, and which stand out. */
export interface Kinetic {
  words: readonly { text: string }[]
  timing: Timing
  /** [first, end) of each block, in order. */
  phrases: readonly (readonly [number, number])[]
  styleOf: (i: number) => EmphasisStyle | null
}

const SANS = HEADLINE_FAMILY
const SERIF = '"Playfair Display", "Didot", "Bodoni 72", Georgia, "Times New Roman", serif'
export const WORDS_COLOURS = {
  gold: '#f6c445',
  goldDeep: '#e2a514',
  cyan: '#19c3d4',
  cyanLight: '#7ee8f2',
  white: '#ffffff',
} as const

const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : Number.isFinite(n) ? n : 0)
const easeOut = (p: number) => 1 - (1 - p) ** 3
/** Words come up this much before they are heard, like the captions. */
const LEAD = 0.05
const POP_SEC = 0.14
/** A block stays a moment after its last word when nothing follows soon. */
const HOLD_SEC = 0.5
const OUT_SEC = 0.12
/** Most words in one block. */
const BLOCK_WORDS = 6
/** A pause this long ends a block. */
const BLOCK_PAUSE = 0.45

/** His words split into blocks: at most BLOCK_WORDS, ending at a sentence or
 *  comma, or a pause. Worked out once from when each word is said (on the
 *  recording - the order and the pauses are the same in the cut). */
export function kineticPhrases(words: readonly { text: string; start: number; end: number }[]): [number, number][] {
  const phrases: [number, number][] = []
  let first = 0
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1]
    const ends =
      !next ||
      i - first + 1 >= BLOCK_WORDS ||
      /[.!?,;:…]["'”)]*$/.test(words[i].text.trim()) ||
      next.start - words[i].end > BLOCK_PAUSE
    if (ends) {
      phrases.push([first, i + 1])
      first = i + 1
    }
  }
  return phrases
}

/** A word as it shows in the block: no trailing punctuation (an ellipsis
 *  stays), gold words in capitals. */
export function blockText(text: string, style: EmphasisStyle | null): string {
  const trimmed = text.trim().replace(/^["'“(]+/, '').replace(/["'”)]+$/, '')
  // An ellipsis is part of the word ("Bruh...."); other marks at the end are not.
  const bare = /\.{2,}$|…$/.test(trimmed) ? trimmed : trimmed.replace(/[.,!?;:]+$/, '')
  return style === 'gold' ? bare.toUpperCase() : bare
}

interface Placed {
  index: number
  text: string
  style: EmphasisStyle | null
  x: number
  /** Baseline. */
  y: number
  px: number
  font: string
}

function fontFor(style: EmphasisStyle | null, px: number): string {
  if (style === 'serif') return `italic 500 ${Math.round(px)}px ${SERIF}`
  if (style === 'big' || style === 'gold') return `800 ${Math.round(px)}px ${SANS}`
  return `700 ${Math.round(px)}px ${SANS}`
}

/** Where every word of block `[first, end)` sits: small words in lines of a
 *  few, each big or gold word on its own line (a serif word just before it
 *  joins its line), all centred under his face. Laid out once for the whole
 *  block, so nothing moves as the words come in. */
export function layoutBlock(ctx: Ctx, kinetic: Kinetic, [first, end]: readonly [number, number], width: number, height: number): Placed[] {
  const u = width / 100
  const small = 4.8 * u
  const sizeOf = (style: EmphasisStyle | null) => (style === 'big' ? 12.5 * u : style === 'gold' ? 13 * u : style === 'serif' ? 7.2 * u : small)
  const maxW = width * 0.84
  type Item = { index: number; text: string; style: EmphasisStyle | null; px: number; w: number }
  const lines: Item[][] = []
  let line: Item[] = []
  const measure = (item: Omit<Item, 'w'>): Item => {
    ctx.font = fontFor(item.style, item.px)
    return { ...item, w: ctx.measureText(item.text).width }
  }
  for (let i = first; i < end; i++) {
    const style = kinetic.styleOf(i)
    const text = blockText(kinetic.words[i]?.text ?? '', style)
    if (!text) continue
    let item = measure({ index: i, text, style, px: sizeOf(style) })
    // A big word wider than the frame is set smaller, never cut.
    if (item.w > maxW) item = measure({ ...item, px: (item.px * maxW) / item.w })
    const loud = style === 'big' || style === 'gold'
    const nextLoud = i + 1 < end && ['big', 'gold'].includes(kinetic.styleOf(i + 1) ?? '')
    if (loud) {
      // Its own line - with the serif word before it, if there is one.
      const lead = line.length > 0 && line[line.length - 1].style === 'serif' ? line.pop()! : null
      if (line.length > 0) lines.push(line)
      lines.push(lead ? [lead, item] : [item])
      line = []
      continue
    }
    if (style === 'serif' && nextLoud) {
      if (line.length > 0) lines.push(line)
      line = [item]
      continue
    }
    const width = line.reduce((sum, w) => sum + w.w + small * 0.3, 0) + item.w
    if (line.length >= 3 || width > maxW) {
      lines.push(line)
      line = []
    }
    line.push(item)
  }
  if (line.length > 0) lines.push(line)
  // Stacked tight, like the example: big lines overlap the small ones a little.
  const heights = lines.map((l) => Math.max(...l.map((w) => w.px)) * (l.some((w) => w.style === 'big' || w.style === 'gold') ? 0.92 : 1.08))
  const total = heights.reduce((a, b) => a + b, 0)
  let y = height * 0.62 - total / 2
  const placed: Placed[] = []
  lines.forEach((l, k) => {
    y += heights[k]
    const gap = small * 0.3
    const lineW = l.reduce((sum, w) => sum + w.w, 0) + gap * (l.length - 1)
    let x = width / 2 - lineW / 2
    for (const w of l) {
      placed.push({ index: w.index, text: w.text, style: w.style, x, y: y - heights[k] * 0.12, px: w.px, font: fontFor(w.style, w.px) })
      x += w.w + gap
    }
  })
  return placed
}

const layouts = new WeakMap<Kinetic, Map<string, Placed[]>>()

function cachedLayout(ctx: Ctx, kinetic: Kinetic, phrase: readonly [number, number], width: number, height: number): Placed[] {
  let byPhrase = layouts.get(kinetic)
  if (!byPhrase) layouts.set(kinetic, (byPhrase = new Map()))
  const key = `${phrase[0]}:${width}x${height}`
  let placed = byPhrase.get(key)
  if (!placed) byPhrase.set(key, (placed = layoutBlock(ctx, kinetic, phrase, width, height)))
  return placed
}

/** The block up at `t`, if any: the newest one started, until the next starts
 *  or a moment after its last word. */
export function blockAt(kinetic: Kinetic, t: number): { phrase: readonly [number, number]; fade: number } | null {
  let found: number = -1
  for (let k = 0; k < kinetic.phrases.length; k++) {
    if (kinetic.timing.start(kinetic.phrases[k][0]) - LEAD <= t) found = k
    else break
  }
  if (found < 0) return null
  const phrase = kinetic.phrases[found]
  const next = kinetic.phrases[found + 1]
  const until = Math.min(kinetic.timing.end(phrase[1] - 1) + HOLD_SEC, next ? kinetic.timing.start(next[0]) - LEAD : Infinity)
  if (t >= until) return null
  return { phrase, fade: clamp01((until - t) / OUT_SEC) }
}

function shadowText(ctx: Ctx, paint: () => void, px: number): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = px * 0.18
  ctx.shadowOffsetY = px * 0.04
  paint()
  ctx.restore()
}

function drawBlock(ctx: Ctx, kinetic: Kinetic, width: number, height: number, t: number): void {
  const up = blockAt(kinetic, t)
  if (!up) return
  for (const w of cachedLayout(ctx, kinetic, up.phrase, width, height)) {
    const p = clamp01((t - (kinetic.timing.start(w.index) - LEAD)) / POP_SEC)
    if (p <= 0) continue
    ctx.save()
    ctx.globalAlpha = up.fade * clamp01(p * 1.5)
    ctx.font = w.font
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    // Comes in a touch big and settles - the loud words a little more.
    const s = 1 + (1 - easeOut(p)) * (w.style === 'big' || w.style === 'gold' ? 0.25 : 0.12)
    const cx = w.x + ctx.measureText(w.text).width / 2
    ctx.translate(cx, w.y)
    ctx.scale(s, s)
    ctx.translate(-cx, -w.y)
    shadowText(ctx, () => {
      if (w.style === 'gold') {
        const grad = ctx.createLinearGradient(0, w.y - w.px * 0.8, 0, w.y)
        grad.addColorStop(0, WORDS_COLOURS.gold)
        grad.addColorStop(1, WORDS_COLOURS.goldDeep)
        ctx.fillStyle = grad
      } else ctx.fillStyle = WORDS_COLOURS.white
      ctx.fillText(w.text, w.x, w.y)
    }, w.px)
    ctx.restore()
  }
}

/** The word being said at `t` (for the white flash), or -1. */
function wordAt(kinetic: Kinetic, t: number): number {
  let found = -1
  for (let i = 0; i < kinetic.words.length; i++) {
    if (kinetic.timing.start(i) - LEAD <= t) found = i
    else break
  }
  return found
}

function diamond(ctx: Ctx, cx: number, cy: number, size: number, label: string, alpha: number, lit: boolean): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(cx, cy)
  ctx.save()
  ctx.rotate(Math.PI / 4)
  const half = size / 2
  const grad = ctx.createLinearGradient(-half, -half, half, half)
  grad.addColorStop(0, lit ? WORDS_COLOURS.cyanLight : 'rgba(25, 195, 212, 0.35)')
  grad.addColorStop(1, lit ? WORDS_COLOURS.cyan : 'rgba(25, 195, 212, 0.2)')
  ctx.fillStyle = grad
  ctx.shadowColor = lit ? 'rgba(25, 195, 212, 0.6)' : 'transparent'
  ctx.shadowBlur = size * 0.4
  ctx.beginPath()
  const r = size * 0.12
  ctx.moveTo(-half + r, -half)
  ctx.arcTo(half, -half, half, half, r)
  ctx.arcTo(half, half, -half, half, r)
  ctx.arcTo(-half, half, -half, -half, r)
  ctx.arcTo(-half, -half, half, -half, r)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.lineWidth = size * 0.05
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 ${Math.round(size * 0.5)}px ${SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 0, size * 0.03)
  ctx.restore()
}

function pop(t: number, at: number): number {
  return clamp01((t - (at - LEAD)) / 0.25)
}

function drawPartWords(ctx: Ctx, part: Part, width: number, height: number, t: number, time: Timing, fade: number): void {
  const u = width / 100
  switch (part.kind) {
    case 'diamonds': {
      const size = 11 * u
      const gap = 5 * u
      const n = part.items.length
      const rowW = n * size + (n - 1) * gap
      const y = height * 0.76
      const shown = pop(t, time.start(part.at))
      part.items.forEach((item, i) => {
        const lit = pop(t, time.start(item.at))
        const x = width / 2 - rowW / 2 + size / 2 + i * (size + gap)
        ctx.save()
        const s = 0.8 + 0.2 * easeOut(Math.max(lit, shown * 0.6))
        ctx.translate(x, y)
        ctx.scale(s, s)
        ctx.translate(-x, -y)
        diamond(ctx, x, y, size, String(i + 1), fade * Math.max(shown * 0.45, lit), lit > 0)
        ctx.restore()
      })
      return
    }
    case 'point': {
      const p = pop(t, time.start(part.at))
      if (p <= 0) return
      const size = 7 * u
      const x = 9 * u
      const y = height * 0.56
      ctx.save()
      ctx.globalAlpha = fade * clamp01(p * 1.5)
      ctx.translate((1 - easeOut(p)) * -4 * u, 0)
      diamond(ctx, x, y, size, String(part.number), 1, true)
      ctx.font = `300 ${Math.round(3.6 * u)}px ${SANS}`
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      shadowText(ctx, () => ctx.fillText(part.text, x + size * 0.95, y + 0.2 * u, width - x - size - 6 * u), 3.6 * u)
      ctx.restore()
      return
    }
    default:
      return
  }
}

/** A white flash or a dimmed moment up at `t`. */
function momentAt(board: Storyboard, time: Timing, t: number): Extract<Part, { kind: 'flash' | 'dim' }> | null {
  for (const scene of board.scenes) {
    for (const part of scene.parts) {
      if (part.kind !== 'flash' && part.kind !== 'dim') continue
      if (t >= time.start(part.at) - LEAD && t < time.end(part.to) + 0.1) return part
    }
  }
  return null
}

function vignette(ctx: Ctx, width: number, height: number, grade: Storyboard['grade']): void {
  ctx.save()
  if (grade === 'warm' || grade === 'teal') {
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = grade === 'warm' ? 'rgba(255, 140, 50, 0.32)' : 'rgba(0, 160, 175, 0.32)'
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }
  const edge = ctx.createRadialGradient(width / 2, height * 0.42, height * 0.2, width / 2, height * 0.5, height * 0.72)
  edge.addColorStop(0, 'rgba(0, 0, 0, 0)')
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.62)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, width, height)
  // Darker at the bottom, so the words under his face read.
  const low = ctx.createLinearGradient(0, height * 0.55, 0, height)
  low.addColorStop(0, 'rgba(0, 0, 0, 0)')
  low.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
  ctx.fillStyle = low
  ctx.fillRect(0, height * 0.55, width, height * 0.45)
  ctx.restore()
}

/** Everything of the words look at `t`, over his face. */
export function drawWordsLook(ctx: Ctx, width: number, height: number, board: Storyboard, time: Timing, t: number, kinetic?: Kinetic): void {
  const u = width / 100
  vignette(ctx, width, height, board.grade)
  const moment = momentAt(board, time, t)
  if (moment?.kind === 'flash') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    const i = kinetic ? wordAt(kinetic, t) : -1
    if (kinetic && i >= 0) {
      ctx.font = `700 ${Math.round(6 * u)}px ${SANS}`
      ctx.fillStyle = '#111111'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(blockText(kinetic.words[i].text, null), width / 2, height * 0.5, width * 0.9)
    }
    return
  }
  if (moment?.kind === 'dim') {
    const p = pop(t, time.start(moment.at))
    ctx.fillStyle = `rgba(0, 0, 0, ${0.55 * p})`
    ctx.fillRect(0, 0, width, height)
    ctx.save()
    ctx.globalAlpha = p
    ctx.font = `500 ${Math.round(9 * u)}px ${SANS}`
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    shadowText(ctx, () => ctx.fillText(moment.text, width / 2, height * 0.6, width * 0.9), 9 * u)
    ctx.restore()
    return
  }
  // The points and diamonds of the scene up now.
  for (const scene of board.scenes) {
    const start = time.start(scene.from) - LEAD
    const end = time.end(scene.to) + 0.35
    if (t < start || t >= end) continue
    const fade = clamp01((end - t) / 0.2)
    for (const part of scene.parts) drawPartWords(ctx, part, width, height, t, time, fade)
  }
  // The end: big gold words, for a couple of seconds, in place of the block.
  if (board.end) {
    const at = time.start(board.end.at)
    const p = pop(t, at)
    if (p > 0 && t < at + 2.4) {
      const fade = clamp01((at + 2.4 - t) / 0.2)
      ctx.save()
      ctx.globalAlpha = p * fade
      const px = 11 * u
      ctx.font = `900 ${Math.round(px)}px ${SANS}`
      const text = board.end.text.toUpperCase()
      const scale = Math.min(1, (width * 0.86) / Math.max(1, ctx.measureText(text).width))
      ctx.font = `900 ${Math.round(px * scale)}px ${SANS}`
      const grad = ctx.createLinearGradient(0, height * 0.6 - px, 0, height * 0.6)
      grad.addColorStop(0, WORDS_COLOURS.gold)
      grad.addColorStop(1, WORDS_COLOURS.goldDeep)
      ctx.fillStyle = grad
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      shadowText(ctx, () => ctx.fillText(text, width / 2, height * 0.62), px)
      ctx.restore()
      return
    }
  }
  if (kinetic) drawBlock(ctx, kinetic, width, height, t)
}
