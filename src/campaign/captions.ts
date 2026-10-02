// Captions burned into a campaign video: one word at a time, in TikTok Sans,
// white with a light black edge, popping in the moment he says it.
//
// The words come from the listen that sorted the video. He checks them
// before the video is made, a phrase at a time the way TikTok's own caption
// editor shows them, and fixes whatever the model misheard - so what is
// burned in is what he approved. A phrase keeps its moment; words typed
// into it share its time out between them.

import type { WordChunk } from '../media/fillerWords'
import type { Level, Range } from '../media/silenceMath'
import { HEADLINE_FAMILY } from './headlineFont'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface CaptionWord {
  text: string
  /** When he starts saying it, on the raw video's timeline. */
  start: number
  end: number
}

/** A word as a caption shows it: no surrounding spaces, and no commas or
 *  full stops trailing it - TikTok's word captions drop them - while ? and !
 *  stay, since they change how the word reads. */
export function cleanWord(text: string): string {
  return text.trim().replace(/^[,.;:"“”]+|[,.;:"“”]+$/g, '')
}

/** Everything a bare caption leaves off: what is left of the punctuation
 *  once cleanWord has had its go - ? and ! - and quotes, brackets and the
 *  like. Dots and commas are dealt with on their own (numbers keep theirs). */
const BARE_OFF = /[!?¡¿;:…"“”„«»()[\]{}]/

/** A word with no punctuation at all, for when he wants his captions bare:
 *  "what?!" is "what". What belongs to the word stays - the apostrophe in
 *  "don't", the hyphen in "well-known", the point in "2.5" and the comma in
 *  "10,000" - and so do %, $ and the like. */
export function bareWord(text: string): string {
  const chars = [...cleanWord(text)]
  const digit = (c: string | undefined) => c !== undefined && /\d/.test(c)
  const kept = chars.filter((c, i) => {
    if (c === '.' || c === ',') return digit(chars[i - 1]) && digit(chars[i + 1])
    return !BARE_OFF.test(c)
  })
  return kept.join('').replace(/^['‘’\-–—]+|['‘’\-–—]+$/g, '').trim()
}

/** The captions as they will be drawn: bare when he asked for no
 *  punctuation, with any word that was nothing but punctuation left out. */
export function drawnWords(words: CaptionWord[], bare: boolean): CaptionWord[] {
  if (!bare) return words
  return words.map((w) => ({ ...w, text: bareWord(w.text) })).filter((w) => w.text)
}

/** How late the letter model marks a word it has aligned (align.ts): its
 *  starts sat a median 20-48 ms after his voice starts on seven of his takes,
 *  the frame or two it takes to be sure of a letter. */
export const ALIGNED_LATE_SEC = 0.035

/** How late the speech model (whisper-tiny.en) puts each word, when the
 *  letter model could not time them. Measured on
 *  four of his real takes against a forced alignment of the same words -
 *  itself within 30 ms of where his voice visibly starts - the model's
 *  starts were a median 0.21-0.24 s late on every one, and its ends later
 *  still. Taken off, a caption lands on the word rather than after it: 68%
 *  of words within 0.1 s, against 3% before. */
export const HEARD_LATE_SEC = 0.22

/** The words as said, for captions: each brought back to when it is really
 *  said, and the pieces of one written apart put back together - the model
 *  hears "2.8%" as "2", ".8" and "%", and a caption each is nonsense. A
 *  piece is anything that doesn't start with a space. */
export function spokenWords(heard: WordChunk[], lateBy = HEARD_LATE_SEC): WordChunk[] {
  const out: WordChunk[] = []
  for (const w of heard) {
    const start = Math.max(0, w.start - lateBy)
    const end = Math.max(start, w.end - lateBy)
    const previous = out[out.length - 1]
    if (previous && !/^\s/.test(w.text) && start - previous.end < 0.6) {
      out[out.length - 1] = { ...previous, text: previous.text + w.text, end: Math.max(previous.end, end) }
    } else out.push({ text: w.text, start, end })
  }
  return out
}

/** How far a word's start may move to meet the moment his voice starts. */
const SNAP_SEC = 0.12

/** Moves each word's start onto the moment his voice actually starts, when
 *  there is one close by: the model's word times can be a tenth of a second
 *  off, and a caption that pops before or after the word is heard looks
 *  wrong at once. Only a start coming out of quiet has such a moment - in
 *  the middle of a sentence one word runs into the next - so the rest are
 *  left alone. */
export function snapToOnsets(words: WordChunk[], levels: Level[], quietBelowDb: number): WordChunk[] {
  if (levels.length < 2) return words
  const onsets: number[] = []
  for (let i = 1; i < levels.length; i++) {
    if (levels[i - 1].db < quietBelowDb && levels[i].db >= quietBelowDb) onsets.push(levels[i].time)
  }
  if (onsets.length === 0) return words
  return words.map((word) => {
    let best: number | null = null
    for (const onset of onsets) {
      if (Math.abs(onset - word.start) <= SNAP_SEC && (best === null || Math.abs(onset - word.start) < Math.abs(best - word.start))) {
        best = onset
      }
    }
    if (best === null) return word
    return { ...word, start: best, end: Math.max(word.end, best + 0.05) }
  })
}

/** The least time a word is up. The model sometimes crowds two or three
 *  words into the same instant, and a word up for less than a frame is
 *  never seen at all. */
export const MIN_SHOW_SEC = 0.1

/** A word starting this close before a kept stretch is in it: a word's
 *  start can be a little early. */
const EARLY_SEC = 0.1
/** The model runs the last word before a pause on into the pause - "month."
 *  said at 4.62 s, heard at 4.88 s, after the cut at 4.72 s - so a word
 *  starting this soon after a kept stretch ends still belongs to it. Measured
 *  on his takes: 34 real words in 461 lost without this, 7 with it. */
const LATE_SEC = 0.25
/** Never pulled back like that: an "um" or a stumble was cut on purpose. */
const CUT_ON_PURPOSE = new Set(['um', 'uh', 'er', 'erm', 'ah', 'hmm', 'mm'])

/** The captions for a video: every word heard that is still in it once the
 *  pauses (and any "um"s) are cut. Punctuation stays - it is what the
 *  phrases are split on when he checks them - and comes off only as a word
 *  is drawn. */
export function captionWords(words: WordChunk[], keep: Range[]): CaptionWord[] {
  const bare = (w: WordChunk | undefined) => (w ? cleanWord(w.text).toLowerCase() : '')
  const captions: CaptionWord[] = []
  words.forEach((w, i) => {
    const text = w.text.trim()
    if (!cleanWord(text)) return
    if (keep.some((r) => w.start + EARLY_SEC >= r.start && w.start + EARLY_SEC < r.end)) {
      captions.push({ text, start: w.start, end: w.end })
      return
    }
    const repeated = bare(w) === bare(words[i - 1]) || bare(w) === bare(words[i + 1])
    const before = keep.find((r) => w.start >= r.end && w.start <= r.end + LATE_SEC)
    if (before && !repeated && !CUT_ON_PURPOSE.has(bare(w))) {
      // Back inside the stretch it was said in.
      const start = Math.max(before.start, before.end - MIN_SHOW_SEC)
      captions.push({ text, start, end: Math.max(start + MIN_SHOW_SEC, Math.min(w.end, before.end)) })
    }
  })
  // In time order, always - each is placed on the cut video in turn - and
  // each up long enough to be seen.
  for (let i = 1; i < captions.length; i++) {
    const earliest = captions[i - 1].start + MIN_SHOW_SEC
    if (captions[i].start < earliest) {
      captions[i] = { ...captions[i], start: earliest, end: Math.max(captions[i].end, earliest + MIN_SHOW_SEC) }
    }
  }
  return captions
}

/** Longest phrase, in words - about what TikTok's own captions show. */
const PHRASE_WORDS = 5
/** A pause this long starts a new phrase. */
const PHRASE_PAUSE_SEC = 0.5

/** The captions in phrases, the way he checks them: a new one after a full
 *  stop, a question or a pause, and after a comma once there are a few
 *  words. Anything longer than PHRASE_WORDS is split evenly - "putting this
 *  on / is gonna fix it", never a word left on its own. */
export function phrasesOf(words: CaptionWord[]): CaptionWord[][] {
  const runs: CaptionWord[][] = []
  let run: CaptionWord[] = []
  words.forEach((w, i) => {
    const previous = words[i - 1]
    if (run.length > 0 && previous) {
      const said = previous.text.trim()
      const breaks =
        /[.?!…]["”')]*$/.test(said) ||
        (/[,;:]["”')]*$/.test(said) && run.length >= 3) ||
        w.start - previous.end > PHRASE_PAUSE_SEC
      if (breaks) {
        runs.push(run)
        run = []
      }
    }
    run.push(w)
  })
  if (run.length > 0) runs.push(run)
  return runs.flatMap((r) => {
    const size = Math.ceil(r.length / Math.ceil(r.length / PHRASE_WORDS))
    const parts: CaptionWord[][] = []
    for (let i = 0; i < r.length; i += size) parts.push(r.slice(i, i + size))
    return parts
  })
}

/** A phrase as he typed it, made back into timed words. The same number of
 *  words keeps every word's moment; more or fewer share the phrase's time
 *  out by length, so a word the model missed can simply be typed in. An
 *  emptied phrase keeps its moments with nothing to show, so it can be
 *  typed back. */
export function retimePhrase(phrase: CaptionWord[], text: string): CaptionWord[] {
  const typed = text.trim().split(/\s+/).filter(Boolean)
  if (phrase.length === 0) return []
  if (typed.length === 0) return phrase.map((w) => ({ ...w, text: '' }))
  if (typed.length === phrase.length) return phrase.map((w, i) => ({ ...w, text: typed[i] }))
  const from = phrase[0].start
  const to = Math.max(phrase[phrase.length - 1].end, from + typed.length * MIN_SHOW_SEC)
  const weights = typed.map((t) => t.length + 2)
  const total = weights.reduce((a, b) => a + b, 0)
  let at = from
  return typed.map((t, i) => {
    const start = at
    at += ((to - from) * weights[i]) / total
    return { text: t, start, end: at }
  })
}

/** Where a moment on the raw video lands in the cut one, going by the
 *  ranges kept. A moment in a gap that was cut lands where the next range
 *  starts. */
export function cutTime(raw: number, keep: Range[]): number {
  let t = 0
  for (const r of keep) {
    if (raw <= r.start) return t
    if (raw < r.end) return t + (raw - r.start)
    t += r.end - r.start
  }
  return t
}

/** Which of `words` get a caption: none while the headline is up - the
 *  hook reads on its own - so the captions start with the first word said
 *  once it has gone. `hookSec` is how long the headline shows, 0 for none. */
export function captionedIndices(words: CaptionWord[], keep: Range[], hookSec: number): number[] {
  const shown: number[] = []
  words.forEach((w, i) => {
    if (cutTime(w.start, keep) >= hookSec) shown.push(i)
  })
  return shown
}

/** Shown a touch before the word is heard: a picture arriving with the
 *  sound reads as late. */
export const CAPTION_LEAD = 0.05
/** Longest a word stays up past its own end when nothing follows soon. */
const HOLD_SEC = 0.35

/** Which word is up at output time `t`, given each word's placed output
 *  start and its length, or -1 for none. A word stays until the next one
 *  comes in, or a little past its own end. Words with no text - taken out
 *  when checking - show nothing. */
export function captionAt(starts: readonly number[], words: CaptionWord[], t: number): number {
  const at = t + CAPTION_LEAD
  let i = -1
  for (let k = 0; k < starts.length; k++) {
    if (starts[k] <= at) i = k
    else break
  }
  if (i < 0) return -1
  const length = Math.max(0.05, words[i].end - words[i].start)
  const until = Math.min(i + 1 < starts.length ? starts[i + 1] : Infinity, starts[i] + length + HOLD_SEC)
  if (at >= until) return -1
  return cleanWord(words[i].text) ? i : -1
}

/** The pop: from a little small to a touch big and back, over about a
 *  fifth of a second - quick enough to land on the word, not linger. */
export function popScale(since: number): number {
  if (since <= 0) return 0.78
  if (since < 0.09) {
    const p = since / 0.09
    return 0.78 + 0.3 * (1 - (1 - p) ** 3)
  }
  if (since < 0.2) {
    const p = (since - 0.09) / 0.11
    return 1.08 - 0.08 * (p * p * (3 - 2 * p))
  }
  return 1
}

/** One word, big and centred below his face, clear of TikTok's buttons and
 *  caption. */
const CAPTION_Y = 0.63
const CAPTION_SIZE = 0.088
const CAPTION_WEIGHT = 800
/** The light edge: a thin black line round each letter. */
const EDGE = 0.1

/** Draws `text` as the caption, `since` seconds after it came in - with no
 *  punctuation at all when `bare`. */
export function drawCaption(ctx: Ctx, width: number, height: number, text: string, since: number, bare = false): void {
  const word = bare ? bareWord(text) : cleanWord(text)
  if (!word) return
  const base = Math.min(width, height * (9 / 16))
  let fontPx = Math.round(base * CAPTION_SIZE)
  ctx.save()
  ctx.font = `${CAPTION_WEIGHT} ${fontPx}px ${HEADLINE_FAMILY}`
  // A long word shrinks to fit rather than running off the side.
  const maxWidth = width * 0.84
  const measured = ctx.measureText(word).width
  if (measured > maxWidth) {
    fontPx = Math.floor(fontPx * (maxWidth / measured))
    ctx.font = `${CAPTION_WEIGHT} ${fontPx}px ${HEADLINE_FAMILY}`
  }
  const scale = popScale(since)
  const x = width / 2
  const y = height * CAPTION_Y
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.globalAlpha = Math.min(1, Math.max(0, since / 0.04))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.shadowColor = 'rgb(0 0 0 / 0.35)'
  ctx.shadowBlur = fontPx * 0.12
  ctx.lineWidth = fontPx * EDGE
  ctx.strokeStyle = '#000000'
  ctx.strokeText(word, 0, 0)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(word, 0, 0)
  ctx.restore()
}
