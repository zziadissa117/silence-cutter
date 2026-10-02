// Pure silence-detection math, with no browser or codec dependency so it can
// be unit-tested under jsdom like the rest of the data layer. The actual
// decoding lives in silenceCut.ts, which feeds this module a level curve.
//
// The desktop Silence Cutter's algorithm (ffmpeg's silencedetect plus a
// padding pass): find runs where the level stays under a dB threshold for at
// least `minSilenceSec`, then invert those runs into the ranges to keep,
// leaving `paddingSec` of breathing room around each cut so words don't get
// clipped.
//
// Two things here the desktop tool does not do, both because it cut too
// close: the ends of a pause are pulled back to where the sound has really
// died away rather than to where it crossed the threshold, and the silence
// at the very start and end of a video keeps a breath instead of being cut
// flush.

/** One sample of the audio's loudness, in dB, at a point in time. */
export interface Level {
  time: number
  db: number
}

export interface Range {
  start: number
  end: number
}

export interface SilenceSettings {
  /** Below this loudness (in dB) counts as silence. -35 is a reasonable room. */
  thresholdDb: number
  /** A quiet stretch shorter than this is left alone, so speech still breathes. */
  minSilenceSec: number
  /** Kept around every cut, so a word's first or last sound never gets clipped. */
  paddingSec: number
}

/** The desktop tool's three presets, with the padding pulled in.
 *
 *  v1 had to leave a lot of room around every cut because it cut at the
 *  silence line itself, and the end of a word lives below that line. Now
 *  that the ends of a pause are pulled back to where the sound really
 *  stopped (see softenEnds), that room is no longer what protects the word,
 *  and leaving it only left silence behind: measured over takes whose word
 *  boundaries are known exactly, 0.07s of padding left 160ms of every pause
 *  in the cut and removed 78% of the silence, while 0.05s left 120ms and
 *  removed 84% - with no word touched either way. Without the softening,
 *  0.05s ate 50ms off the end of a word, which is the old complaint. */
export const PRESETS = {
  natural: { thresholdDb: -35, minSilenceSec: 0.5, paddingSec: 0.12 },
  balanced: { thresholdDb: -35, minSilenceSec: 0.35, paddingSec: 0.08 },
  tight: { thresholdDb: -35, minSilenceSec: 0.2, paddingSec: 0.04 },
} as const satisfies Record<string, SilenceSettings>

export type PresetName = keyof typeof PRESETS

export const BALANCED_SETTINGS: SilenceSettings = PRESETS.balanced

/** How far a sound has to sit above the room's own hiss to still count as
 *  part of the word.
 *
 *  Speech does not stop dead: an "s" or an "f" trails off, a word starts
 *  softly, and all of that lies under the silence line while still being
 *  part of the word. Cutting at the line takes the ends off words - measured
 *  on a real take, cuts landed within a millisecond of the nearest sound,
 *  with everything quieter than the line gone.
 *
 *  Measuring that against a fixed number doesn't work: in a quiet room a
 *  trailing "s" is far below it, and in a noisy one the room itself sits
 *  above it and every pause looks like speech. So it is measured against
 *  the room: what this take's own background noise is, plus a little. */
const ABOVE_ROOM_DB = 10

/** A word can trail off for this long. Past it, whatever is still there is
 *  room tone, not the end of a word - and following it further only left
 *  silence in the cut. Measured: past 0.1s this protects nothing more. */
const MAX_SOFTEN_SEC = 0.1

/** How far a pause may reach outward, through sound under the line he set,
 *  to take the fade either side of it along with the pause.
 *
 *  A pause is found against the strict line, so it can never start inside a
 *  quiet word - but it still has to reach out through the fade, or a third
 *  of a second of pause is left behind at every cut and it reads as "it did
 *  not cut". A fade is over in about a tenth of a second, which is what
 *  this allows. The cost of being wrong is bounded and small: where the
 *  sound outside a pause is a quietly spoken word rather than a fade, at
 *  most this much of its tail is at stake, and softenEnds gives most of
 *  that back. */
const MAX_GROW_SEC = 0.12

/** The line between speech and a pause sits halfway between this take's
 *  room and how loud he actually talks in it.
 *
 *  A fixed line cannot do this job. On a real take the room sat at -54 dB,
 *  the pauses at -47 to -73, and the quieter words - "Trump.", "in market
 *  cap" - at -35 to -39, under the -35 dB line. Every window of those words
 *  counted as silence, and enough ran together that the words were cut out
 *  of the video: the transcript of the cut read "make bank off of / if you
 *  aren't aware" where he had said "make bank off of Trump. If you aren't
 *  aware." Halfway between -54 and his speaking level puts the line at
 *  about -42, below those words and above the pauses.
 *
 *  Loudness varies far more between rooms and phones than between people,
 *  which is why this is measured per take rather than set once. */
const ROOM_PERCENTILE = 0.1
const SPEECH_PERCENTILE = 0.9

/** The line never moves above where he put the slider - that stays the most
 *  aggressive it will be - nor further below it than this, so a take with
 *  almost no sound in it doesn't end up with a line so low that no pause
 *  ever counts. */
const MAX_LINE_DROP_DB = 15

/** A level this take sits at or below for the given share of its length. */
function percentileDb(levels: Level[], share: number): number {
  const heard = levels.map((l) => l.db).filter((db) => Number.isFinite(db)).sort((a, b) => a - b)
  if (heard.length === 0) return -Infinity
  return heard[Math.min(heard.length - 1, Math.floor(heard.length * share))]
}

/** This take's background noise: the level its quietest tenth sits at.
 *  Silent stretches give it away, and every video has some. */
function roomNoiseDb(levels: Level[]): number {
  return percentileDb(levels, ROOM_PERCENTILE)
}

/** However short a pause is, this much of it is always worth removing -
 *  otherwise protecting both ends would leave nothing to cut. */
const MIN_CUT_SEC = 0.05

/** Pulls the ends of a silence back to where the sound has really died away,
 *  so the cut is measured from the word's true edge rather than from where
 *  it dropped under the silence line.
 *
 *  Two things this must not do. It must not stack on top of `paddingSec`:
 *  both exist to keep the cut off the word, so the budget here is what the
 *  padding does not already cover, and the two together stay within
 *  MAX_SOFTEN_SEC. And it must never ask for more room than the pause has -
 *  the first version of this gave up and used the raw pause whenever the
 *  ends met in the middle, which meant short pauses got no protection at
 *  all while long ones got plenty. Since a take is mostly short pauses,
 *  that read as "it cuts words sometimes", and fixing it read as "it stopped
 *  cutting". It now shrinks to fit instead. */
function softenEnds(silence: Range, levels: Level[], floorDb: number, paddingSec: number): Range {
  const room = (silence.end - silence.start - MIN_CUT_SEC - 2 * paddingSec) / 2
  const budget = Math.max(0, Math.min(MAX_SOFTEN_SEC - paddingSec, room))
  if (budget <= 0) return silence

  const step = levels.length > 1 ? levels[1].time - levels[0].time : 0.02
  let { start, end } = silence
  for (const level of levels) {
    if (level.time < silence.start) continue
    if (level.time > silence.start + budget) break
    if (level.db > floorDb) start = Math.min(level.time + step, silence.start + budget)
  }
  for (let i = levels.length - 1; i >= 0; i--) {
    const level = levels[i]
    if (level.time > silence.end) continue
    if (level.time < silence.end - budget) break
    if (level.db > floorDb) end = Math.max(level.time, silence.end - budget)
  }
  return end > start ? { start, end } : silence
}

/** Runs of consecutive `db < thresholdDb` levels lasting at least
 *  `minSilenceSec`, each pulled in to where the sound actually stops. */
export function findSilentRanges(levels: Level[], settings: SilenceSettings): Range[] {
  const ranges: Range[] = []
  let runStart: number | null = null
  let last: Level | null = null
  const lineDb = silenceLineDb(levels, settings)

  for (const level of levels) {
    const quiet = level.db < lineDb
    if (quiet && runStart === null) {
      runStart = level.time
    } else if (!quiet && runStart !== null) {
      if (last && last.time - runStart >= settings.minSilenceSec) {
        ranges.push({ start: runStart, end: level.time })
      }
      runStart = null
    }
    last = level
  }
  // Found above: the stretches that are unmistakably a pause, judged
  // against the strict line so a quiet word can never start one. Each now
  // grows outward to where the sound crosses the line he actually set,
  // which is where the fade either side of the pause ends. Triggering
  // strictly but extending loosely is what lets a pause be taken out whole
  // without a quiet word ever being mistaken for one.
  //
  // What it may grow through is only the fade itself: sound getting quieter
  // the closer it comes to the pause, for no longer than a fade lasts. A
  // word said quietly holds its level instead of falling away, so it stops
  // the growth dead - without that, a quiet word sitting beside a pause was
  // swallowed by it, which is the same lost-word bug by another route.
  const step = levels.length > 1 ? levels[1].time - levels[0].time : 0.02
  const grow = (range: Range): Range => {
    let { start, end } = range
    // Measured from where the pause was found, not from the edge as it
    // moves, or the limit never bites and the pause grows until it meets
    // speech - which swallows a quietly spoken word whole.
    const foundAt = { start, end }
    for (let i = levels.findIndex((l) => l.time >= start) - 1; i >= 0; i--) {
      if (levels[i].db >= settings.thresholdDb) break
      if (foundAt.start - levels[i].time > MAX_GROW_SEC) break
      start = levels[i].time
    }
    for (let i = levels.findIndex((l) => l.time >= end); i >= 0 && i < levels.length; i++) {
      if (levels[i].db >= settings.thresholdDb) break
      if (levels[i].time - foundAt.end > MAX_GROW_SEC) break
      end = levels[i].time + step
    }
    return { start, end }
  }

  const audioEnd = last ? last.time + step : 0
  if (runStart !== null && last && last.time - runStart >= settings.minSilenceSec) {
    // Silence ran to the end of the file with no loud level to close it. It
    // ends where that last level's own window ends, not where the window
    // starts: a silence that stopped a grain short of the end used to read
    // as an ordinary pause in the middle, and the end of the video was
    // trimmed as tightly as one.
    ranges.push({ start: runStart, end: audioEnd })
  }

  // A click right at the very start or end - the tap that starts or stops
  // the recording - is not him talking. Too short to be a word, and with a
  // real pause between it and his first (or after his last) word, it goes
  // with the silence at that end.
  const first = ranges[0]
  if (first && first.start > 0.01 && first.start <= EDGE_CLICK_SEC) first.start = 0
  const final = ranges[ranges.length - 1]
  if (final && final.end < audioEnd - 0.01 && audioEnd - final.end <= EDGE_CLICK_SEC) final.end = audioEnd

  const floorDb = quietFloorDb(levels, settings)
  const isHead = (range: Range) => range.start <= 0.01
  const isTail = (range: Range) => range.end >= audioEnd - 0.01
  const middle = ranges.filter((r) => !isHead(r) && !isTail(r))
  const edges = ranges
    .filter((r) => isHead(r) !== isTail(r))
    .map((r) => (isHead(r) ? headSilence(r, levels, floorDb) : tailSilence(r, levels, floorDb, step)))
  const whole = ranges.filter((r) => isHead(r) && isTail(r))
  return mergeRanges([
    ...whole,
    ...edges,
    ...mergeRanges(middle.map(grow)).map((range) => softenEnds(range, levels, floorDb, settings.paddingSec)),
  ])
}

/** How far back from his first word, or on from his last, the sound of the
 *  word itself is followed: the soft start of an "h" or an "s", or a word
 *  trailing away. Past this it is room, not the word. */
const EDGE_FADE_SEC = 0.3

/** The silence before his first word, ending where the word's sound really
 *  starts - the moment it rises out of the room - rather than where it
 *  crossed the silence line, which is already partway into a softly spoken
 *  first word. Measured from there, the room left before it can be short
 *  without ever clipping the word. */
function headSilence(range: Range, levels: Level[], floorDb: number): Range {
  let end = range.end
  const from = levels.findIndex((l) => l.time >= range.end)
  for (let i = (from === -1 ? levels.length : from) - 1; i >= 0; i--) {
    if (levels[i].db <= floorDb || range.end - levels[i].time > EDGE_FADE_SEC) break
    end = levels[i].time
  }
  return { start: range.start, end: Math.max(range.start, end) }
}

/** The silence after his last word, starting once the word has faded all
 *  the way into the room. */
function tailSilence(range: Range, levels: Level[], floorDb: number, step: number): Range {
  let start = range.start
  for (let i = levels.findIndex((l) => l.time >= range.start); i >= 0 && i < levels.length; i++) {
    if (levels[i].db <= floorDb || levels[i].time - range.start > EDGE_FADE_SEC) break
    start = levels[i].time + step
  }
  return { start: Math.min(start, range.end), end: range.end }
}

/** Where the line between speech and a pause actually falls for this take:
 *  where he put it, or 12 dB above the room, whichever is lower - see
 *  SPEECH_ABOVE_ROOM_DB - and never more than MAX_LINE_DROP_DB below where
 *  he put it. */
export function silenceLineDb(levels: Level[], settings: SilenceSettings): number {
  const room = roomNoiseDb(levels)
  const speech = percentileDb(levels, SPEECH_PERCENTILE)
  if (!Number.isFinite(room) || !Number.isFinite(speech)) return settings.thresholdDb
  return Math.max(
    Math.min(settings.thresholdDb, (room + speech) / 2),
    settings.thresholdDb - MAX_LINE_DROP_DB,
  )
}

/** The level below which a sound is just this take's room, not a word
 *  trailing off. Never above the line itself - a word tail is quieter than
 *  that by definition. */
function quietFloorDb(levels: Level[], settings: SilenceSettings): number {
  return Math.min(roomNoiseDb(levels) + ABOVE_ROOM_DB, silenceLineDb(levels, settings) - 3)
}

/** The smallest section worth keeping - shorter blips (a click, a breath) are dropped. */
const MIN_KEEP_SEC = 0.1

/** Longest sound at the very start or end of a take that is treated as a
 *  click rather than a word. A spoken word, even "so", lasts longer. */
export const EDGE_CLICK_SEC = 0.1

/** Room left before the first word and after the last one, whichever pacing
 *  he picked.
 *
 *  v1 cut both flush, which clipped the first and last words: it cut where
 *  the level crossed the silence line, and the soft start and trailing end
 *  of a word sit under that line. The fix was 0.4s of room at each end - and
 *  that was too much: the video opened on nearly half a second of nothing.
 *  Now the room is measured from where his voice really starts and fades
 *  (see headSilence and tailSilence), so it can be short and still never
 *  touch the word: a beat before the first word, a little longer after the
 *  last so the video does not end on a clipped syllable. Every preset gets
 *  the same: this is about how the video opens and closes, not how fast the
 *  middle moves. */
export const HEAD_LEEWAY_SEC = 0.15
export const TAIL_LEEWAY_SEC = 0.2

/** Turns silent ranges into the ranges to keep: everything else, padded so
 *  the cut lands just outside the speech rather than on top of it. */
export function keepRanges(silences: Range[], duration: number, paddingSec: number): Range[] {
  const keeps: Range[] = []
  const head = Math.max(paddingSec, HEAD_LEEWAY_SEC)
  const tail = Math.max(paddingSec, TAIL_LEEWAY_SEC)
  let cursor = 0

  for (const { start, end } of silences) {
    const isHead = start <= 0.01
    // A video's sound can stop a moment before its picture does; silence
    // that runs to the end of the sound is still the end of the video.
    const isTail = end >= duration - EDGE_CLICK_SEC
    // What gets removed. In the middle, the pause less `paddingSec` at each
    // end. At the head and tail, the pause less a short breath, so the video
    // opens and closes just around his words, not on a syllable.
    const removeFrom = isHead ? 0 : isTail ? start + tail : start + paddingSec
    const removeTo = isTail ? duration : isHead ? end - head : end - paddingSec
    if (removeTo - removeFrom <= 0.01) continue
    if (removeFrom > cursor) keeps.push({ start: cursor, end: removeFrom })
    cursor = Math.max(cursor, removeTo)
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration })

  return keeps.filter((r) => r.end - r.start >= MIN_KEEP_SEC)
}

/** The quietest moment within `windowSec` either side of `time`, or null if
 *  the level curve does not reach that far. */
function quietestNear(levels: Level[], time: number, windowSec: number): Level | null {
  let best: Level | null = null
  for (const level of levels) {
    if (level.time < time - windowSec) continue
    if (level.time > time + windowSec) break
    if (!best || level.db < best.db) best = level
  }
  return best
}

/** Pulls a roughly-placed cut onto the nearest genuine gap in the audio, and
 *  refuses the cut outright when there is no gap to land on.
 *
 *  This exists because a speech recogniser's word timings are approximate -
 *  good to about a fifth of a second - while a cut is exact. Trusting those
 *  timings directly is what turned "I really want to master that" into "I
 *  really want to mas", and "connections" into "connec": the reported end of
 *  an "um" sat a little late, inside the word after it, and the cut went
 *  where it was told.
 *
 *  The loudness curve already knows where the speech actually stops, so each
 *  end of the cut is moved to the quietest instant nearby. If neither end has
 *  a quiet instant to move to - the filler is said straight into the next
 *  word, with no gap at all - this returns null and the filler is left in.
 *  Leaving an "um" in costs him a second with the trimmer; taking a syllable
 *  off a word he needs costs him the take. */
export function snapCutToQuiet(
  range: Range,
  levels: Level[],
  { windowSec, quietBelowDb }: { windowSec: number; quietBelowDb: number },
): Range | null {
  const start = quietestNear(levels, range.start, windowSec)
  const end = quietestNear(levels, range.end, windowSec)
  if (!start || !end) return null
  // Both ends have to land somewhere actually quiet. If they don't, this is
  // speech all the way through and nothing here is safe to remove.
  if (start.db > quietBelowDb || end.db > quietBelowDb) return null
  if (end.time - start.time < 0.05) return null
  return { start: start.time, end: end.time }
}

/** Sorts and collapses overlapping/touching ranges into one, so a list built
 *  from two different sources (silence, spoken filler words) can be fed to
 *  keepRanges as a single well-ordered set - it walks the list assuming each
 *  range starts no earlier than the one before it. */
export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = [{ ...sorted[0] }]
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export function totalDuration(ranges: Range[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
}

/** Splits the speech in a video into windows for the speech model to listen
 *  to one at a time, breaking only inside pauses so no word is ever cut in
 *  half between two windows.
 *
 *  Why windows at all: transcribing a whole clip in one go took the page
 *  past 3 GB in WebKit, far over what an iPhone allows a tab. Short separate
 *  windows, with a moment between them for the browser to clear up, are most
 *  of what brought that down. Pure silence is left out entirely - there is
 *  nothing in it to hear, and the model tends to invent words in it.
 *
 *  A single stretch of speech longer than `maxSec` with no pause anywhere in
 *  it is the one case that has to be cut mid-flow; it is rare in real takes. */
export function speechWindows(
  silences: Range[],
  duration: number,
  { maxSec = 25, padSec = 0.3 }: { maxSec?: number; padSec?: number } = {},
): Range[] {
  const speech: Range[] = []
  let cursor = 0
  for (const { start, end } of silences) {
    if (start > cursor) speech.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < duration) speech.push({ start: cursor, end: duration })

  const pieces: Range[] = []
  for (const { start, end } of speech) {
    for (let s = start; s < end; s += maxSec) pieces.push({ start: s, end: Math.min(end, s + maxSec) })
  }

  const grouped: Range[] = []
  for (const piece of pieces) {
    const current = grouped[grouped.length - 1]
    if (current && piece.end - current.start <= maxSec) current.end = piece.end
    else grouped.push({ ...piece })
  }

  // A little of the pause either side, so the model hears each word begin and
  // end - but never more than half the gap, so neighbours can't overlap and
  // hear the same word twice.
  return grouped.map((w, i) => {
    const before = i === 0 ? w.start : (w.start - grouped[i - 1].end) / 2
    const after = i === grouped.length - 1 ? duration - w.end : (grouped[i + 1].start - w.end) / 2
    return { start: w.start - Math.min(padSec, before), end: w.end + Math.min(padSec, after) }
  })
}
