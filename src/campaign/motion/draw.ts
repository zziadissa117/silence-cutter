// Motion graphics drawn on a frame: the board over the top of the video and
// the parts of the storyboard on it (supabase/functions/postiz/motion.ts),
// each coming up on the word it was planned for. The same function draws
// every frame of the render (render.ts) and the stills of the plan screen
// (MotionView), so what he approves is what is made.
//
// The look is his friend's reel he picked (2026-11-07): a light grey board on
// the top ~55% of the frame, his face moved down below it with a soft fade
// between, white cards with soft shadows, purple and green, small code-font
// labels, quick pop / slide / count-up moves. Everything is flat shapes and
// text: cheap enough for an iPhone at 1080x1920, nothing to load.

import { formatOf, type Card, type Part, type Scene, type Storyboard, type Tone } from '../../../supabase/functions/postiz/motion.ts'
import { HEADLINE_FAMILY } from '../headlineFont'
import { drawWordsLook, type Kinetic } from './words'
import type { CaptionPosition } from '../captions'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** When word `i` starts and ends on the finished video's timeline, in
 *  seconds; Infinity for one not reached yet. */
export interface Timing {
  start: (i: number) => number
  end: (i: number) => number
}

/** How far his face moves down while the board is up, as a share of the
 *  frame's height: the middle of a talking-head frame lands in the middle of
 *  the space under the board. */
export const FACE_DROP = 0.28
/** The board covers the frame down to here, fading out over the next bit.
 *  Was 0.55, his friend's; "the white screen part takes too much of the
 *  screen, make it take less" (2026-11-08) - more of his face. */
export const BOARD_BOTTOM = 0.44
const BOARD_FADE = 0.07
/** Under TikTok's top bar. */
const BOARD_TOP = 0.09
/** A scene comes up a touch before its first word and stays a moment after
 *  its last; two closer than GLUE_SEC keep the board up between them. */
const SCENE_LEAD = 0.2
const SCENE_HOLD = 0.35
const GLUE_SEC = 1.2
const SLIDE_SEC = 0.35
const APPEAR_SEC = 0.28
const COUNT_SEC = 0.9
/** Parts come up this much before their word, as the captions do. */
const PART_LEAD = 0.05

export const COLOURS = {
  board: '#f2f2f4',
  boardLow: '#e7e7ea',
  ink: '#16161b',
  grey: '#8b8b95',
  line: '#e3e3e8',
  card: '#ffffff',
  purple: '#5b50e8',
  green: '#1fb15a',
  red: '#e5484d',
  dark: '#1d1d24',
  lock: '#d9d9de',
} as const

const toneColour = (tone: Tone): string => COLOURS[tone]

const SANS = HEADLINE_FAMILY
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'

const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : Number.isFinite(n) ? n : 0)
const easeOut = (p: number) => 1 - (1 - p) ** 3
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
/** A little past 1 and back: the pop of something coming up. */
const easeBack = (p: number) => {
  const c = 1.4
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2
}

/** How far into coming up something is, 0 to 1, from its word's time. */
export function appear(t: number, at: number, seconds = APPEAR_SEC): number {
  return clamp01((t - (at - PART_LEAD)) / seconds)
}

/** Each scene's window on the finished video: from just before its first
 *  word to just after its last, never into the next. */
export function sceneWindows(board: Storyboard, time: Timing): { start: number; end: number }[] {
  const windows = board.scenes.map((s) => ({ start: time.start(s.from) - SCENE_LEAD, end: time.end(s.to) + SCENE_HOLD }))
  for (let i = 0; i + 1 < windows.length; i++) windows[i].end = Math.min(windows[i].end, windows[i + 1].start)
  return windows
}

/** How far the board is up at `t`: 0 his face full screen, 1 the board up
 *  and his face below it. Scenes close together keep it up between them. */
export function splitAt(board: Storyboard, time: Timing, t: number): number {
  // The words look never moves his face.
  if (formatOf(board) === 'words') return 0
  const merged: { start: number; end: number }[] = []
  for (const w of sceneWindows(board, time)) {
    if (!Number.isFinite(w.start)) break
    const last = merged[merged.length - 1]
    if (last && w.start - last.end < GLUE_SEC) last.end = Math.max(last.end, w.end)
    else merged.push({ ...w })
  }
  let up = 0
  for (const w of merged) {
    if (t < w.start || t > w.end) continue
    up = Math.max(up, Math.min(clamp01((t - w.start) / SLIDE_SEC), clamp01((w.end - t) / SLIDE_SEC)))
  }
  return easeInOut(up)
}

/** How far his face is moved down at `t`, in pixels of a frame `height` tall. */
export function faceDropAt(board: Storyboard, time: Timing, t: number, height: number): number {
  return Math.round(splitAt(board, time, t) * FACE_DROP * height)
}

// ---------------------------------------------------------------------------
// Drawing helpers

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function font(px: number, weight = 600, family = SANS): string {
  return `${weight} ${Math.max(1, Math.round(px))}px ${family}`
}

/** `text` set in the biggest size up to `px` (down to 60% of it) that fits
 *  `maxWidth`, cut short with "…" if even that is too long. */
function fitText(ctx: Ctx, text: string, maxWidth: number, px: number, weight = 600, family = SANS): { text: string; px: number } {
  let size = px
  ctx.font = font(size, weight, family)
  while (ctx.measureText(text).width > maxWidth && size > px * 0.6) {
    size *= 0.92
    ctx.font = font(size, weight, family)
  }
  if (ctx.measureText(text).width <= maxWidth) return { text, px: size }
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return { text: `${cut.trimEnd()}…`, px: size }
}

function drawText(ctx: Ctx, text: string, x: number, y: number, maxWidth: number, px: number, colour: string, opts: { weight?: number; family?: string; align?: CanvasTextAlign } = {}): void {
  const fitted = fitText(ctx, text, maxWidth, px, opts.weight ?? 600, opts.family ?? SANS)
  ctx.font = font(fitted.px, opts.weight ?? 600, opts.family ?? SANS)
  ctx.fillStyle = colour
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(fitted.text, x, y)
}

/** Draws `paint` faded and scaled about (cx, cy) as it comes up. */
function popIn(ctx: Ctx, p: number, cx: number, cy: number, paint: () => void, lift = 0): void {
  if (p <= 0) return
  ctx.save()
  ctx.globalAlpha *= clamp01(p * 1.6)
  const s = 0.9 + 0.1 * easeBack(p)
  ctx.translate(cx, cy + (1 - easeOut(p)) * lift)
  ctx.scale(s, s)
  ctx.translate(-cx, -cy)
  paint()
  ctx.restore()
}

function shadowed(ctx: Ctx, u: number, paint: () => void): void {
  ctx.save()
  ctx.shadowColor = 'rgba(20, 20, 40, 0.13)'
  ctx.shadowBlur = 3.2 * u
  ctx.shadowOffsetY = 0.8 * u
  paint()
  ctx.restore()
}

function check(ctx: Ctx, x: number, y: number, s: number, colour: string): void {
  ctx.save()
  ctx.strokeStyle = colour
  ctx.lineWidth = s * 0.18
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x - s * 0.38, y + s * 0.02)
  ctx.lineTo(x - s * 0.1, y + s * 0.3)
  ctx.lineTo(x + s * 0.4, y - s * 0.3)
  ctx.stroke()
  ctx.restore()
}

function cross(ctx: Ctx, x: number, y: number, s: number, colour: string): void {
  ctx.save()
  ctx.strokeStyle = colour
  ctx.lineWidth = s * 0.18
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - s * 0.3, y - s * 0.3)
  ctx.lineTo(x + s * 0.3, y + s * 0.3)
  ctx.moveTo(x + s * 0.3, y - s * 0.3)
  ctx.lineTo(x - s * 0.3, y + s * 0.3)
  ctx.stroke()
  ctx.restore()
}

function lock(ctx: Ctx, x: number, y: number, s: number, colour: string): void {
  ctx.save()
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = s * 0.12
  ctx.beginPath()
  ctx.arc(x, y - s * 0.12, s * 0.22, Math.PI, 0)
  ctx.stroke()
  roundRect(ctx, x - s * 0.32, y - s * 0.1, s * 0.64, s * 0.46, s * 0.08)
  ctx.fill()
  ctx.restore()
}

function camera(ctx: Ctx, x: number, y: number, s: number, colour: string): void {
  ctx.save()
  ctx.fillStyle = colour
  roundRect(ctx, x - s * 0.42, y - s * 0.26, s * 0.58, s * 0.52, s * 0.1)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + s * 0.2, y)
  ctx.lineTo(x + s * 0.44, y - s * 0.2)
  ctx.lineTo(x + s * 0.44, y + s * 0.2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function eye(ctx: Ctx, x: number, y: number, s: number, colour: string): void {
  ctx.save()
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = s * 0.12
  ctx.beginPath()
  ctx.ellipse(x, y, s * 0.45, s * 0.28, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, s * 0.12, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function pill(ctx: Ctx, text: string, x: number, y: number, px: number, fill: string, ink: string, family = MONO, weight = 700): number {
  ctx.font = font(px, weight, family)
  const w = ctx.measureText(text).width + px * 1.4
  const h = px * 1.7
  ctx.fillStyle = fill
  roundRect(ctx, x, y - h / 2, w, h, px * 0.4)
  ctx.fill()
  ctx.fillStyle = ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + px * 0.7, y + px * 0.05)
  return w
}

// ---------------------------------------------------------------------------
// Numbers counting up

/** `text` with its number shown at `p` (0 to 1) of the way up to it, in the
 *  same writing - "10 000 $" passes "7 500 $" on the way. Text without a
 *  number is given back as it is. */
export function countText(text: string, p: number): string {
  const match = /\d[\d\s  ,.']*\d|\d/.exec(text)
  if (!match || p >= 1) return text
  const written = match[0]
  const groups = written.split(/[\s  ,.']/)
  const separators = written.match(/[\s  ,.']/g) ?? []
  // Thousands written apart ("10 000", "1,500"), or a decimal ("4.5").
  const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3)
  const sep = thousands ? separators[0] : ''
  const decimals = !thousands && groups.length === 2 ? groups[1].length : 0
  const value = thousands ? Number(groups.join('')) : Number(written.replace(',', '.'))
  if (!Number.isFinite(value)) return text
  const now = value * easeOut(clamp01(p))
  let shown = decimals > 0 ? now.toFixed(decimals) : String(Math.round(now))
  if (decimals > 0 && separators[0] === ',') shown = shown.replace('.', ',')
  if (thousands) shown = shown.replace(/\B(?=(\d{3})+(?!\d))/g, sep ?? '')
  return text.slice(0, match.index) + shown + text.slice(match.index + written.length)
}

// ---------------------------------------------------------------------------
// Laying a scene out: each part's height, fixed for the scene, so nothing
// moves as the parts come up one by one.

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function cols(count: number): number {
  return count <= 5 ? count : count <= 10 ? 5 : count <= 20 ? 10 : 10
}

function partHeight(part: Part, u: number, innerW: number): number {
  switch (part.kind) {
    case 'title':
      return 8 * u
    case 'note':
      return 6 * u
    case 'number':
      return (part.label ? 5 : 0) * u + 13 * u
    case 'cards': {
      const lines = Math.max(1, ...part.cards.map((c) => c.lines.length))
      return Math.max(22 * u, 3 * u + 4.4 * u + 2.6 * u + lines * 5.6 * u + 2.4 * u)
    }
    case 'list':
      return part.items.length * 8.6 * u + (part.items.length - 1) * 1.6 * u
    case 'tiles': {
      const g = tileGeometry(part.count, u, innerW, Boolean(part.window))
      return g.gridH + (part.window ? (part.unit ? 21 : 15) * u : part.unit ? 7 * u : 0)
    }
    case 'phones': {
      const g = phoneGeometry(part.items.length, part.sign !== null, u, innerW)
      return g.rows * g.h + (g.rows - 1) * 2 * u + (part.prices.length > 0 ? 7.5 * u : 0)
    }
    case 'math':
      return 3.4 * u + part.lines.length * 6.4 * u + (part.result.text ? 11 * u : 0) + 3 * u
    default:
      // The words look's parts are never on the board.
      return 0
  }
}

function tileGeometry(count: number, u: number, innerW: number, framed: boolean): { cols: number; rows: number; size: number; gap: number; gridW: number; gridH: number } {
  const c = cols(count)
  const rows = Math.ceil(count / c)
  const gap = 1.5 * u
  const width = innerW - (framed ? 6 * u : 0)
  const size = Math.min(13 * u, (width - gap * (c - 1)) / c)
  return { cols: c, rows, size, gap, gridW: c * size + (c - 1) * gap, gridH: rows * size + (rows - 1) * gap }
}

function phoneGeometry(count: number, sign: boolean, u: number, innerW: number): { perRow: number; rows: number; w: number; h: number; gap: number } {
  const perRow = Math.min(5, count)
  const rows = Math.ceil(count / perRow)
  const gap = sign ? 16 * u : 2 * u
  const w = Math.min(sign ? 22 * u : 16 * u, (innerW - gap * (perRow - 1)) / perRow)
  return { perRow, rows, w, h: w * 1.6, gap }
}

const PART_GAP = 3.2
/** How much a small scene is grown to fill the board. */
const MAX_GROW = 1.35

/** Where each of a scene's parts sits, and how much the stack is grown or
 *  shrunk to fit the board. Boxes are in the stack's own units, centred on
 *  the frame: drawn scaled by `scale` about the frame's middle, they fill the
 *  board's width exactly whatever the scale. */
export function layoutScene(scene: Scene, width: number, height: number): { boxes: Box[]; scale: number; originY: number } {
  const u = width / 100
  const fullW = width - 12 * u
  const top = BOARD_TOP * height
  const room = (BOARD_BOTTOM - 0.02) * height - top
  const stack = (innerW: number) => {
    const heights = scene.parts.map((p) => partHeight(p, u, innerW))
    return { heights, total: heights.reduce((a, b) => a + b, 0) + PART_GAP * u * Math.max(0, heights.length - 1) }
  }
  // Grown to fill the board, up to a point; shrunk when it would overflow.
  // Laid out again at the width that, scaled, is the board's width - grids
  // and phones are as tall as they are wide.
  let scale = Math.min(MAX_GROW, room / Math.max(1, stack(fullW).total))
  let laid = stack(fullW / scale)
  scale = Math.min(MAX_GROW, room / Math.max(1, laid.total))
  laid = stack(fullW / scale)
  const innerW = fullW / scale
  const originY = top + Math.max(0, room - laid.total * scale) / 2
  let y = 0
  const boxes = laid.heights.map((h) => {
    const box = { x: width / 2 - innerW / 2, y, w: innerW, h }
    y += h + PART_GAP * u
    return box
  })
  return { boxes, scale, originY }
}

// ---------------------------------------------------------------------------
// The parts

function drawCard(ctx: Ctx, card: Card, box: Box, u: number, t: number, time: Timing): void {
  const p = appear(t, time.start(card.at))
  popIn(ctx, p, box.x + box.w / 2, box.y + box.h / 2, () => {
    shadowed(ctx, u, () => {
      ctx.fillStyle = COLOURS.card
      roundRect(ctx, box.x, box.y, box.w, box.h, 2.6 * u)
      ctx.fill()
    })
    const pad = 3 * u
    if (card.badge) {
      const fitted = fitText(ctx, card.badge, box.w - 2 * pad - 1.4 * u, 2.5 * u, 800, MONO)
      pill(ctx, fitted.text, box.x + pad, box.y + pad + 2.2 * u, fitted.px, toneColour(card.tone), '#fff')
    }
    card.lines.forEach((line, i) => {
      const lp = appear(t, time.start(line.at))
      if (lp <= 0) return
      const y = box.y + pad + 4.4 * u + 2.6 * u + i * 5.6 * u + 2.6 * u
      ctx.save()
      ctx.globalAlpha *= clamp01(lp * 1.5)
      const dx = (1 - easeOut(lp)) * 2 * u
      let x = box.x + pad + dx
      if (line.mark) {
        if (line.mark === 'check') check(ctx, x + 1.4 * u, y, 2.8 * u, COLOURS.green)
        else cross(ctx, x + 1.4 * u, y, 2.6 * u, COLOURS.red)
        x += 4 * u
      }
      drawText(ctx, line.text, x, y, box.x + box.w - pad - x, 3.4 * u, COLOURS.ink, { weight: 600 })
      ctx.restore()
    })
  }, 2 * u)
}

function drawCards(ctx: Ctx, part: Extract<Part, { kind: 'cards' }>, box: Box, u: number, t: number, time: Timing): void {
  const n = part.cards.length
  const gap = 3 * u
  const w = (box.w - gap * (n - 1)) / n
  part.cards.forEach((card, i) => drawCard(ctx, card, { x: box.x + i * (w + gap), y: box.y, w, h: box.h }, u, t, time))
}

function drawList(ctx: Ctx, part: Extract<Part, { kind: 'list' }>, box: Box, u: number, t: number, time: Timing): void {
  part.items.forEach((item, i) => {
    const y = box.y + i * 10.2 * u
    const p = appear(t, time.start(item.at))
    popIn(ctx, p, box.x + box.w / 2, y + 4.3 * u, () => {
      shadowed(ctx, u, () => {
        ctx.fillStyle = COLOURS.card
        roundRect(ctx, box.x, y, box.w, 8.6 * u, 2.2 * u)
        ctx.fill()
      })
      ctx.fillStyle = i % 2 === 0 ? COLOURS.purple : COLOURS.green
      ctx.beginPath()
      ctx.arc(box.x + 5 * u, y + 4.3 * u, 2.6 * u, 0, Math.PI * 2)
      ctx.fill()
      drawText(ctx, String(i + 1), box.x + 5 * u, y + 4.4 * u, 4 * u, 2.8 * u, '#fff', { weight: 800, align: 'center' })
      drawText(ctx, item.text, box.x + 9.6 * u, y + 4.4 * u, box.w - 12 * u, 3.6 * u, COLOURS.ink, { weight: 600 })
    }, 2 * u)
  })
}

function drawTiles(ctx: Ctx, part: Extract<Part, { kind: 'tiles' }>, box: Box, u: number, t: number, time: Timing): void {
  const framed = Boolean(part.window)
  const g = tileGeometry(part.count, u, box.w, framed)
  const p = appear(t, time.start(part.at))
  popIn(ctx, p, box.x + box.w / 2, box.y + box.h / 2, () => {
    let gridX = box.x + (box.w - g.gridW) / 2
    let gridY = box.y
    // Which step is on, and when it started: its tiles fill one after another.
    let step: (typeof part.steps)[number] | null = null
    for (const s of part.steps) if (time.start(s.at) - PART_LEAD <= t) step = s
    const before = step ? part.steps[part.steps.indexOf(step) - 1] : undefined
    const since = step ? t - (time.start(step.at) - PART_LEAD) : 0
    const filledNow = step
      ? Math.min(step.filled, (before?.filled ?? 0) + Math.floor(Math.max(0, since) / 0.05) + 1)
      : 0
    if (framed) {
      const frameH = box.h
      shadowed(ctx, u, () => {
        ctx.fillStyle = COLOURS.card
        roundRect(ctx, box.x, box.y, box.w, frameH, 2.4 * u)
        ctx.fill()
      })
      ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.arc(box.x + 3 * u + i * 2.2 * u, box.y + 3 * u, 0.7 * u, 0, Math.PI * 2)
        ctx.fill()
      })
      drawText(ctx, part.window, box.x + 3 * u, box.y + 7 * u, box.w * 0.6, 3.2 * u, COLOURS.ink, { weight: 700 })
      gridY = box.y + 11 * u
      gridX = box.x + (box.w - g.gridW) / 2
    }
    for (let i = 0; i < part.count; i++) {
      const x = gridX + (i % g.cols) * (g.size + g.gap)
      const y = gridY + Math.floor(i / g.cols) * (g.size + g.gap)
      const filled = i < filledNow
      ctx.fillStyle = filled && step ? toneColour(step.tone) : step?.locked ? '#ebebef' : COLOURS.card
      if (!framed && !filled && !step?.locked) {
        shadowed(ctx, u * 0.6, () => {
          roundRect(ctx, x, y, g.size, g.size, g.size * 0.18)
          ctx.fill()
        })
      } else {
        roundRect(ctx, x, y, g.size, g.size, g.size * 0.18)
        ctx.fill()
        if (framed && !filled && !step?.locked) {
          ctx.strokeStyle = COLOURS.line
          ctx.lineWidth = 0.25 * u
          ctx.stroke()
        }
      }
      if (filled) camera(ctx, x + g.size / 2, y + g.size / 2, g.size * 0.5, '#fff')
      else if (step?.locked) lock(ctx, x + g.size / 2, y + g.size / 2, g.size * 0.42, '#b9b9c2')
    }
    if (part.unit && (framed || step)) {
      const label = `${filledNow} ${part.unit}`
      const y = framed ? box.y + box.h - 4.4 * u : box.y + g.gridH + 3.8 * u
      pill(ctx, label, framed ? box.x + 3 * u : box.x + (box.w - g.gridW) / 2, y, 2.6 * u, step ? toneColour(step.tone) : COLOURS.green, '#fff')
    }
  }, 2 * u)
}

function drawPhones(ctx: Ctx, part: Extract<Part, { kind: 'phones' }>, box: Box, u: number, t: number, time: Timing): void {
  const g = phoneGeometry(part.items.length, part.sign !== null, u, box.w)
  part.items.forEach((item, i) => {
    const row = Math.floor(i / g.perRow)
    const inRow = Math.min(g.perRow, part.items.length - row * g.perRow)
    const rowW = inRow * g.w + (inRow - 1) * g.gap
    const x = box.x + (box.w - rowW) / 2 + (i % g.perRow) * (g.w + g.gap)
    const y = box.y + row * (g.h + 2 * u)
    const p = appear(t, time.start(item.at))
    popIn(ctx, p, x + g.w / 2, y + g.h / 2, () => {
      shadowed(ctx, u, () => {
        const grad = ctx.createLinearGradient(x, y, x, y + g.h)
        grad.addColorStop(0, item.lit ? '#1f6b43' : '#2b3047')
        grad.addColorStop(1, item.lit ? '#24985a' : '#3c2c4e')
        ctx.fillStyle = grad
        roundRect(ctx, x, y, g.w, g.h, g.w * 0.12)
        ctx.fill()
      })
      if (item.lit) {
        ctx.strokeStyle = COLOURS.green
        ctx.lineWidth = 0.6 * u
        roundRect(ctx, x, y, g.w, g.h, g.w * 0.12)
        ctx.stroke()
      }
      const px = Math.max(1.8 * u, g.w * 0.11)
      eye(ctx, x + px * 1.2, y + g.h - px * 1.3, px, '#fff')
      drawText(ctx, item.label, x + px * 2.1, y + g.h - px * 1.25, g.w - px * 2.6, px, '#fff', { weight: 700, family: MONO })
    }, 2 * u)
  })
  if (part.sign && part.items.length === 2) {
    const p = appear(t, time.start(part.items[1].at))
    const cx = box.x + box.w / 2
    const cy = box.y + g.h / 2
    popIn(ctx, p, cx, cy, () => {
      ctx.fillStyle = COLOURS.dark
      ctx.beginPath()
      ctx.arc(cx, cy, 4.2 * u, 0, Math.PI * 2)
      ctx.fill()
      drawText(ctx, part.sign!, cx, cy + 0.2 * u, 7 * u, part.sign === '=' ? 5 * u : 3.2 * u, '#fff', { weight: 800, align: 'center' })
    })
  }
  // The price under both: the newest one said.
  let price: { text: string; at: number } | null = null
  for (const pr of part.prices) if (time.start(pr.at) - PART_LEAD <= t) price = pr
  if (price) {
    const p = appear(t, time.start(price.at), 0.2)
    const rowW = 2 * g.w + g.gap
    const y = box.y + g.h + 4.6 * u
    for (let i = 0; i < 2; i++) {
      const cx = box.x + (box.w - rowW) / 2 + i * (g.w + g.gap) + g.w / 2
      popIn(ctx, p, cx, y, () => {
        ctx.font = font(3.2 * u, 800, MONO)
        const w = ctx.measureText(price!.text).width + 3.6 * u
        pill(ctx, price!.text, cx - w / 2, y, 3.2 * u, COLOURS.purple, '#fff')
      })
    }
  }
}

function drawMath(ctx: Ctx, part: Extract<Part, { kind: 'math' }>, box: Box, u: number, t: number, time: Timing): void {
  const p = appear(t, time.start(part.at))
  popIn(ctx, p, box.x + box.w / 2, box.y + box.h / 2, () => {
    shadowed(ctx, u, () => {
      ctx.fillStyle = COLOURS.card
      roundRect(ctx, box.x, box.y, box.w, box.h, 2.6 * u)
      ctx.fill()
    })
    part.lines.forEach((line, i) => {
      const lp = appear(t, time.start(line.at))
      if (lp <= 0) return
      ctx.save()
      ctx.globalAlpha *= clamp01(lp * 1.5)
      drawText(ctx, line.text, box.x + 4 * u + (1 - easeOut(lp)) * 2 * u, box.y + 3.4 * u + i * 6.4 * u + 3.2 * u, box.w - 8 * u, 3.8 * u, COLOURS.ink, { weight: 600 })
      ctx.restore()
    })
    if (part.result.text) {
      const at = time.start(part.result.at)
      const rp = appear(t, at)
      if (rp > 0) {
        ctx.save()
        ctx.globalAlpha *= clamp01(rp * 1.5)
        const y = box.y + 3.4 * u + part.lines.length * 6.4 * u + 5.6 * u
        drawText(ctx, countText(part.result.text, clamp01((t - at + PART_LEAD) / COUNT_SEC)), box.x + 4 * u, y, box.w - 8 * u, 7.4 * u, COLOURS.green, { weight: 800 })
        ctx.restore()
      }
    }
  }, 2 * u)
}

function drawPart(ctx: Ctx, part: Part, box: Box, u: number, t: number, time: Timing): void {
  switch (part.kind) {
    case 'title': {
      const p = appear(t, time.start(part.at))
      popIn(ctx, p, box.x + box.w / 2, box.y + box.h / 2, () =>
        drawText(ctx, part.text, box.x + box.w / 2, box.y + box.h / 2, box.w, 5.4 * u, COLOURS.ink, { weight: 800, align: 'center' }),
      )
      return
    }
    case 'note': {
      const p = appear(t, time.start(part.at))
      popIn(ctx, p, box.x + box.w / 2, box.y + box.h / 2, () => {
        const fitted = fitText(ctx, part.text, box.w - 4 * u, 3 * u, 700, MONO)
        ctx.font = font(fitted.px, 700, MONO)
        const w = ctx.measureText(fitted.text).width + fitted.px * 1.4
        pill(ctx, fitted.text, box.x + (box.w - w) / 2, box.y + box.h / 2, fitted.px, COLOURS.dark, '#fff')
      })
      return
    }
    case 'number': {
      const at = time.start(part.at)
      const p = appear(t, at)
      popIn(ctx, p, box.x + box.w / 2, box.y + box.h / 2, () => {
        if (part.label) drawText(ctx, part.label.toUpperCase(), box.x + box.w / 2, box.y + 2.4 * u, box.w, 2.6 * u, COLOURS.grey, { weight: 700, family: MONO, align: 'center' })
        drawText(ctx, countText(part.text, clamp01((t - at + PART_LEAD) / COUNT_SEC)), box.x + box.w / 2, box.y + (part.label ? 5 : 0) * u + 6.5 * u, box.w, 11 * u, COLOURS.green, { weight: 800, align: 'center' })
      })
      return
    }
    case 'cards':
      return drawCards(ctx, part, box, u, t, time)
    case 'list':
      return drawList(ctx, part, box, u, t, time)
    case 'tiles':
      return drawTiles(ctx, part, box, u, t, time)
    case 'phones':
      return drawPhones(ctx, part, box, u, t, time)
    case 'math':
      return drawMath(ctx, part, box, u, t, time)
  }
}

// ---------------------------------------------------------------------------
// The whole frame

function drawBoardBackground(ctx: Ctx, width: number, height: number, alpha: number): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  const bottom = BOARD_BOTTOM * height
  const grad = ctx.createLinearGradient(0, 0, 0, bottom)
  grad.addColorStop(0, COLOURS.board)
  grad.addColorStop(1, COLOURS.boardLow)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, bottom)
  // The soft edge into his face.
  const fade = ctx.createLinearGradient(0, bottom, 0, bottom + BOARD_FADE * height)
  fade.addColorStop(0, COLOURS.boardLow)
  fade.addColorStop(1, 'rgba(231, 231, 234, 0)')
  ctx.fillStyle = fade
  ctx.fillRect(0, bottom - 1, width, BOARD_FADE * height + 1)
  ctx.restore()
}

function drawHook(ctx: Ctx, hook: NonNullable<Storyboard['hook']>, width: number, height: number, t: number, time: Timing): void {
  const u = width / 100
  const at = time.start(hook.at)
  const until = time.end(hook.to) + SCENE_HOLD
  const p = Math.min(appear(t, at), clamp01((until - t) / 0.25))
  if (p <= 0) return
  ctx.font = font(6.2 * u, 800)
  const valueW = ctx.measureText(hook.text).width
  ctx.font = font(2.2 * u, 700, MONO)
  const labelW = ctx.measureText(hook.label.toUpperCase()).width
  const w = Math.max(valueW, labelW) + 6 * u
  const h = (hook.label ? 4 : 0) * u + 9 * u
  const x = (width - w) / 2
  const y = 0.075 * height
  popIn(ctx, p, width / 2, y + h / 2, () => {
    shadowed(ctx, u, () => {
      ctx.fillStyle = COLOURS.card
      roundRect(ctx, x, y, w, h, 2 * u)
      ctx.fill()
    })
    if (hook.label) drawText(ctx, hook.label.toUpperCase(), x + 3 * u, y + 3 * u, w - 6 * u, 2.2 * u, COLOURS.grey, { weight: 700, family: MONO })
    drawText(ctx, countText(hook.text, 0.7 + 0.3 * clamp01((t - at + PART_LEAD) / (COUNT_SEC * 1.2))), x + 3 * u, y + h - 4.6 * u, w - 6 * u, 6.2 * u, COLOURS.green, { weight: 800 })
  })
}

function drawEnd(ctx: Ctx, end: NonNullable<Storyboard['end']>, width: number, height: number, t: number, time: Timing): void {
  const u = width / 100
  const p = appear(t, time.start(end.at))
  if (p <= 0) return
  const fitted = fitText(ctx, end.text, width * 0.8, 3.4 * u, 700)
  ctx.font = font(fitted.px, 700)
  const w = ctx.measureText(fitted.text).width + 4 * u
  const y = 0.075 * height
  popIn(ctx, p, width / 2, y, () => {
    ctx.fillStyle = COLOURS.purple
    roundRect(ctx, (width - w) / 2, y - 3 * u, w, 6 * u, 1.4 * u)
    ctx.fill()
    drawText(ctx, fitted.text, width / 2, y + 0.1 * u, w, fitted.px, '#fff', { weight: 700, align: 'center' })
  })
}

/** Everything of the storyboard at `t` on the finished video: the board and
 *  the scene on it, the hook card, the end banner. His face is drawn first
 *  by the caller, moved down by faceDropAt. */
export function drawMotion(ctx: Ctx, width: number, height: number, board: Storyboard, time: Timing, t: number, kinetic?: Kinetic): void {
  if (formatOf(board) === 'words') {
    drawWordsLook(ctx, width, height, board, time, t, kinetic)
    return
  }
  const up = splitAt(board, time, t)
  drawBoardBackground(ctx, width, height, up)
  const u = width / 100
  const windows = sceneWindows(board, time)
  board.scenes.forEach((scene, i) => {
    const w = windows[i]
    if (t < w.start || t >= w.end) return
    const fade = Math.min(clamp01((w.end - t) / 0.22), up > 0 ? 1 : 0)
    if (fade <= 0) return
    const layout = layoutScene(scene, width, height)
    ctx.save()
    ctx.globalAlpha = fade * clamp01(up * 1.4)
    ctx.translate(0, layout.originY)
    ctx.translate(width / 2, 0)
    ctx.scale(layout.scale, layout.scale)
    ctx.translate(-width / 2, 0)
    scene.parts.forEach((part, k) => drawPart(ctx, part, layout.boxes[k], u, t, time))
    ctx.restore()
  })
  if (board.hook) drawHook(ctx, board.hook, width, height, t, time)
  if (board.end) drawEnd(ctx, board.end, width, height, t, time)
}

/** Where the captions sit at `t`: where he put them - except a caption set
 *  up on the board's part of the frame (Top, Middle) while the board is up,
 *  which drops under it with his face, so it never covers the graphics. */
export function captionPositionAt(board: Storyboard, time: Timing, t: number, position: CaptionPosition): CaptionPosition {
  if (position !== 'top' && position !== 'middle') return position
  return splitAt(board, time, t) > 0.5 ? 'usual' : position
}

/** Fills the strip his face leaves at the top as it moves down, so nothing
 *  of the frame before shows through while the board fades in. */
export function fillBehindFace(ctx: Ctx, width: number, drop: number): void {
  if (drop <= 0) return
  ctx.fillStyle = COLOURS.board
  ctx.fillRect(0, 0, width, drop + 2)
}
