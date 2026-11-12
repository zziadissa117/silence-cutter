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

import { formatOf, popScene, type Card, type Part, type Scene, type Storyboard, type Tone } from '../../../supabase/functions/postiz/motion.ts'
import { HEADLINE_FAMILY } from '../headlineFont'
import { drawGlassLook, type Kinetic } from './glass'
import { drawIconBadge } from './icons'
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
  // From its first part, not its first word: the board never comes up with
  // nothing on it (2026-11-12: it sat empty for seconds).
  const windows = board.scenes.map((s) => ({ start: time.start(firstPartAt(s)) - SCENE_LEAD, end: time.end(s.to) + SCENE_HOLD }))
  for (let i = 0; i + 1 < windows.length; i++) {
    // The board staying up for the next scene keeps this one's graphics on it
    // until then - never an empty board between two (2026-11-12).
    const glued = !popScene(board.scenes[i]) && !popScene(board.scenes[i + 1]) && windows[i + 1].start - windows[i].end < GLUE_SEC
    windows[i].end = glued ? windows[i + 1].start : Math.min(windows[i].end, windows[i + 1].start)
  }
  return windows
}

/** The word a scene's first part comes up on. */
function firstPartAt(scene: Scene): number {
  const ats = scene.parts.map((p) => p.at).filter((at) => Number.isFinite(at))
  return ats.length > 0 ? Math.max(scene.from, Math.min(...ats)) : scene.from
}

/** How far the board is up at `t`: 0 his face full screen, 1 the board up
 *  and his face below it. Scenes close together keep it up between them. */
export function splitAt(board: Storyboard, time: Timing, t: number): number {
  // The glass look never moves his face.
  if (formatOf(board) === 'glass') return 0
  const merged: { start: number; end: number }[] = []
  const windows = sceneWindows(board, time)
  for (const [i, w] of windows.entries()) {
    if (!Number.isFinite(w.start)) break
    // A pop card over his face leaves the board down.
    if (popScene(board.scenes[i])) continue
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
    case 'icons':
      // A big drawing on its disc, a word under it.
      return 24 * u
    case 'note':
      return 6 * u
    case 'number':
      return (part.label ? 5 : 0) * u + 13 * u
    case 'cards': {
      const lines = Math.max(1, ...part.cards.map((c) => c.lines.length))
      return Math.max(22 * u, 3 * u + 4.4 * u + 2.6 * u + lines * 5.6 * u + 2.4 * u)
    }
    case 'list':
      return part.items.length * LIST_ROW * u + (part.items.length - 1) * LIST_GAP * u
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
/** A list row and the gap between rows, in u: big enough to read at a glance. */
const LIST_ROW = 10.4
const LIST_GAP = 1.8
/** How much a small scene is grown to fill the board. */
const MAX_GROW = 1.35

/** Where each of a scene's parts sits, and how much the stack is grown or
 *  shrunk to fit the board. Boxes are in the stack's own units, centred on
 *  the frame: drawn scaled by `scale` about the frame's middle, they fill the
 *  board's width exactly whatever the scale. */
export function layoutScene(scene: Scene, width: number, height: number): { boxes: Box[]; scale: number; originY: number; top: number; room: number } {
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
  return { boxes, scale, originY, top, room }
}

/** Where the parts up at `t` sit: at the scene's full size (nothing changes
 *  size as parts arrive) but stacked and centred on the board as they are -
 *  each new one slides the others up to make room (2026-11-12: a title alone
 *  sat at the top of an empty board until the rest came). */
function liveLayout(scene: Scene, width: number, height: number, t: number, time: Timing): { boxes: (Box | null)[]; originY: number; scale: number } {
  const full = layoutScene(scene, width, height)
  const u = width / 100
  const shownAt = scene.parts.map((p) => time.start(p.at) - PART_LEAD)
  const stack = (shown: boolean[]) => {
    let y = 0
    const boxes = full.boxes.map((b, k) => {
      if (!shown[k]) return null
      const box = { ...b, y }
      y += b.h + PART_GAP * u
      return box
    })
    const total = Math.max(0, y - PART_GAP * u)
    return { boxes, originY: full.top + Math.max(0, full.room - total * full.scale) / 2 }
  }
  const now = shownAt.map((at) => t >= at)
  if (!now.some(Boolean)) now[0] = true
  // The newest part to come up, and the stack before it, to slide between.
  let newest = -1
  for (let k = 0; k < shownAt.length; k++) if (now[k] && (newest < 0 || shownAt[k] > shownAt[newest])) newest = k
  const after = stack(now)
  const before = now.map((v, k) => v && k !== newest)
  const mix = before.some(Boolean) ? easeInOut(clamp01((t - shownAt[newest]) / 0.35)) : 1
  if (mix >= 1) return { ...after, scale: full.scale }
  const was = stack(before)
  const lerp = (a: number, b: number) => a + (b - a) * mix
  return {
    boxes: after.boxes.map((b, k) => (b && was.boxes[k] ? { ...b, y: lerp(was.boxes[k]!.y + (was.originY - after.originY) / full.scale, b.y) } : b)),
    originY: after.originY,
    scale: full.scale,
  }
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
    // Its drawing in the top corner; the badge keeps clear of it.
    const iconRoom = card.icon ? 7.5 * u : 0
    if (card.icon) drawIconBadge(ctx, card.icon, box.x + box.w - pad - 3.2 * u, box.y + pad + 2.6 * u, 6.4 * u, toneColour(card.tone), t - time.start(card.at))
    if (card.badge) {
      const fitted = fitText(ctx, card.badge, box.w - 2 * pad - 1.4 * u - iconRoom, 2.5 * u, 800, MONO)
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
    const y = box.y + i * (LIST_ROW + LIST_GAP) * u
    const mid = y + (LIST_ROW / 2) * u
    const p = appear(t, time.start(item.at))
    popIn(ctx, p, box.x + box.w / 2, mid, () => {
      shadowed(ctx, u, () => {
        ctx.fillStyle = COLOURS.card
        roundRect(ctx, box.x, y, box.w, LIST_ROW * u, 2.6 * u)
        ctx.fill()
      })
      const tone = i % 2 === 0 ? COLOURS.purple : COLOURS.green
      if (item.icon) drawIconBadge(ctx, item.icon, box.x + 6 * u, mid, 7.4 * u, tone, t - time.start(item.at))
      else {
        ctx.fillStyle = tone
        ctx.beginPath()
        ctx.arc(box.x + 6 * u, mid, 3.2 * u, 0, Math.PI * 2)
        ctx.fill()
        drawText(ctx, String(i + 1), box.x + 6 * u, mid + 0.1 * u, 5 * u, 3.4 * u, '#fff', { weight: 800, align: 'center' })
      }
      drawText(ctx, item.text, box.x + 11.6 * u, mid + 0.1 * u, box.w - 14 * u, 4.4 * u, COLOURS.ink, { weight: 700 })
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
      drawText(ctx, line.text, box.x + 4 * u + (1 - easeOut(lp)) * 2 * u, box.y + 3.4 * u + i * 6.4 * u + 3.2 * u, box.w - 8 * u, 4.4 * u, COLOURS.ink, { weight: 700 })
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
        confetti(ctx, box.x + box.w * 0.3, y, u, t - at - COUNT_SEC, part.result.at)
      }
    }
  }, 2 * u)
}

/** How long a burst of confetti lasts. */
const CONFETTI_SEC = 1.5
const CONFETTI_COLOURS = [COLOURS.purple, COLOURS.green, '#ffc83d', COLOURS.red, '#3aa0ff']

/** A burst of confetti from (cx, cy) as a number lands - `life` seconds
 *  after it finished counting; nothing before or once it has fallen. The
 *  same pieces every frame and every time (`seed`). */
export function confetti(ctx: Ctx, cx: number, cy: number, u: number, life: number, seed: number): void {
  if (!(life > 0) || life > CONFETTI_SEC) return
  let state = (seed * 2654435761 + 7) >>> 0
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  ctx.save()
  for (let i = 0; i < 34; i++) {
    const angle = -Math.PI / 2 + (rand() - 0.5) * 2.6
    const speed = (32 + 34 * rand()) * u
    const spin = (rand() - 0.5) * 18
    const colour = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]
    const x = cx + Math.cos(angle) * speed * life * 0.9
    const y = cy + Math.sin(angle) * speed * life + 0.5 * 75 * u * life * life
    ctx.globalAlpha = clamp01((CONFETTI_SEC - life) / 0.45)
    ctx.fillStyle = colour
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(spin * life)
    // A flat piece turning over: narrow and wide in turn.
    ctx.scale(1, Math.cos(life * (6 + i)))
    ctx.fillRect(-1 * u, -0.5 * u, 2 * u, 1 * u)
    ctx.restore()
  }
  ctx.restore()
}

/** Where pop card `n` (the n-th of the video) sits: just under the top bar,
 *  in turn a little to the left and a little to the right of his head. */
function popPlace(n: number, width: number, height: number): { cx: number; cy: number } {
  return { cx: width * (n % 2 === 0 ? 0.36 : 0.64), cy: height * 0.18 }
}

/** A pop card over his face (part "pop"): it springs in tilted, its drawing
 *  draws itself on, it floats while he talks, and it shrinks away. */
function drawPop(ctx: Ctx, part: Extract<Part, { kind: 'pop' }>, n: number, width: number, height: number, t: number, time: Timing): void {
  const u = width / 100
  const at = time.start(part.at)
  const until = time.end(part.to) + SCENE_HOLD
  if (!(t >= at - PART_LEAD) || t > until) return
  const p = clamp01((t - at + PART_LEAD) / 0.42)
  const out = clamp01((until - t) / 0.25)
  const life = t - at
  const badge = 11.5 * u
  const fitted = fitText(ctx, part.text, width * 0.56, 6.4 * u, 800)
  ctx.font = font(fitted.px, 800)
  const textW = ctx.measureText(fitted.text).width
  const w = badge + 2.8 * u + textW + 5.6 * u
  const h = 16 * u
  const place = popPlace(n, width, height)
  const cx = Math.max(w / 2 + 3 * u, Math.min(width - w / 2 - 3 * u, place.cx))
  const tilt = (n % 2 === 0 ? -1 : 1) * 0.045
  const float = Math.sin(life * 2.6) * 0.8 * u * clamp01(life / 0.6)
  ctx.save()
  ctx.globalAlpha *= clamp01(p * 2) * out
  ctx.translate(cx, place.cy + float + (1 - easeOut(p)) * 6 * u)
  ctx.rotate(tilt * (2 - easeOut(p)))
  const grow = easeBack(p) * (0.85 + 0.15 * out)
  ctx.scale(grow, grow)
  shadowed(ctx, 1.4 * u, () => {
    ctx.fillStyle = COLOURS.card
    roundRect(ctx, -w / 2, -h / 2, w, h, 3.2 * u)
    ctx.fill()
  })
  const tone = toneColour(part.tone)
  // A strip of its colour down the left edge.
  ctx.save()
  roundRect(ctx, -w / 2, -h / 2, w, h, 3.2 * u)
  ctx.clip()
  ctx.fillStyle = tone
  ctx.fillRect(-w / 2, -h / 2, 1.2 * u, h)
  ctx.restore()
  const left = -w / 2 + 2.6 * u
  if (part.icon) drawIconBadge(ctx, part.icon, left + badge / 2, 0, badge, tone, life - 0.1)
  const textX = part.icon ? left + badge + 2.8 * u : left
  // The words come in with the card, sliding a touch - never a blank card.
  const tp = clamp01((t - at + PART_LEAD) / 0.25)
  ctx.globalAlpha *= tp
  drawText(ctx, fitted.text, textX + (1 - easeOut(tp)) * 2 * u, 0.2 * u, textW + 2 * u, fitted.px, COLOURS.ink, { weight: 800 })
  ctx.restore()
}

function drawPart(ctx: Ctx, part: Part, box: Box, u: number, t: number, time: Timing): void {
  switch (part.kind) {
    case 'title': {
      const p = appear(t, time.start(part.at))
      popIn(ctx, p, box.x + box.w / 2, box.y + box.h / 2, () => {
        if (!part.icon) {
          drawText(ctx, part.text, box.x + box.w / 2, box.y + box.h / 2, box.w, 5.4 * u, COLOURS.ink, { weight: 800, align: 'center' })
          return
        }
        // The drawing just before the words, the two centred together.
        const badge = 7.6 * u
        const fitted = fitText(ctx, part.text, box.w - badge - 2 * u, 5.4 * u, 800)
        ctx.font = font(fitted.px, 800)
        const textW = ctx.measureText(fitted.text).width
        const left = box.x + (box.w - (badge + 1.6 * u + textW)) / 2
        drawIconBadge(ctx, part.icon, left + badge / 2, box.y + box.h / 2, badge, COLOURS.purple, t - time.start(part.at))
        drawText(ctx, fitted.text, left + badge + 1.6 * u, box.y + box.h / 2, textW + 1, fitted.px, COLOURS.ink, { weight: 800 })
      })
      return
    }
    case 'icons': {
      const n = part.items.length
      const gap = 3 * u
      const w = (box.w - gap * (n - 1)) / n
      const disc = Math.min(15 * u, w * 0.8)
      part.items.forEach((item, i) => {
        const cx = box.x + i * (w + gap) + w / 2
        const p = appear(t, time.start(item.at))
        popIn(ctx, p, cx, box.y + disc / 2, () => {
          shadowed(ctx, u * 0.8, () => {
            ctx.fillStyle = COLOURS.card
            ctx.beginPath()
            ctx.arc(cx, box.y + disc / 2 + 0.5 * u, disc / 2, 0, Math.PI * 2)
            ctx.fill()
          })
          drawIconBadge(ctx, item.icon, cx, box.y + disc / 2 + 0.5 * u, disc, toneColour(item.tone), t - time.start(item.at))
          if (item.text) drawText(ctx, item.text, cx, box.y + disc + 5 * u, w, 3.6 * u, COLOURS.ink, { weight: 700, align: 'center' })
        }, 2 * u)
      })
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
        const valueY = box.y + (part.label ? 5 : 0) * u + 6.5 * u
        const value = countText(part.text, clamp01((t - at + PART_LEAD) / COUNT_SEC))
        if (!part.icon) {
          drawText(ctx, value, box.x + box.w / 2, valueY, box.w, 11 * u, COLOURS.green, { weight: 800, align: 'center' })
          confetti(ctx, box.x + box.w / 2, valueY, u, t - at - COUNT_SEC, part.at)
          return
        }
        // Laid out on the number as it ends, so it doesn't slide while counting.
        const badge = 11 * u
        const fitted = fitText(ctx, part.text, box.w - badge - 3 * u, 11 * u, 800)
        ctx.font = font(fitted.px, 800)
        const textW = ctx.measureText(fitted.text).width
        const left = box.x + (box.w - (badge + 2 * u + textW)) / 2
        drawIconBadge(ctx, part.icon, left + badge / 2, valueY, badge, COLOURS.green, t - at)
        drawText(ctx, value, left + badge + 2 * u, valueY, textW + 4 * u, fitted.px, COLOURS.green, { weight: 800 })
      })
      confetti(ctx, box.x + box.w / 2, box.y + (part.label ? 5 : 0) * u + 6.5 * u, u, t - at - COUNT_SEC, part.at)
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
  // Never a plain grey: two soft glows of the board's colours and a faint
  // dot grid, like a designer's canvas.
  const u = width / 100
  for (const [x, y, r, colour] of [
    [0.12, 0.25, 0.55, 'rgba(91, 80, 232, 0.09)'],
    [0.92, 0.75, 0.5, 'rgba(31, 177, 90, 0.08)'],
  ] as const) {
    const glow = ctx.createRadialGradient(width * x, bottom * y, 0, width * x, bottom * y, width * r)
    glow.addColorStop(0, colour)
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, bottom)
  }
  ctx.fillStyle = 'rgba(30, 30, 50, 0.07)'
  const step = 4 * u
  const dot = Math.max(1, 0.32 * u)
  for (let y = step / 2; y < bottom; y += step) for (let x = step / 2; x < width; x += step) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot)
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
  // Big enough to be the first thing seen (2026-11-12: it was a stamp).
  const valuePx = 10 * u
  const labelPx = 3.2 * u
  ctx.font = font(valuePx, 800)
  const valueW = ctx.measureText(hook.text).width
  ctx.font = font(labelPx, 700, MONO)
  const labelW = ctx.measureText(hook.label.toUpperCase()).width
  const w = Math.min(width * 0.86, Math.max(valueW, labelW) + 9 * u)
  const h = (hook.label ? 5.4 : 0) * u + 13.5 * u
  const x = (width - w) / 2
  const y = 0.085 * height
  popIn(ctx, p, width / 2, y + h / 2, () => {
    shadowed(ctx, 1.4 * u, () => {
      ctx.fillStyle = COLOURS.card
      roundRect(ctx, x, y, w, h, 3 * u)
      ctx.fill()
    })
    if (hook.label) drawText(ctx, hook.label.toUpperCase(), x + 4.5 * u, y + 4.4 * u, w - 9 * u, labelPx, COLOURS.grey, { weight: 700, family: MONO })
    drawText(ctx, countText(hook.text, 0.7 + 0.3 * clamp01((t - at + PART_LEAD) / (COUNT_SEC * 1.2))), x + 4.5 * u, y + h - 6.6 * u, w - 9 * u, valuePx, COLOURS.green, { weight: 800 })
  }, 3 * u)
}

function drawEnd(ctx: Ctx, end: NonNullable<Storyboard['end']>, width: number, height: number, t: number, time: Timing): void {
  const u = width / 100
  const at = time.start(end.at)
  const p = clamp01((t - at + PART_LEAD) / 0.45)
  if (p <= 0) return
  // A card of its own, like the pop cards - its drawing in a purple disc and
  // the words big, springing in and breathing (2026-11-12: a small purple
  // stamp at the top nobody saw).
  const badge = 11 * u
  const fitted = fitText(ctx, end.text, width * 0.62, 6 * u, 800)
  ctx.font = font(fitted.px, 800)
  const textW = ctx.measureText(fitted.text).width
  const w = badge + 3 * u + textW + 7 * u
  const h = 16 * u
  // At the top, in the middle, or low over his chest - a place of its own per
  // video (his ask, 2026-11-12).
  const cy = (end.place === 'middle' ? 0.45 : end.place === 'low' ? 0.7 : 0.14) * height
  const life = t - at
  const breathe = 1 + 0.025 * Math.sin(Math.max(0, life - 0.5) * 3.2)
  ctx.save()
  ctx.globalAlpha *= clamp01(p * 2)
  ctx.translate(width / 2, cy + (1 - easeOut(p)) * 6 * u)
  const grow = easeBack(p) * breathe
  ctx.scale(grow, grow)
  shadowed(ctx, 1.6 * u, () => {
    ctx.fillStyle = COLOURS.card
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2)
    ctx.fill()
  })
  // A ring that pulses out every so often, to catch the eye.
  if (life > 0.6) {
    const ring = ((life - 0.6) % 1.6) / 1.6
    ctx.save()
    ctx.globalAlpha *= (1 - ring) * 0.55
    ctx.strokeStyle = COLOURS.purple
    ctx.lineWidth = 0.6 * u
    roundRect(ctx, -w / 2 - ring * 3 * u, -h / 2 - ring * 3 * u, w + ring * 6 * u, h + ring * 6 * u, h / 2 + ring * 3 * u)
    ctx.stroke()
    ctx.restore()
  }
  const left = -w / 2 + 2.8 * u
  drawIconBadge(ctx, end.icon ?? 'chat', left + badge / 2, 0, badge, COLOURS.purple, life - 0.1)
  drawText(ctx, fitted.text, left + badge + 3 * u, 0.2 * u, textW + 2 * u, fitted.px, COLOURS.ink, { weight: 800 })
  ctx.restore()
}

/** Everything of the storyboard at `t` on the finished video: the board and
 *  the scene on it, the hook card, the end banner. His face is drawn first
 *  by the caller, moved down by faceDropAt. */
export function drawMotion(ctx: Ctx, width: number, height: number, board: Storyboard, time: Timing, t: number, kinetic?: Kinetic, cutout?: CanvasImageSource | null, plan: Timing = time): void {
  if (formatOf(board) === 'glass') {
    drawGlassLook(ctx, width, height, board, time, t, kinetic, cutout, plan)
    return
  }
  const up = splitAt(board, time, t)
  drawBoardBackground(ctx, width, height, up)
  const u = width / 100
  const windows = sceneWindows(board, time)
  let pops = 0
  board.scenes.forEach((scene, i) => {
    if (popScene(scene)) {
      const n = pops++
      for (const part of scene.parts) if (part.kind === 'pop') drawPop(ctx, part, n, width, height, t, time)
      return
    }
    const w = windows[i]
    if (t < w.start || t >= w.end) return
    const fade = Math.min(clamp01((w.end - t) / 0.22), up > 0 ? 1 : 0)
    if (fade <= 0) return
    const layout = liveLayout(scene, width, height, t, time)
    ctx.save()
    ctx.globalAlpha = fade * clamp01(up * 1.4)
    ctx.translate(0, layout.originY)
    ctx.translate(width / 2, 0)
    ctx.scale(layout.scale, layout.scale)
    ctx.translate(-width / 2, 0)
    scene.parts.forEach((part, k) => {
      const box = layout.boxes[k]
      if (box) drawPart(ctx, part, box, u, t, time)
    })
    ctx.restore()
  })
  if (board.hook) drawHook(ctx, board.hook, width, height, t, time)
  if (board.end) drawEnd(ctx, board.end, width, height, t, time)
}

/** Where the captions sit at `t`: where he put them - except a caption set
 *  up on the board's part of the frame (Top, Middle) while the board is up,
 *  which drops under it with his face, so it never covers the graphics. */
export function captionPositionAt(board: Storyboard, time: Timing, t: number, position: CaptionPosition): CaptionPosition {
  // While the board is up his face sits low, where the usual caption is:
  // the caption goes to the seam between the board and his face, never over
  // his face or the graphics (2026-11-12) - unless he put it at the bottom.
  if (splitAt(board, time, t) > 0.5) return position === 'bottom' ? 'bottom' : 'middle'
  if (position !== 'top' && position !== 'middle') return position
  // A caption set at the top makes room for a pop card while it is up.
  const popUp = board.scenes.some((s) => popScene(s) && s.parts.some((p) => p.kind === 'pop' && t >= time.start(p.at) - 0.1 && t <= time.end(p.to) + SCENE_HOLD))
  return position === 'top' && popUp ? 'usual' : position
}

/** Fills the strip his face leaves at the top as it moves down, so nothing
 *  of the frame before shows through while the board fades in. */
export function fillBehindFace(ctx: Ctx, width: number, drop: number): void {
  if (drop <= 0) return
  ctx.fillStyle = COLOURS.board
  ctx.fillRect(0, 0, width, drop + 2)
}
