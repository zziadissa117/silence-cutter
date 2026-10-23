// Captions burned into a campaign video, in TikTok Sans, white with a light
// black edge. Two styles: one word at a time, popping in the moment he says
// it; or Highlight - the phrase up at once, the word being said lit yellow.
//
// The words come from the listen that sorted the video. He checks them
// before the video is made, a phrase at a time the way TikTok's own caption
// editor shows them, and fixes whatever the model misheard - so what is
// burned in is what he approved. A phrase keeps its moment; words typed
// into it share its time out between them.

import { isFillerWord, type WordChunk } from '../media/fillerWords'
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
/** The same when only the speech model timed the words - the letter model
 *  could not run on the phone that day. Its words run on a median 0.22 s
 *  late and scatter a further ±0.2 s, so 0.25 s lost the last word of a
 *  phrase whenever it ran late; this is that scatter on top. */
const ROUGH_LATE_SEC = 0.5
/** The last words of the whole take, heard after the last kept stretch:
 *  nothing was said after them, so there is nothing else they could belong
 *  to. "...link in bio." was the word most often missing. */
const LAST_WORDS_SEC = 1.0
/** A word starting up to this long before a kept stretch, in the pause cut
 *  before it, whose sound runs on into the stretch, is in the video: a soft
 *  first sound ("so", "hey", "for") sits under the line the pauses are found
 *  with, so the stretch starts a moment after the word does. */
const EARLY_RUN_SEC = 0.6
/** How much of such a word must be in the stretch to count as heard there. */
const EARLY_RUN_IN_SEC = 0.05
/** A sentence's first word timed a little early - short ones ("And", "I",
 *  "So") often end just before their stretch by the model's clock - is
 *  still its first word when it ends this close to the stretch and the
 *  sentence before has ended. Without this every sentence lost its first
 *  word on some takes ("the captions cut off at the start of every
 *  sentence", 2026-10-19). */
const EARLY_END_SEC = 0.25
/** The least time each of a sentence's last words is up. Squeezed into the
 *  stretch's final 0.1 s, a last word heard late flashed for two or three
 *  frames and read as cut off ("...and finish of every sentence"); a
 *  quarter of a second is about a word's own length when he talks. */
const READ_SEC = 0.25
/** The captions for a video: every word heard that is still in it once the
 *  pauses are cut - never an "um" or an "uh", cut or not: TikTok's own
 *  captions leave them off, and one left in reads as a mistake. Punctuation
 *  stays - it is what the phrases are split on when he checks them - and
 *  comes off only as a word is drawn. */
export function captionWords(words: WordChunk[], keep: Range[], { rough = false }: { rough?: boolean } = {}): CaptionWord[] {
  const bare = (w: WordChunk | undefined) => (w ? cleanWord(w.text).toLowerCase() : '')
  const endsSentence = (w: WordChunk | undefined) => Boolean(w && /[.?!…]["”')]*$/.test(w.text.trim()))
  const captions: CaptionWord[] = []
  const last = keep.reduce<Range | undefined>((a, r) => (!a || r.end > a.end ? r : a), undefined)
  const rescued = new Map<Range, number>()
  words.forEach((w, i) => {
    const text = w.text.trim()
    if (!cleanWord(text) || isFillerWord(text)) return
    // Early by up to EARLY_SEC still counts as in; a word starting in the last
    // moment of a stretch is in it too (the shifted check used to push those
    // past the end, where nothing caught them, and the sentence lost its
    // last word).
    if (keep.some((r) => w.start + EARLY_SEC >= r.start && w.start < r.end)) {
      captions.push({ text, start: w.start, end: w.end })
      return
    }
    const repeated = bare(w) === bare(words[i - 1]) || bare(w) === bare(words[i + 1])
    const into = keep.find((r) => w.start < r.start && r.start - w.start <= EARLY_RUN_SEC && w.end >= r.start + EARLY_RUN_IN_SEC)
    if (into && !repeated) {
      captions.push({ text, start: into.start, end: Math.max(w.end, into.start + MIN_SHOW_SEC) })
      return
    }
    // A sentence's first word that ends just before its stretch: kept when it
    // can't be the last word of the sentence before - that one has ended, or
    // is too far back - and it is not a stumble.
    const next = keep.find((r) => w.start < r.start && r.start - w.start <= EARLY_RUN_SEC && w.end >= r.start - EARLY_END_SEC)
    const previousRange = keep.filter((r) => r.end <= w.start).reduce<Range | undefined>((a, r) => (!a || r.end > a.end ? r : a), undefined)
    const belongsBefore = previousRange && w.start - previousRange.end <= LATE_SEC && !endsSentence(words[i - 1])
    if (next && !belongsBefore && !repeated) {
      captions.push({ text, start: next.start, end: Math.max(w.end, next.start + MIN_SHOW_SEC) })
      return
    }
    // A last word heard late: half a second when it carries on a sentence
    // that hasn't ended yet - the letter model's timing runs that late on
    // the last word before a pause too - otherwise the tighter window.
    const late = rough || !endsSentence(words[i - 1]) ? ROUGH_LATE_SEC : LATE_SEC
    const before =
      keep.find((r) => w.start >= r.end && w.start <= r.end + late) ??
      (last && w.start >= last.end && w.start <= last.end + LAST_WORDS_SEC ? last : undefined)
    if (before && !repeated) {
      // Back inside the stretch it was said in - the ones before it pulled
      // back too, so two or three heard late each still get their moment.
      const pulled = (rescued.get(before) ?? 0) + 1
      rescued.set(before, pulled)
      captions.push({ text, start: before.end, end: before.end })
    }
  })
  // Each stretch's pulled-back words, the last of them ending with it.
  for (const [range, count] of rescued) {
    const at = captions.filter((c) => c.start === range.end && c.end === range.end)
    at.forEach((c, k) => {
      const start = Math.max(range.start, range.end - (count - k) * MIN_SHOW_SEC)
      c.start = start
      c.end = Math.max(start + MIN_SHOW_SEC * 0.999, Math.min(range.end, start + MIN_SHOW_SEC))
    })
  }
  // In time order, always - each is placed on the cut video in turn - and
  // each up long enough to be seen.
  for (let i = 1; i < captions.length; i++) {
    const earliest = captions[i - 1].start + MIN_SHOW_SEC
    if (captions[i].start < earliest) {
      captions[i] = { ...captions[i], start: earliest, end: Math.max(captions[i].end, earliest + MIN_SHOW_SEC) }
    }
  }
  // Each stretch's last words up long enough to read: walked back from where
  // the stretch is cut, each starts at least READ_SEC before the next - or
  // the stretch's end - while there is room, the earlier ones moving up a
  // little to make it. They are words the model times late anyway.
  // A word the in-order pass nudged to or past the cut still belongs to
  // this stretch - up to where the next one starts.
  const ordered = [...keep].sort((a, b) => a.start - b.start)
  for (const [r, range] of ordered.entries()) {
    const until = ordered[r + 1]?.start ?? Infinity
    const inside = captions.map((_, k) => k).filter((k) => captions[k].start >= range.start && captions[k].start < until)
    if (inside.length === 0) continue
    const room = range.end - range.start
    const read = Math.min(READ_SEC, room / inside.length)
    let nextStart = range.end
    for (let j = inside.length - 1; j >= 0; j--) {
      const k = inside[j]
      const latest = nextStart - read
      if (captions[k].start <= latest) break
      const start = Math.max(range.start, latest)
      captions[k] = { ...captions[k], start, end: Math.max(start + read * 0.999, Math.min(captions[k].end, nextStart)) }
      nextStart = start
    }
  }
  // The video ends where the last kept stretch does: a word starting after
  // that is placed after the end and never seen (timeline.ts MomentPlacer).
  // So the last few are fitted in before it, each still up long enough -
  // squeezed only as much as the stretch allows.
  if (last) {
    for (let i = captions.length - 1, room = 1; i >= 0 && captions[i].start > last.end - room * MIN_SHOW_SEC; i--, room++) {
      const start = Math.max(last.start, last.end - room * MIN_SHOW_SEC)
      if (start >= captions[i].start) break
      captions[i] = { ...captions[i], start, end: Math.min(captions[i].end, start + MIN_SHOW_SEC) }
    }
  }
  return captions
}

/** The captions he has fixed, after a change to the cuts: words he could not
 *  see before - in a part he has just brought back - come back from what was
 *  heard, in their place. His fixes stay; words in parts he cut go with them
 *  when the captions are next put through the cut (captionWords). */
export function withRestored(captions: CaptionWord[], heard: WordChunk[], before: Range[], after: Range[]): CaptionWord[] {
  const overlaps = (w: { start: number; end: number }, keep: Range[]) => keep.some((r) => w.end > r.start && w.start < r.end)
  const back = heard.filter((w) => cleanWord(w.text) && !isFillerWord(w.text) && !overlaps(w, before) && overlaps(w, after))
  if (back.length === 0) return captions
  const fresh = back
    .filter((w) => !captions.some((c) => Math.abs(c.start - w.start) < 0.05 && bareWord(c.text).toLowerCase() === bareWord(w.text).toLowerCase()))
    .map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }))
  return [...captions, ...fresh].sort((a, b) => a.start - b.start)
}

/** Longest phrase, in words - about what TikTok's own captions show. */
const PHRASE_WORDS = 5
/** A pause this long starts a new phrase. */
const PHRASE_PAUSE_SEC = 0.5

/** The captions in phrases, the way he checks them: a new one after a full
 *  stop, a question or a pause, and after a comma once there are a few
 *  words. Anything longer than PHRASE_WORDS is split evenly - "putting this
 *  on / is gonna fix it", never a word left on its own. */
export function phrasesOf(words: CaptionWord[], maxWords = PHRASE_WORDS): CaptionWord[][] {
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
    const size = Math.ceil(r.length / Math.ceil(r.length / maxWords))
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
 *  hook reads on its own - so the captions start once it has gone. They
 *  start with a whole phrase, never in the middle of one: cut at the exact
 *  second, "This app changed my life" with the headline going just after
 *  "This" came out as "app changed my life", and he typed the first word
 *  back in by hand on most videos. A phrase mostly said after the headline
 *  is captioned whole - its first word or two can show as the headline
 *  goes - one mostly said under it is left out whole. `hookSec` is how long
 *  the headline shows, 0 for none. */
export function captionedIndices(words: CaptionWord[], keep: Range[], hookSec: number): number[] {
  if (hookSec <= 0) return words.map((_, i) => i)
  const shown: number[] = []
  let first = 0
  for (const phrase of phrasesOf(words)) {
    const after = phrase.filter((w) => cutTime(w.start, keep) >= hookSec).length
    if (after > 0 && after * 2 >= phrase.length) phrase.forEach((_, k) => shown.push(first + k))
    first += phrase.length
  }
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
 *  caption. Was 0.63; he found that a little high (2026-10-16). */
const CAPTION_Y = 0.66

/** Where the caption sits, so it can be moved off his face: up near the top,
 *  across the middle, where it has always been ("usual"), or low. The
 *  numbers are the caption's centre as a share of the video's height. */
export type CaptionPosition = 'top' | 'middle' | 'usual' | 'bottom'

export const CAPTION_POSITIONS: { id: CaptionPosition; label: string; y: number }[] = [
  { id: 'top', label: 'Top', y: 0.2 },
  { id: 'middle', label: 'Middle', y: 0.5 },
  { id: 'usual', label: 'Usual', y: CAPTION_Y },
  { id: 'bottom', label: 'Bottom', y: 0.8 },
]

export function captionY(position: CaptionPosition): number {
  return CAPTION_POSITIONS.find((p) => p.id === position)?.y ?? CAPTION_Y
}

/** How big the caption is, as a share of the video's width (see CAPTION_SIZE:
 *  "normal" is what captions have always been). */
export type CaptionSize = 'small' | 'normal' | 'large' | 'huge'

export const CAPTION_SIZES: { id: CaptionSize; label: string; scale: number }[] = [
  { id: 'small', label: 'Small', scale: 0.75 },
  { id: 'normal', label: 'Normal', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.25 },
  { id: 'huge', label: 'Huge', scale: 1.55 },
]

export function captionScale(size: CaptionSize): number {
  return CAPTION_SIZES.find((s) => s.id === size)?.scale ?? 1
}

const SIZE_KEY = 'cutter-caption-size'

/** The size new videos start with: his choice in Settings, else normal. */
export function defaultCaptionSize(): CaptionSize {
  try {
    const saved = localStorage.getItem(SIZE_KEY)
    if (CAPTION_SIZES.some((s) => s.id === saved)) return saved as CaptionSize
  } catch {
    // Storage blocked: the usual size.
  }
  return 'normal'
}

export function setDefaultCaptionSize(size: CaptionSize): void {
  try {
    localStorage.setItem(SIZE_KEY, size)
  } catch {
    // Not saved.
  }
}

const POSITION_KEY = 'cutter-caption-position'

/** The position new videos start with: his choice in Settings, else usual. */
export function defaultCaptionPosition(): CaptionPosition {
  try {
    const saved = localStorage.getItem(POSITION_KEY)
    if (CAPTION_POSITIONS.some((p) => p.id === saved)) return saved as CaptionPosition
  } catch {
    // Storage blocked: the usual place.
  }
  return 'usual'
}

export function setDefaultCaptionPosition(position: CaptionPosition): void {
  try {
    localStorage.setItem(POSITION_KEY, position)
  } catch {
    // Not saved.
  }
}
const CAPTION_SIZE = 0.088
const CAPTION_WEIGHT = 800
/** The light edge: a thin black line round each letter. */
const EDGE = 0.1

/** Draws `text` as the caption, `since` seconds after it came in - with no
 *  punctuation at all when `bare`. */
export function drawCaption(
  ctx: Ctx,
  width: number,
  height: number,
  text: string,
  since: number,
  bare = false,
  position: CaptionPosition = 'usual',
  size: CaptionSize = 'normal',
): void {
  const word = bare ? bareWord(text) : cleanWord(text)
  if (!word) return
  const base = Math.min(width, height * (9 / 16))
  let fontPx = Math.round(base * CAPTION_SIZE * captionScale(size))
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
  const y = height * captionY(position)
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

// --- Highlight ----------------------------------------------------------------
//
// The phrase is on screen at once and the word being said lights up. Which
// word is up still comes from captionAt, so the lead, the hold, words taken
// out and the hook all work exactly as for one word at a time.

export type CaptionStyle = 'word' | 'highlight' | 'phrase'

export const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: 'word', label: 'One word' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'phrase', label: 'Phrase' },
]

const STYLE_KEY = 'cutter-caption-style'

/** The style new videos start with: the last one he picked, else one word. */
export function defaultCaptionStyle(): CaptionStyle {
  try {
    const saved = localStorage.getItem(STYLE_KEY)
    if (CAPTION_STYLES.some((s) => s.id === saved)) return saved as CaptionStyle
  } catch {
    // Storage blocked: one word.
  }
  return 'word'
}

export function setDefaultCaptionStyle(style: CaptionStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, style)
  } catch {
    // Not saved.
  }
}

/** A phrase of at most this many words fits two lines at the normal size. */
export const HIGHLIGHT_WORDS = 4

/** Each phrase as [first, end) indexes into `words` - phrasesOf, kept as
 *  positions so the word captionAt picks can be found in its phrase. */
export function phraseRanges(words: CaptionWord[], maxWords = HIGHLIGHT_WORDS): [number, number][] {
  const ranges: [number, number][] = []
  let at = 0
  for (const phrase of phrasesOf(words, maxWords)) {
    ranges.push([at, at + phrase.length])
    at += phrase.length
  }
  return ranges
}

/** A plain phrase is smaller, so more of it fits two lines. */
export const PLAIN_PHRASE_WORDS = 7

/** The phrases a style shows, worked out once per video: the highlight's
 *  short ones, the plain style's longer ones. One word at a time uses none,
 *  but gets the highlight's so the review can switch styles freely. */
export function captionRanges(words: CaptionWord[], style: CaptionStyle): [number, number][] {
  return phraseRanges(words, style === 'phrase' ? PLAIN_PHRASE_WORDS : HIGHLIGHT_WORDS)
}

/** The phrase word `index` is in, or null. */
export function phraseAt(ranges: readonly [number, number][], index: number): [number, number] | null {
  if (index < 0) return null
  return ranges.find(([from, to]) => index >= from && index < to) ?? null
}

/** The lit word. */
const HIGHLIGHT_FILL = '#FFE14D'
/** A phrase's words are smaller than a lone word, to fit two lines. */
const PHRASE_SIZE = 0.85
const LINE_HEIGHT = 1.12

/** Draws a phrase with word `active` lit, `since` seconds after that word
 *  came in. Laid out once for the whole phrase - left to right, at most two
 *  centred lines - so the words never move while it is up. */
export function drawPhrase(
  ctx: Ctx,
  width: number,
  height: number,
  phrase: CaptionWord[],
  active: number,
  since: number,
  bare = false,
  position: CaptionPosition = 'usual',
  size: CaptionSize = 'normal',
): void {
  const texts = phrase.map((w) => (bare ? bareWord(w.text) : cleanWord(w.text)))
  const shown = texts.map((t, i) => ({ t, i })).filter((w) => w.t !== '')
  if (shown.length === 0) return
  const base = Math.min(width, height * (9 / 16))
  let fontPx = Math.round(base * CAPTION_SIZE * captionScale(size) * PHRASE_SIZE)
  const maxWidth = width * 0.84
  ctx.save()
  const font = () => `${CAPTION_WEIGHT} ${fontPx}px ${HEADLINE_FAMILY}`
  ctx.font = font()
  // A word too long for a line on its own shrinks everything to fit it.
  const widest = Math.max(...shown.map((w) => ctx.measureText(w.t).width))
  if (widest > maxWidth) {
    fontPx = Math.floor(fontPx * (maxWidth / widest))
    ctx.font = font()
  }
  // A little more than a space between words, so the lit word's pop never
  // touches its neighbours - used for wrapping and drawing alike.
  const spacing = () => ctx.measureText(' ').width * 1.35
  let space = spacing()
  const widths = shown.map((w) => ctx.measureText(w.t).width)
  // Into lines: as many words as fit, then the rest on a second line - and
  // if they still do not fit, smaller rather than a third line.
  const lay = (): number[][] => {
    const lines: number[][] = [[]]
    let used = 0
    shown.forEach((_, k) => {
      const line = lines[lines.length - 1]
      const need = (line.length > 0 ? space : 0) + widths[k]
      if (line.length > 0 && used + need > maxWidth) {
        lines.push([k])
        used = widths[k]
      } else {
        line.push(k)
        used += need
      }
    })
    return lines
  }
  let lines = lay()
  if (lines.length > 2) {
    const total = widths.reduce((a, b) => a + b, 0) + space * (shown.length - 1)
    const factor = Math.max(0.5, (maxWidth * 2) / total) * 0.98
    fontPx = Math.floor(fontPx * Math.min(1, factor))
    ctx.font = font()
    space = spacing()
    widths.splice(0, widths.length, ...shown.map((w) => ctx.measureText(w.t).width))
    lines = lay()
  }
  const gap = space
  const lineGap = fontPx * LINE_HEIGHT
  const centreY = height * captionY(position)
  const firstY = centreY - ((lines.length - 1) * lineGap) / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.globalAlpha = 1
  lines.forEach((line, row) => {
    const lineWidth = line.reduce((sum, k) => sum + widths[k], 0) + gap * (line.length - 1)
    let x = width / 2 - lineWidth / 2
    const y = firstY + row * lineGap
    for (const k of line) {
      const cx = x + widths[k] / 2
      const lit = shown[k].i === active
      ctx.save()
      ctx.translate(cx, y)
      // The lit word pops as it comes in, then sits at its own size: the
      // colour carries it, and the layout never has to make room.
      if (lit) {
        const scale = Math.max(1, popScale(since))
        ctx.scale(scale, scale)
      }
      ctx.shadowColor = 'rgb(0 0 0 / 0.35)'
      ctx.shadowBlur = fontPx * 0.12
      ctx.lineWidth = fontPx * EDGE
      ctx.strokeStyle = '#000000'
      ctx.strokeText(shown[k].t, 0, 0)
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = lit ? HIGHLIGHT_FILL : '#ffffff'
      ctx.fillText(shown[k].t, 0, 0)
      ctx.restore()
      x += widths[k] + gap
    }
  })
  ctx.restore()
}

// --- Phrase ------------------------------------------------------------------
//
// The plainest style, for brands that want nothing busy: the whole phrase is
// up from its first word until the next phrase, white with a black outline
// exactly like TikTok's headline, all lowercase and a little smaller - no
// lit word, no pop, no shadow. Two lines at most.

/** The headline's own weight and outline (overlay.ts), so the two match. */
const PLAIN_WEIGHT = 600
const PLAIN_STROKE = 0.14
/** A little smaller than a medium headline (0.066 of the width). */
const PLAIN_SIZE = 0.058
const PLAIN_LINE_HEIGHT = 1.18

/** The words of a plain phrase, two lines at most: the layout, apart from
 *  the drawing so it is tested on its own. */
export function layoutPlainPhrase(
  measure: (text: string, fontPx: number) => number,
  width: number,
  height: number,
  phrase: CaptionWord[],
  bare = false,
  size: CaptionSize = 'normal',
): { lines: string[]; fontPx: number } | null {
  const words = phrase.map((w) => (bare ? bareWord(w.text) : cleanWord(w.text)).toLowerCase()).filter((t) => t !== '')
  if (words.length === 0) return null
  const base = Math.min(width, height * (9 / 16))
  const maxWidth = width * 0.84
  const lay = (fontPx: number): string[] => {
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (line && measure(next, fontPx) > maxWidth) {
        lines.push(line)
        line = word
      } else line = next
    }
    if (line) lines.push(line)
    return lines
  }
  let fontPx = Math.round(base * PLAIN_SIZE * captionScale(size))
  let lines = lay(fontPx)
  // Smaller rather than a third line, or a word wider than the frame.
  while ((lines.length > 2 || lines.some((l) => measure(l, fontPx) > maxWidth)) && fontPx > 12) {
    fontPx = Math.floor(fontPx * 0.92)
    lines = lay(fontPx)
  }
  return { lines, fontPx }
}

export function drawPlainPhrase(
  ctx: Ctx,
  width: number,
  height: number,
  phrase: CaptionWord[],
  bare = false,
  position: CaptionPosition = 'usual',
  size: CaptionSize = 'normal',
): void {
  const font = (px: number) => `${PLAIN_WEIGHT} ${px}px ${HEADLINE_FAMILY}`
  ctx.save()
  const layout = layoutPlainPhrase(
    (text, px) => {
      ctx.font = font(px)
      return ctx.measureText(text).width
    },
    width,
    height,
    phrase,
    bare,
    size,
  )
  if (!layout) {
    ctx.restore()
    return
  }
  const { lines, fontPx } = layout
  const lineGap = fontPx * PLAIN_LINE_HEIGHT
  const firstY = height * captionY(position) - ((lines.length - 1) * lineGap) / 2
  ctx.font = font(fontPx)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.lineWidth = fontPx * PLAIN_STROKE
  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#ffffff'
  lines.forEach((line, row) => {
    const y = firstY + row * lineGap
    ctx.strokeText(line, width / 2, y)
    ctx.fillText(line, width / 2, y)
  })
  ctx.restore()
}

/** Word `index` of `words` as its caption, in `style`: on its own, lit in
 *  its phrase, or with its whole plain phrase (`ranges` from
 *  captionRanges(words, style), worked out once). */
export function drawStyledCaption(
  ctx: Ctx,
  width: number,
  height: number,
  words: CaptionWord[],
  ranges: readonly [number, number][],
  index: number,
  since: number,
  bare: boolean,
  position: CaptionPosition,
  size: CaptionSize,
  style: CaptionStyle,
): void {
  if (style === 'phrase') {
    const range = phraseAt(ranges, index)
    if (range) drawPlainPhrase(ctx, width, height, words.slice(range[0], range[1]), bare, position, size)
    return
  }
  if (style === 'highlight') {
    const range = phraseAt(ranges, index)
    if (range) drawPhrase(ctx, width, height, words.slice(range[0], range[1]), index - range[0], since, bare, position, size)
    return
  }
  drawCaption(ctx, width, height, words[index].text, since, bare, position, size)
}

