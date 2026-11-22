// Where the headline and the logo go, and how they are drawn. One function
// for both the preview on the setup screen and every frame of the real
// video, so what he sees while setting a look up is exactly what he gets.
//
// Positions keep clear of TikTok's own furniture, since that is where these
// videos go: the For You tabs across the top, the like/comment/share column
// down the right, and the caption across the bottom.

import { checkPictures, drawLine, hasPictures, measureLine } from './emojiSprites'
import { familyOf, headlineFontReady } from './headlineFont'
import { HEADLINE_SCALE, type HeadlinePlace, type HeadlinePosition, type HeadlineSize, type HeadlineStyle, type LogoPosition, type OutlineWidth } from './look'

// Start loading TikTok Sans as soon as anything that draws a headline is
// around, so previews have it by the time they are looked at.
void headlineFontReady()

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** The dead zone: fractions of a 9:16 frame that TikTok or Instagram Reels
 *  cover with their own things - whichever covers more at each edge (his
 *  ask, 2026-11-23: "respect the dead zone for the caption, for everything.
 *  Even the overlays cannot go too much on the sides"). From the platforms'
 *  safe-zone guides for 1080x1920: the top tabs (TikTok ~150 px, Reels
 *  ~220-250 px -> 13%), the caption, name and sound at the bottom (TikTok
 *  ~450-480 px, Reels ~420 px -> 25%), the like/comment/share column on the
 *  right (~120-140 px -> 13%) - which runs only down the lower part of the
 *  screen, from about `rightFrom` of the height - and a strip on the left
 *  (~60 px -> 6%). Nothing the Cutter draws goes in it: headlines, words,
 *  captions, pictures and videos are kept inside (keepSafe). */
export const TIKTOK_ZONES = {
  top: 0.13,
  bottom: 0.25,
  right: 0.13,
  /** Where the right-hand column starts, down the frame. */
  rightFrom: 0.4,
  side: 0.06,
} as const

/** How far pictures sit from the left edge (his ask, 2026-11-16: close to
 *  the edges) - the dead zone's own edge now; on the right, the button
 *  column's (keepSafe). */
export const PICTURE_EDGE = TIKTOK_ZONES.side

/** The safe area for a box `h` tall whose top is at `y` on a
 *  `width`x`height` frame: left, right, top, bottom in pixels. The right
 *  edge is the button column's for a box reaching down past where it
 *  starts, else the side strip's. */
export function safeArea(width: number, height: number, y: number, h: number): { left: number; right: number; top: number; bottom: number } {
  const reachesColumn = y + h > height * TIKTOK_ZONES.rightFrom
  return {
    left: width * TIKTOK_ZONES.side,
    right: width * (1 - (reachesColumn ? TIKTOK_ZONES.right : TIKTOK_ZONES.side)),
    top: height * TIKTOK_ZONES.top,
    bottom: height * (1 - TIKTOK_ZONES.bottom),
  }
}

/** A box moved, as little as it takes, inside the safe area - centred in it
 *  where it is too big to fit. */
export function keepSafe(box: { x: number; y: number; width: number; height: number }, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const fit = (at: number, size: number, low: number, high: number) => (size > high - low ? low + (high - low - size) / 2 : Math.min(Math.max(low, at), high - size))
  const top = height * TIKTOK_ZONES.top
  const bottom = height * (1 - TIKTOK_ZONES.bottom)
  const y = fit(box.y, box.height, top, bottom)
  const area = safeArea(width, height, y, box.height)
  return { ...box, x: fit(box.x, box.width, area.left, area.right), y }
}

/** TikTok's text is TikTok Sans at a semibold weight. */
const HEADLINE_WEIGHT = 600

/** TikTok's background text, in fractions of the font size: each line sits
 *  in its own box, the boxes touch, and the corners are gently rounded. */
const BOX = { lineHeight: 1.32, padX: 0.3, radius: 0.24 } as const
const OUTLINE = { lineHeight: 1.18, stroke: 0.14 } as const
/** Snapchat's caption: the phone's own font, white on a black band at 60%
 *  across the whole frame, the band a little taller than the words - in
 *  fractions of the font size. Its words are smaller than TikTok's text. */
// Snapchat's caption: a see-through black bar across the frame, white words.
// Made a little smaller and the bar a little slimmer to match the app's own
// (his words, 2026-11-03: "a tiny bit too big ... a little bit uncanny") -
// about 4.3% of the width at Medium, as Snapchat's caption is on an iPhone.
const SNAP = { lineHeight: 1.22, padY: 0.36, margin: 0.05, band: 'rgba(0, 0, 0, 0.6)', weight: 500 } as const
const SNAP_FAMILY = '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, "Apple Color Emoji", Arial, sans-serif'
const SNAP_SIZE: Record<HeadlineSize, number> = { small: 0.036, medium: 0.043, large: 0.052 }
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
  headline: {
    text: string
    position: HeadlinePosition
    style: HeadlineStyle
    size: HeadlineSize
    outlineColor?: string
    outlineWidth?: OutlineWidth
    /** Where he dragged it, and how much he pinched it: in place of its
     *  position, kept inside the frame. */
    place?: HeadlinePlace | null
    /** Instagram's look instead of TikTok's (a Trial reel copy). */
    font?: 'instagram'
  },
): HeadlineLayout | null {
  const text = headline.text.trim()
  if (!text) return null
  checkPictures(text)
  // Sized off the shorter side, so a landscape video does not get a
  // headline taller than the frame.
  const boxed = headline.style === 'box'
  const snap = headline.style === 'snap'
  const lay = (fontPx: number) => {
    const font = snap ? `${SNAP.weight} ${fontPx}px ${SNAP_FAMILY}` : `${HEADLINE_WEIGHT} ${fontPx}px ${familyOf(headline.font)}`
    ctx.font = font
    const maxWidth = snap ? width * (1 - 2 * SNAP.margin) : width * (1 - 2 * TIKTOK_ZONES.side) - (boxed ? fontPx * BOX.padX * 2 : 0)
    // Where the lines break is decided on how wide they are really drawn: an
    // emoji's measured width can be far off, and a line that came out wider
    // than measured ran off one side.
    const drawnWidth = (s: string) => {
      // On the server, emoji drawn from the iPhone's pictures: their width is known.
      if (hasPictures(s)) return measureLine(ctx, s, fontPx)
      const measured = ctx.measureText(s).width
      if (!EMOJI.test(s)) return measured
      const ink = inkOf(s, font, fontPx, measured)
      return ink ? Math.max(measured, ink.width) : measured
    }
    const lines = wrapText(text, maxWidth, drawnWidth).map((line) => {
      if (hasPictures(line)) return { text: line, width: measureLine(ctx, line, fontPx) }
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
  const place = headline.place
  const scale = place ? Math.min(HEADLINE_SCALE.max, Math.max(HEADLINE_SCALE.min, place.scale || 1)) : 1
  let laid = lay(Math.round(Math.min(width, height * (9 / 16)) * (snap ? SNAP_SIZE : SIZE_FACTOR)[headline.size] * scale))
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
  let top = Math.max(height * TIKTOK_ZONES.top + above, height * HEADLINE_Y[headline.position] - blockHeight / 2)
  let centerX = width / 2
  if (place) {
    // Where he put it, all of it outside the dead zone (keepSafe).
    const below = snap ? fontPx * SNAP.padY : 0
    const half = snap ? width / 2 : Math.max(...lines.map((l) => l.width)) / 2 + (boxed ? fontPx * BOX.padX : 0)
    const safe = keepSafe({ x: place.x * width - half, y: place.y * height - blockHeight / 2 - above, width: half * 2, height: blockHeight + above + below }, width, height)
    top = safe.y + above
    // Snapchat's band is the frame's width: only up and down.
    if (!snap) centerX = safe.x + half
  }
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
    centerX,
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
  if (logo.center) return keepSafe({ x: logo.center.x * width - w / 2, y: logo.center.y * height - h / 2, width: w, height: h }, width, height)
  // Close to the edges of the safe area, every spot alike, the middle left
  // free: on the right, clear of the button column where it reaches it.
  const left = width * PICTURE_EDGE
  const top = height * (TIKTOK_ZONES.top + 0.03)
  const bottom = height * (1 - TIKTOK_ZONES.bottom - 0.03) - h
  // The right edge at this height: the button column's where it reaches it.
  const rightAt = (y: number) => safeArea(width, height, y, h).right - w
  switch (logo.position) {
    case 'top':
      return { x: (width - w) / 2, y: top, width: w, height: h }
    case 'top-left':
      return { x: left, y: top, width: w, height: h }
    case 'top-right':
      return { x: rightAt(top), y: top, width: w, height: h }
    case 'middle-left':
      return { x: left, y: height * 0.42 - h / 2, width: w, height: h }
    case 'middle-right':
      return { x: rightAt(height * 0.42 - h / 2), y: height * 0.42 - h / 2, width: w, height: h }
    case 'bottom-left':
      return { x: left, y: bottom, width: w, height: h }
    case 'bottom-right':
      return { x: rightAt(bottom), y: bottom, width: w, height: h }
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
  // Pictures in different spots stay in their own spots; only those in the
  // same spot share a row there.
  const spotOf = (l: LogoLayout) => `${Math.round(((l.x + l.width / 2) / width) * 8)}:${Math.round(((l.y + l.height / 2) / height) * 8)}`
  const spots = new Map<string, number[]>()
  layouts.forEach((l, i) => spots.set(spotOf(l), [...(spots.get(spotOf(l)) ?? []), i]))
  const out: LogoLayout[] = layouts.map((l) => ({ ...l }))
  for (const ids of spots.values()) {
    if (ids.length < 2) continue
    const row = rowOf(ids.map((i) => layouts[i]), width, height)
    ids.forEach((i, k) => (out[i] = row[k]))
  }
  return out
}

/** Pictures of one spot in a row: against the left or right edge for a spot
 *  on that side, and for a spot in the middle spread to both edges, the
 *  middle left free. */
function rowOf(layouts: readonly LogoLayout[], width: number, height: number): LogoLayout[] {
  const gap = width * 0.02
  const gaps = gap * (layouts.length - 1)
  const tallest = Math.min(...layouts.map((l) => l.height))
  let widths = layouts.map((l) => (l.width * tallest) / l.height)
  // Between the dead zone's edges at the row's height.
  const cy0 = layouts.reduce((sum, l) => sum + l.y + l.height / 2, 0) / layouts.length
  const area0 = safeArea(width, height, cy0 - tallest / 2, tallest)
  const natural = widths.reduce((a, b) => a + b, 0)
  const scale = natural + gaps > area0.right - area0.left ? Math.max(0.05, (area0.right - area0.left - gaps) / natural) : 1
  widths = widths.map((w) => w * scale)
  const h = tallest * scale
  const row = widths.reduce((a, b) => a + b, 0) + gaps
  const cx = layouts.reduce((sum, l) => sum + l.x + l.width / 2, 0) / layouts.length
  const y = Math.min(Math.max(height * TIKTOK_ZONES.top, cy0 - h / 2), height * (1 - TIKTOK_ZONES.bottom) - h)
  const { left, right } = safeArea(width, height, y, h)
  const room = right - left
  const side = cx < width * 0.4 ? 'left' : cx > width * 0.6 ? 'right' : 'middle'
  // In the middle: the first against the left edge, the last against the
  // right, the rest evenly between.
  const step = side === 'middle' ? gap + Math.max(0, room - row) / (layouts.length - 1) : gap
  let x = side === 'right' ? right - row : left
  return widths.map((w) => {
    const placed = { x, y, width: w, height: h }
    x += w + step
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
      drawLine(ctx, line.text, x, baseline, layout.fontPx)
    } else if (layout.style === 'snap') {
      ctx.fillStyle = '#ffffff'
      drawLine(ctx, line.text, x, baseline, layout.fontPx)
    } else {
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.lineWidth = layout.fontPx * OUTLINE.stroke * OUTLINE_WIDTH[layout.outlineWidth]
      ctx.strokeStyle = layout.outlineColor
      drawLine(ctx, line.text, x, baseline, layout.fontPx, 'stroke')
      ctx.fillStyle = '#ffffff'
      drawLine(ctx, line.text, x, baseline, layout.fontPx)
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
