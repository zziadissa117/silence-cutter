// Where the headline and the logo go, and how they are drawn. One function
// for both the preview on the setup screen and every frame of the real
// video, so what he sees while setting a look up is exactly what he gets.
//
// Positions keep clear of TikTok's own furniture, since that is where these
// videos go: the For You tabs across the top, the like/comment/share column
// down the right, and the caption across the bottom.

import { HEADLINE_FAMILY, headlineFontReady } from './headlineFont'
import type { HeadlinePosition, HeadlineSize, HeadlineStyle, LogoPosition } from './look'

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

const SIZE_FACTOR: Record<HeadlineSize, number> = { small: 0.052, medium: 0.066, large: 0.082 }

/** Where the middle of the headline block sits, as a fraction of height. */
const HEADLINE_Y: Record<HeadlinePosition, number> = { top: 0.2, middle: 0.44, bottom: 0.68 }

export interface HeadlineLayout {
  lines: { text: string; width: number }[]
  font: string
  fontPx: number
  centerX: number
  /** Top of the first line's box. */
  top: number
  /** From the top of a line's box down to its baseline. */
  baselineOffset: number
  lineHeight: number
  style: HeadlineStyle
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
  headline: { text: string; position: HeadlinePosition; style: HeadlineStyle; size: HeadlineSize },
): HeadlineLayout | null {
  const text = headline.text.trim()
  if (!text) return null
  // Sized off the shorter side, so a landscape video does not get a
  // headline taller than the frame.
  const fontPx = Math.round(Math.min(width, height * (9 / 16)) * SIZE_FACTOR[headline.size])
  const font = `${HEADLINE_WEIGHT} ${fontPx}px ${HEADLINE_FAMILY}`
  ctx.font = font
  const boxed = headline.style === 'box'
  const maxWidth = width * (1 - 2 * TIKTOK_ZONES.side) - (boxed ? fontPx * BOX.padX * 2 : 0)
  const lines = wrapText(text, maxWidth, (s) => ctx.measureText(s).width).map((line) => ({
    text: line,
    width: ctx.measureText(line).width,
  }))
  const lineHeight = fontPx * (boxed ? BOX.lineHeight : OUTLINE.lineHeight)
  const blockHeight = lineHeight * lines.length
  const top = Math.max(height * TIKTOK_ZONES.top, height * HEADLINE_Y[headline.position] - blockHeight / 2)
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
  }
}

export function layoutLogo(
  width: number,
  height: number,
  image: { width: number; height: number },
  logo: { position: LogoPosition; widthPct: number },
): LogoLayout {
  const w = Math.round(Math.min(width, height * (9 / 16)) * (logo.widthPct / 100))
  const h = Math.round(w * (image.height / image.width))
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
 *  letters with a black edge that read over anything. */
export function drawHeadline(ctx: Ctx, layout: HeadlineLayout): void {
  ctx.save()
  ctx.font = layout.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  if (layout.style === 'box') drawBoxes(ctx, layout)
  layout.lines.forEach((line, i) => {
    const baseline = layout.top + i * layout.lineHeight + layout.baselineOffset
    if (layout.style === 'box') {
      ctx.fillStyle = '#000000'
      ctx.fillText(line.text, layout.centerX, baseline)
    } else {
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.lineWidth = layout.fontPx * OUTLINE.stroke
      ctx.strokeStyle = '#000000'
      ctx.strokeText(line.text, layout.centerX, baseline)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(line.text, layout.centerX, baseline)
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
 *  1080×1920 (or 1920×1080) if it is bigger. TikTok plays nothing larger, a
 *  4K frame is four times the memory for no gain, and H.264 needs even
 *  sides. */
export function outputSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 1080 / Math.min(width, height), 1920 / Math.max(width, height))
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}
