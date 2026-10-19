// Where the headline and the logo go, and how they are drawn. One function
// for both the preview on the setup screen and every frame of the real
// video, so what he sees while setting a look up is exactly what he gets.
//
// Positions keep clear of TikTok's own furniture, since that is where these
// videos go: the For You tabs across the top, the like/comment/share column
// down the right, and the caption across the bottom.

import { HEADLINE_FAMILY, headlineFontReady } from './headlineFont'
import type { HeadlinePosition, HeadlineSize, HeadlineStyle, LogoPosition, OutlineWidth } from './look'

// Start loading TikTok Sans as soon as anything that draws a headline is
// around, so previews have it by the time they are looked at.
void headlineFontReady()

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Fractions of the frame TikTok covers, for a 9:16 video. */
export const TIKTOK_ZONES = {
  top: 0.1,
  bottom: 0.2,
  right: 0.15,
  side: 0.06,
} as const

/** TikTok's text is TikTok Sans at a semibold weight. */
const HEADLINE_WEIGHT = 600

/** TikTok's background text, in fractions of the font size: each line sits
 *  in its own box, the boxes touch, and the corners are gently rounded. */
const BOX = { lineHeight: 1.32, padX: 0.3, radius: 0.24 } as const
const OUTLINE = { lineHeight: 1.18, stroke: 0.14 } as const
/** Snapchat's caption: the phone's own font, white on a black band at 60%
 *  across the whole frame, the band a little taller than the words - in
 *  fractions of the font size. Its words are smaller than TikTok's text. */
const SNAP = { lineHeight: 1.28, padY: 0.42, margin: 0.05, band: 'rgba(0, 0, 0, 0.6)', weight: 500 } as const
const SNAP_FAMILY = '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, "Apple Color Emoji", Arial, sans-serif'
const SNAP_SIZE: Record<HeadlineSize, number> = { small: 0.042, medium: 0.05, large: 0.06 }
/** The outline's thickness, as a multiple of the normal one. */
const OUTLINE_WIDTH: Record<OutlineWidth, number> = { thin: 0.55, normal: 1, thick: 1.5 }

/** A #rrggbb, or black: whatever was saved, only a real colour reaches the canvas. */
export function outlineColorOf(value: string | undefined): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'
}

const SIZE_FACTOR: Record<HeadlineSize, number> = { small: 0.052, medium: 0.066, large: 0.082 }

/** Where the middle of the headline block sits, as a fraction of height. */
const HEADLINE_Y: Record<HeadlinePosition, number> = { top: 0.2, middle: 0.44, bottom: 0.68 }

/** The most of the frame's height a headline may cover: a long one (a step's
 *  name can be as many words as he likes) gets smaller rather than run down
 *  the screen. A usual headline is far below it. */
const MAX_BLOCK = 0.45

export interface HeadlineLayout {
  /** Each line's width as drawn, and how far to move it so what is drawn -
   *  not what was measured - sits in the middle (see inkOf). */
  lines: { text: string; width: number; shift?: number }[]
  font: string
  fontPx: number
  centerX: number
  /** Top of the first line's box. */
  top: number
  /** From the top of a line's box down to its baseline. */
  baselineOffset: number
  lineHeight: number
  style: HeadlineStyle
  outlineColor: string
  outlineWidth: OutlineWidth
}

export interface LogoLayout {
  x: number
  y: number
  width: number
  height: number
}

/** Breaks the headline into lines no wider than `maxWidth`, never splitting
 *  a word unless the word alone is wider than the line. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (!line || measure(candidate) <= maxWidth) line = candidate
      else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

export function layoutHeadline(
  ctx: Ctx,
  width: number,
  height: number,
  headline: { text: string; position: HeadlinePosition; style: HeadlineStyle; size: HeadlineSize; outlineColor?: string; outlineWidth?: OutlineWidth },
): HeadlineLayout | null {
  const text = headline.text.trim()
  if (!text) return null
  // Sized off the shorter side, so a landscape video does not get a
  // headline taller than the frame.
  const boxed = headline.style === 'box'
  const snap = headline.style === 'snap'
  const lay = (fontPx: number) => {
    const font = snap ? `${SNAP.weight} ${fontPx}px ${SNAP_FAMILY}` : `${HEADLINE_WEIGHT} ${fontPx}px ${HEADLINE_FAMILY}`
    ctx.font = font
    const maxWidth = snap ? width * (1 - 2 * SNAP.margin) : width * (1 - 2 * TIKTOK_ZONES.side) - (boxed ? fontPx * BOX.padX * 2 : 0)
    // Where the lines break is decided on how wide they are really drawn: an
    // emoji's measured width can be far off, and a line that came out wider
    // than measured ran off one side.
    const drawnWidth = (s: string) => {
      const measured = ctx.measureText(s).width
      if (!EMOJI.test(s)) return measured
      const ink = inkOf(s, font, fontPx, measured)
      return ink ? Math.max(measured, ink.width) : measured
    }
    const lines = wrapText(text, maxWidth, drawnWidth).map((line) => {
      const measured = ctx.measureText(line).width
      const ink = inkOf(line, font, fontPx, measured)
      if (!ink) return { text: line, width: measured }
      // Normal letters sit a hair inside their measured width, and the box
      // keeps that hair; a glyph drawn narrower than measured (an emoji, on
      // some phones) does not widen the box on one side.
      return { text: line, width: ink.width + Math.min(Math.max(0, measured - ink.width), fontPx * 0.12), shift: -ink.center }
    })
    return { font, fontPx, maxWidth, lines }
  }
  let laid = lay(Math.round(Math.min(width, height * (9 / 16)) * (snap ? SNAP_SIZE : SIZE_FACTOR)[headline.size]))
  // A line that still can't fit (one long word, a row of emoji) makes the
  // whole headline a little smaller rather than spill off the sides.
  for (let tries = 0; tries < 3; tries++) {
    const widest = Math.max(...laid.lines.map((l) => l.width))
    if (widest <= laid.maxWidth) break
    laid = lay(Math.max(8, Math.floor((laid.fontPx * laid.maxWidth) / widest)))
  }
  const lineFactor = boxed ? BOX.lineHeight : snap ? SNAP.lineHeight : OUTLINE.lineHeight
  // However many words: too tall and it all gets smaller - by the square
  // root, as a smaller font also fits more words on each line.
  for (let tries = 0; tries < 8; tries++) {
    const tall = laid.lines.length * laid.fontPx * lineFactor
    if (tall <= height * MAX_BLOCK || laid.fontPx <= 8) break
    laid = lay(Math.max(8, Math.floor(laid.fontPx * Math.min(0.95, Math.sqrt((height * MAX_BLOCK) / tall)))))
  }
  const { font, fontPx, lines } = laid
  ctx.font = font
  const lineHeight = fontPx * lineFactor
  const blockHeight = lineHeight * lines.length
  // Snapchat's band reaches a little above the words: it stays below TikTok's tabs too.
  const above = snap ? fontPx * SNAP.padY : 0
  const top = Math.max(height * TIKTOK_ZONES.top + above, height * HEADLINE_Y[headline.position] - blockHeight / 2)
  // Each line's text centred on the font's own height, top of the tallest
  // letter to the bottom of a "g", as TikTok lays its text out - so a line
  // with descenders has as much room below as above.
  const metrics = ctx.measureText('Hg')
  const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || fontPx * 0.9
  const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || fontPx * 0.25
  return {
    lines,
    font,
    fontPx,
    centerX: width / 2,
    top,
    baselineOffset: lineHeight / 2 + (ascent - descent) / 2,
    lineHeight,
    style: headline.style,
    outlineColor: outlineColorOf(headline.outlineColor),
    outlineWidth: headline.outlineWidth ?? 'normal',
  }
}

/** Where the ink of a row of pixels starts and ends: the first and last
 *  column with anything drawn in it, or null for none. `alpha` is RGBA. */
export function inkColumns(data: Uint8ClampedArray, width: number, height: number): { first: number; last: number } | null {
  let first = -1
  let last = -1
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (first < 0) first = x
        last = x
        break
      }
    }
  }
  return first < 0 ? null : { first, last }
}

/** The line as the phone actually draws it, centred where it is drawn:
 *  how wide its ink is and how far the ink's middle sits from the point it
 *  was centred on. A headline is centred on its measured width, and on an
 *  iPhone an emoji - in nearly every one of his headlines - can be drawn at
 *  a different width than it was measured at, which left the words off to
 *  one side. Null where there is no canvas to draw on (tests). */
function inkOf(line: string, font: string, fontPx: number, measured: number): { width: number; center: number } | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  try {
    // Room for the widest it could be drawn - an emoji can come out far wider
    // than it was measured, and ink cut off at the edge was centred wrong.
    let width = Math.ceil(Math.max(measured, [...line].length * fontPx * 1.3) + fontPx * 4)
    const height = Math.ceil(fontPx * 2.2)
    for (let attempt = 0; attempt < 2; attempt++) {
      const scratch = new OffscreenCanvas(width, height)
      const c = scratch.getContext('2d')
      if (!c) return null
      c.font = font
      c.textAlign = 'center'
      c.textBaseline = 'alphabetic'
      c.fillStyle = '#000'
      // Drawn once to have the phone's emoji ready, then for real: the very
      // first emoji drawn could come out missing, and the line was then
      // centred as if it weren't there.
      c.fillText(line, width / 2, fontPx * 1.5)
      c.clearRect(0, 0, width, height)
      c.fillText(line, width / 2, fontPx * 1.5)
      const ink = inkColumns(c.getImageData(0, 0, width, height).data, width, height)
      if (!ink) return null
      if (ink.first > 0 && ink.last < width - 1) return { width: ink.last - ink.first + 1, center: (ink.first + ink.last + 1) / 2 - width / 2 }
      width *= 2
    }
    return null
  } catch {
    return null
  }
}

/** Emoji and other pictures in text - drawn by the phone at its own width. */
const EMOJI = /\p{Extended_Pictographic}/u

export function layoutLogo(
  width: number,
  height: number,
  image: { width: number; height: number },
  logo: { position: LogoPosition; widthPct: number; center?: { x: number; y: number } },
): LogoLayout {
  const w = Math.round(Math.min(width, height * (9 / 16)) * (logo.widthPct / 100))
  const h = Math.round(w * (image.height / image.width))
  // Dragged to a spot of his own (a picture in the cuts editor): its middle
  // there, kept inside the frame.
  if (logo.center) {
    const x = Math.min(Math.max(0, logo.center.x * width - w / 2), Math.max(0, width - w))
    const y = Math.min(Math.max(0, logo.center.y * height - h / 2), Math.max(0, height - h))
    return { x, y, width: w, height: h }
  }
  const left = width * TIKTOK_ZONES.side
  // Right-hand corners stop short of TikTok's button column.
  const right = width * (1 - TIKTOK_ZONES.right) - w
  const top = height * (TIKTOK_ZONES.top + 0.03)
  const bottom = height * (1 - TIKTOK_ZONES.bottom - 0.03) - h
  switch (logo.position) {
    case 'top':
      return { x: (width - w) / 2, y: top, width: w, height: h }
    case 'top-left':
      return { x: left, y: top, width: w, height: h }
    case 'top-right':
      return { x: width * (1 - TIKTOK_ZONES.side) - w, y: top, width: w, height: h }
    case 'bottom-left':
      return { x: left, y: bottom, width: w, height: h }
    case 'bottom-right':
      return { x: right, y: bottom, width: w, height: h }
    default:
      return { x: (width - w) / 2, y: height * 0.42 - h / 2, width: w, height: h }
  }
}

/** Pictures that came up within this long of each other came up together -
 *  one word, or two said in a breath - and share a row. */
export const TOGETHER_SEC = 0.35

/** The pictures up now, in groups that came up together (by when each came
 *  up), first come first. */
export function cameUpTogether<T>(items: readonly { item: T; start: number }[], within = TOGETHER_SEC): T[][] {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const groups: { start: number; items: T[] }[] = []
  for (const { item, start } of sorted) {
    const last = groups[groups.length - 1]
    if (last && start - last.start < within) last.items.push(item)
    else groups.push({ start, items: [item] })
  }
  return groups.map((g) => g.items)
}

/** Pictures that came up together, side by side in one row instead of on
 *  top of each other: the same height (the shortest's), each keeping its
 *  shape, a small gap between, the row no wider than the frame's safe width
 *  (shrunk to fit when it would be), centred where they would have been. One
 *  picture keeps its own place. */
export function sideBySide(layouts: readonly LogoLayout[], width: number, height: number): LogoLayout[] {
  if (layouts.length < 2) return layouts.map((l) => ({ ...l }))
  const gap = width * 0.02
  const gaps = gap * (layouts.length - 1)
  const tallest = Math.min(...layouts.map((l) => l.height))
  let widths = layouts.map((l) => (l.width * tallest) / l.height)
  const room = width * (1 - 2 * TIKTOK_ZONES.side)
  const natural = widths.reduce((a, b) => a + b, 0)
  const scale = natural + gaps > room ? Math.max(0.05, (room - gaps) / natural) : 1
  widths = widths.map((w) => w * scale)
  const h = tallest * scale
  const row = widths.reduce((a, b) => a + b, 0) + gaps
  const cx = layouts.reduce((sum, l) => sum + l.x + l.width / 2, 0) / layouts.length
  const cy = layouts.reduce((sum, l) => sum + l.y + l.height / 2, 0) / layouts.length
  const x0 = Math.min(Math.max(width * TIKTOK_ZONES.side, cx - row / 2), width * (1 - TIKTOK_ZONES.side) - row)
  const y = Math.min(Math.max(height * TIKTOK_ZONES.top, cy - h / 2), height * (1 - TIKTOK_ZONES.bottom) - h)
  let x = x0
  return widths.map((w) => {
    const placed = { x, y, width: w, height: h }
    x += w + gap
    return placed
  })
}

/** A box with its own radius at each corner: top-left, top-right,
 *  bottom-right, bottom-left. */
function box(ctx: Ctx, x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]): void {
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr)
  else ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + h - br)
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br)
  else ctx.lineTo(x + w, y + h)
  ctx.lineTo(x + bl, y + h)
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl)
  else ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + tl)
  if (tl) ctx.arcTo(x, y, x + tl, y, tl)
  else ctx.lineTo(x, y)
  ctx.closePath()
}

/** The inward curve where a narrower line's box meets a wider one's, at
 *  (x, y) on the join: `side` -1 for the left edge, 1 for the right, and
 *  `up` when the wider box is above. */
function fillet(ctx: Ctx, x: number, y: number, r: number, side: -1 | 1, up: boolean): void {
  const cx = x + side * r
  const cy = up ? y + r : y - r
  ctx.moveTo(x, y)
  ctx.lineTo(x, cy)
  if (up) ctx.arc(cx, cy, r, side < 0 ? 0 : Math.PI, -Math.PI / 2, side < 0)
  else ctx.arc(cx, cy, r, side < 0 ? 0 : Math.PI, Math.PI / 2, side > 0)
  ctx.closePath()
}

/** TikTok's background text: one white box per line, the boxes touching so
 *  a headline of several lines is one shape, rounded outside and curving
 *  inward where a shorter line meets a longer one. Lines within a corner's
 *  width of each other are squared up to the same width, as TikTok does,
 *  rather than leaving a tiny step. */
function drawBoxes(ctx: Ctx, layout: HeadlineLayout): void {
  const r = layout.fontPx * BOX.radius
  const padX = layout.fontPx * BOX.padX
  const half = layout.lines.map((line) => line.width / 2 + padX)
  for (let pass = 0; pass < half.length; pass++) {
    for (let i = 0; i + 1 < half.length; i++) {
      if (half[i] !== half[i + 1] && Math.abs(half[i] - half[i + 1]) < 2 * r) {
        half[i] = half[i + 1] = Math.max(half[i], half[i + 1])
      }
    }
  }
  ctx.fillStyle = '#ffffff'
  // Boxes, then the inward curves as a fill of their own: drawn the other
  // way round, they would cut a hairline out of a box where they touch it.
  ctx.beginPath()
  half.forEach((h, i) => {
    const y = layout.top + i * layout.lineHeight
    const above = i > 0 ? half[i - 1] : -1
    const below = i + 1 < half.length ? half[i + 1] : -1
    const top = h > above ? r : 0
    const bottom = h > below ? r : 0
    // A hair of overlap, so no seam shows between touching boxes.
    const seam = i > 0 ? 0.5 : 0
    box(ctx, layout.centerX - h, y - seam, h * 2, layout.lineHeight + seam, [top, top, bottom, bottom])
  })
  ctx.fill()
  ctx.beginPath()
  half.forEach((h, i) => {
    const y = layout.top + i * layout.lineHeight
    if (i + 1 < half.length && half[i + 1] > h) {
      fillet(ctx, layout.centerX - h, y + layout.lineHeight, r, -1, false)
      fillet(ctx, layout.centerX + h, y + layout.lineHeight, r, 1, false)
    }
    if (i > 0 && half[i - 1] > h) {
      fillet(ctx, layout.centerX - h, y, r, -1, true)
      fillet(ctx, layout.centerX + h, y, r, 1, true)
    }
  })
  ctx.fill()
}

/** TikTok's own text looks: black on white background boxes, or white
 *  letters with a black edge that read over anything - or Snapchat's
 *  caption, white words on a dark band from one side of the frame to the
 *  other. */
export function drawHeadline(ctx: Ctx, layout: HeadlineLayout): void {
  ctx.save()
  ctx.font = layout.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  if (layout.style === 'box') drawBoxes(ctx, layout)
  if (layout.style === 'snap') {
    const padY = layout.fontPx * SNAP.padY
    ctx.fillStyle = SNAP.band
    // The whole frame's width, whatever width the words were laid out in
    // (the Claude + X money line is laid out bigger, then placed).
    ctx.fillRect(0, layout.top - padY, ctx.canvas?.width ?? layout.centerX * 2, layout.lines.length * layout.lineHeight + 2 * padY)
  }
  layout.lines.forEach((line, i) => {
    const baseline = layout.top + i * layout.lineHeight + layout.baselineOffset
    const x = layout.centerX + (line.shift ?? 0)
    if (layout.style === 'box') {
      ctx.fillStyle = '#000000'
      ctx.fillText(line.text, x, baseline)
    } else if (layout.style === 'snap') {
      ctx.fillStyle = '#ffffff'
      ctx.fillText(line.text, x, baseline)
    } else {
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.lineWidth = layout.fontPx * OUTLINE.stroke * OUTLINE_WIDTH[layout.outlineWidth]
      ctx.strokeStyle = layout.outlineColor
      ctx.strokeText(line.text, x, baseline)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(line.text, x, baseline)
    }
  })
  ctx.restore()
}

export function drawLogo(ctx: Ctx, image: CanvasImageSource, layout: LogoLayout): void {
  ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height)
}

/** The logo at a point in its spring: scaled about its own centre, faded in
 *  or out. */
export function drawPoppedLogo(
  ctx: Ctx,
  image: CanvasImageSource,
  layout: LogoLayout,
  { scale, alpha }: { scale: number; alpha: number },
): void {
  if (alpha <= 0) return
  const cx = layout.x + layout.width / 2
  const cy = layout.y + layout.height / 2
  ctx.save()
  ctx.globalAlpha = alpha
  drawLogo(ctx, image, {
    x: cx - (layout.width * scale) / 2,
    y: cy - (layout.height * scale) / 2,
    width: layout.width * scale,
    height: layout.height * scale,
  })
  ctx.restore()
}

/** The size a video comes out at: its own size, brought down to fit
 *  `maxShort` on its shorter side - 2160 by default; posted videos are made
 *  at 1080 (quality.ts) - and even sides, which H.264 needs. */
export function outputSize(width: number, height: number, maxShort = 2160): { width: number; height: number } {
  const scale = Math.min(1, maxShort / Math.min(width, height), (maxShort * 16) / 9 / Math.max(width, height))
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}
