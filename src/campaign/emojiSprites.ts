// Apple's emoji in the server's videos. The Cutter server draws headlines in
// Chrome on Linux, which has no Apple emoji: its videos came out with
// Google's ("Samsung emojis", his friend's posts, 2026-10-25). Apple's font
// can't go on a Linux server, so the iPhone draws each emoji of his headlines
// as a picture - with its own font, as it always drew them in his videos -
// and sends the pictures up with the clips (serverLink.ts). The server puts
// each picture where its emoji goes (overlay.ts drawLine / measureLine), at
// the size and place the iPhone would have drawn it. A phone draws its own
// emoji as before: the pictures are only ever used on the server.

import { report } from '../report'
import type { BankFile } from './batch'
import { SERVER_MODE } from './serverFlag'

/** One emoji as the iPhone draws it: the picture (a bank file), its advance,
 *  and where the picture sits from the pen at the baseline - all in ems, so
 *  it scales with the headline. */
export interface EmojiSprite extends BankFile {
  /** The emoji: one grapheme, skin tone and joined parts included. */
  text: string
  advance: number
  left: number
  top: number
  width: number
  height: number
}

/** The texts of a bank that are drawn on its videos. */
interface Texts {
  headlines: readonly string[]
  steps?: readonly { name: string }[]
}

/** What the user sees as one character - "👍🏽" or "👨‍👩‍👧" is one. */
export function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment)
  return Array.from(text)
}

/** Drawn as a coloured emoji, not as a letter: "😂", "❤️", "1️⃣", a flag -
 *  not "™" or a bare "❤" in a font that has it. */
const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u
const AS_EMOJI = /\p{Emoji_Presentation}|️|⃣|\p{Regional_Indicator}/u
export function isEmoji(grapheme: string): boolean {
  return PICTURE.test(grapheme) && AS_EMOJI.test(grapheme)
}

/** Every different emoji in the texts, in the order they first appear. */
export function emojisIn(texts: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const text of texts) for (const g of graphemes(text)) if (isEmoji(g)) seen.add(g)
  return [...seen]
}

/** A file id the server takes (letters, digits, - and _, 80 at most), the
 *  same for the same emoji on every phone. */
export function spriteId(text: string): string {
  const hex = Array.from(text, (c) => c.codePointAt(0)!.toString(16)).join('-')
  const id = `emoji-${hex}`
  if (id.length <= 80) return id
  let h = 0
  for (const c of hex) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0
  return `emoji-${hex.slice(0, 60)}-${(h >>> 0).toString(16)}`
}

// --- On the server: the pictures, ready to draw ------------------------------

const ready = new Map<string, { sprite: EmojiSprite; image: CanvasImageSource }>()
let loading: Promise<void> = Promise.resolve()

/** Has the picture for each of these emoji, loaded from the server's disk
 *  once each; renders wait for it (emojiSpritesReady). */
export function loadEmojiSprites(sprites: readonly EmojiSprite[] | undefined, load: (file: BankFile) => Promise<Blob | null>): Promise<void> {
  const missing = (sprites ?? []).filter((s) => !ready.has(s.text))
  if (missing.length === 0) return loading
  const next = (async () => {
    for (const sprite of missing) {
      try {
        const blob = await load(sprite)
        if (blob) ready.set(sprite.text, { sprite, image: await createImageBitmap(blob) })
      } catch {
        // That emoji is drawn by the server's own font instead.
      }
    }
  })()
  loading = loading.then(() => next)
  return loading
}

/** Resolves once the pictures asked for so far are loaded. */
export function emojiSpritesReady(): Promise<void> {
  return loading
}

/** For tests: pictures as given, nothing loaded. */
export function useEmojiSprites(list: readonly { sprite: EmojiSprite; image: CanvasImageSource }[]): void {
  ready.clear()
  checked.clear()
  for (const item of list) ready.set(item.sprite.text, item)
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Run = { text: string; picture?: { sprite: EmojiSprite; image: CanvasImageSource } }

/** The line in runs of words and pictures - or null when it has no emoji
 *  with a picture, and is drawn as it always was. */
function runs(line: string): Run[] | null {
  if (ready.size === 0) return null
  const out: Run[] = []
  let pictured = false
  for (const g of graphemes(line)) {
    const picture = ready.get(g)
    if (picture) {
      out.push({ text: g, picture })
      pictured = true
    } else if (out.length > 0 && !out[out.length - 1].picture) out[out.length - 1].text += g
    else out.push({ text: g })
  }
  return pictured ? out : null
}

const checked = new Set<string>()

/** On the server, an emoji about to be drawn with no picture from the phone
 *  - Google's would show - is reported, once per emoji, so it is seen and
 *  fixed rather than found in his posts. Text checked once each. */
export function checkPictures(text: string, onServer = SERVER_MODE): string[] {
  if (!onServer || checked.has(text)) return []
  checked.add(text)
  const missing = emojisIn([text]).filter((g) => !ready.has(g) && !checked.has(`emoji:${g}`))
  if (missing.length === 0) return []
  for (const g of missing) checked.add(`emoji:${g}`)
  report({ page: 'campaign', kind: 'check', phase: 'emoji', message: `No picture from the phone for ${missing.join(' ')} - drawn with the server's own emoji, in "${text.slice(0, 80)}"` })
  return missing
}

/** Whether the line has an emoji drawn from its picture. */
export function hasPictures(line: string): boolean {
  return runs(line) !== null
}

/** The line's width as drawn - its pictures at their own advance. */
export function measureLine(ctx: Ctx, line: string, fontPx: number): number {
  const parts = runs(line)
  if (!parts) return ctx.measureText(line).width
  return parts.reduce((w, p) => w + (p.picture ? p.picture.sprite.advance * fontPx : ctx.measureText(p.text).width), 0)
}

/** The line filled (or its outline stroked) at (x, baseline), as fillText
 *  would - lined up by the context's textAlign - with each emoji's picture in
 *  its place. An outline goes round the words only, as on the iPhone. */
export function drawLine(ctx: Ctx, line: string, x: number, baseline: number, fontPx: number, how: 'fill' | 'stroke' = 'fill'): void {
  const parts = runs(line)
  if (!parts) {
    if (how === 'fill') ctx.fillText(line, x, baseline)
    else ctx.strokeText(line, x, baseline)
    return
  }
  const align = ctx.textAlign
  const total = measureLine(ctx, line, fontPx)
  let pen = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x
  ctx.textAlign = 'left'
  for (const part of parts) {
    if (part.picture) {
      const { sprite, image } = part.picture
      if (how === 'fill') ctx.drawImage(image, pen + sprite.left * fontPx, baseline + sprite.top * fontPx, sprite.width * fontPx, sprite.height * fontPx)
      pen += sprite.advance * fontPx
    } else {
      if (how === 'fill') ctx.fillText(part.text, pen, baseline)
      else ctx.strokeText(part.text, pen, baseline)
      pen += ctx.measureText(part.text).width
    }
  }
  ctx.textAlign = align
}

// --- On the iPhone: drawing the pictures --------------------------------------

/** A phone whose own emoji are Apple's: only its pictures are worth sending.
 *  Any other phone's would look no better than the server's own. */
export function drawsAppleEmoji(): boolean {
  return !SERVER_MODE && typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
}

/** The size each emoji is drawn at: the videos' headlines are under half of it. */
const DRAW_PX = 160

function scratch(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx } | null {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d') as Ctx | null
  return ctx ? { canvas, ctx } : null
}

/** One emoji drawn with the phone's own font, cut to its ink, as a PNG -
 *  with where it sits. Null if the phone drew nothing. */
export async function drawEmoji(text: string): Promise<{ blob: Blob; advance: number; left: number; top: number; width: number; height: number } | null> {
  const size = DRAW_PX * 4
  const penX = DRAW_PX
  const baseline = DRAW_PX * 2.5
  const made = scratch(size, size)
  if (!made) return null
  const { ctx } = made
  ctx.font = `${DRAW_PX}px "Apple Color Emoji", sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // Drawn once to have the font ready, then for real: the first emoji drawn
  // can come out missing (overlay.ts inkOf).
  ctx.fillText(text, penX, baseline)
  ctx.clearRect(0, 0, size, size)
  ctx.fillText(text, penX, baseline)
  const advance = ctx.measureText(text).width / DRAW_PX
  const data = ctx.getImageData(0, 0, size, size).data
  let x0 = size
  let y0 = size
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const cut = scratch(w, h)
  if (!cut) return null
  cut.ctx.drawImage(made.canvas, x0, y0, w, h, 0, 0, w, h)
  const blob =
    'convertToBlob' in cut.canvas
      ? await cut.canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob | null>((resolve) => (cut.canvas as HTMLCanvasElement).toBlob(resolve, 'image/png'))
  if (!blob) return null
  return { blob, advance, left: (x0 - penX) / DRAW_PX, top: (y0 - baseline) / DRAW_PX, width: w / DRAW_PX, height: h / DRAW_PX }
}

/** The bank's emoji pictures with any new emoji of its headlines (and step
 *  names) drawn and kept (`keep`) - or null when it has them all already. */
export async function emojiSpritesFor(
  bank: Texts & { emojis?: EmojiSprite[] },
  keep: (id: string, blob: Blob) => Promise<void>,
  draw: typeof drawEmoji = drawEmoji,
): Promise<EmojiSprite[] | null> {
  const have = bank.emojis ?? []
  const missing = emojisIn([...bank.headlines, ...(bank.steps ?? []).map((s) => s.name)]).filter((t) => !have.some((s) => s.text === t))
  if (missing.length === 0) return null
  const made: EmojiSprite[] = []
  for (const text of missing) {
    const drawn = await draw(text).catch(() => null)
    if (!drawn) continue
    const id = spriteId(text)
    await keep(id, drawn.blob)
    const { blob, ...where } = drawn
    made.push({ id, name: `${id}.png`, type: 'image/png', size: blob.size, fp: id, text, ...where })
  }
  return made.length > 0 ? [...have, ...made] : null
}
