// Which part of a product step's clip plays in a batch video - chosen from
// the clip itself, never from a number he types ("I'm not going to guess
// every single second").
//
// What happens on screen shows in the video file: a frame where nothing
// moves is stored in a few bytes, one where the screen scrolls, an answer
// appears or the camera moves takes many. So the sizes of the clip's frames,
// read from its index without decoding a single picture (quick on a long 4K
// clip, and nothing for the phone's decoder to give up on), say when
// something happens. A video plays one such moment, from just before it
// starts until just after it settles - one of them at random when there are
// several, the bigger ones more often. A clip he already trimmed short plays
// whole; one where nothing stands out (all still, or moving all the time,
// like filmed b-roll) plays a random couple of seconds.

import { EncodedPacketSink, type InputVideoTrack } from 'mediabunny'

import type { Range } from '../media/silenceMath'

export const PIECE = {
  /** Activity is measured per quarter second. */
  bin: 0.25,
  /** A clip this short is already what he wants seen: it plays whole. */
  wholeUpTo: 4,
  /** A moment plays at least this long, so it can be taken in... */
  shortest: 2,
  /** ...and at most this long; a longer one plays part of itself. */
  longest: 5,
  /** Nothing stands out: a random length in this range. */
  plain: [2, 3.5] as const,
  /** Starts a moment before what happens, so it is seen beginning... */
  lead: 0.3,
  /** ...and stays a moment after, so its result is seen. */
  tail: 0.7,
  /** Two bursts this close are one thing happening (typing, a scroll). */
  gap: 0.75,
  /** All the steps together never run longer than this. */
  showcaseMax: 12,
} as const

/** The busiest part must be this many times the quiet parts to count as
 *  something happening; less, and the clip is all one. */
const STANDS_OUT = 2.5
/** Above this share of the way from quiet to the busiest, a quarter second
 *  is part of something happening. */
const ACTIVE_FROM = 0.25

export interface PacketInfo {
  timestamp: number
  bytes: number
  key: boolean
}

/** How much happens in each quarter second of the clip between `first` and
 *  `duration`: the bytes its frames take. A key frame is big whatever is on
 *  screen, so it counts as an ordinary frame of its quarter second. */
export function activityOf(packets: Iterable<PacketInfo>, first: number, duration: number): number[] {
  const n = Math.max(1, Math.ceil((duration - first) / PIECE.bin - 1e-9))
  const bytes = new Float64Array(n)
  const frames = new Float64Array(n)
  const keys = new Float64Array(n)
  for (const p of packets) {
    if (!(p.timestamp >= first && p.timestamp < duration)) continue
    const i = Math.min(n - 1, Math.floor((p.timestamp - first) / PIECE.bin))
    if (p.key) keys[i]++
    else {
      bytes[i] += p.bytes
      frames[i]++
    }
  }
  const raw = Array.from(bytes, (b, i) => (frames[i] > 0 ? b + keys[i] * (b / frames[i]) : 0))
  // Smoothed over three quarter seconds: B frames are small and P frames big,
  // which on its own looks like flicker.
  return raw.map((_, i) => {
    const near = raw.slice(Math.max(0, i - 1), i + 2)
    return near.reduce((s, v) => s + v, 0) / near.length
  })
}

export interface Moment extends Range {
  /** How much happens in it, to pick the bigger ones more often. */
  amount: number
}

/** The stretches of the clip where something happens, on its own timeline;
 *  none when nothing stands out. */
export function momentsOf(activity: readonly number[], first: number): Moment[] {
  if (activity.length === 0) return []
  const sorted = [...activity].sort((a, b) => a - b)
  const quiet = sorted[Math.floor((sorted.length - 1) * 0.2)]
  const peak = sorted[sorted.length - 1]
  if (!(peak > 0) || peak < quiet * STANDS_OUT) return []
  const from = quiet + (peak - quiet) * ACTIVE_FROM
  const gapBins = Math.round(PIECE.gap / PIECE.bin)

  const runs: { start: number; end: number }[] = []
  activity.forEach((v, i) => {
    if (v <= from) return
    const last = runs[runs.length - 1]
    if (last && i - last.end <= gapBins) last.end = i + 1
    else runs.push({ start: i, end: i + 1 })
  })
  return runs.map((r) => ({
    start: first + r.start * PIECE.bin,
    end: first + r.end * PIECE.bin,
    amount: activity.slice(r.start, r.end).reduce((s, v) => s + Math.max(0, v - quiet), 0),
  }))
}

/** `piece` moved, not shortened, to lie within [first, duration]. */
function within(piece: Range, first: number, duration: number): Range {
  const length = Math.min(piece.end - piece.start, duration - first)
  const start = Math.min(Math.max(first, piece.start), duration - length)
  return { start, end: start + length }
}

/** The part of a clip (`first`..`duration`) a video plays, from its activity
 *  (activityOf; null when it couldn't be read). */
export function pickPiece(activity: readonly number[] | null, first: number, duration: number, rand: () => number): Range {
  const span = duration - first
  if (!(span > PIECE.wholeUpTo)) return { start: first, end: duration }

  const moments = activity ? momentsOf(activity, first) : []
  if (moments.length === 0) {
    const length = PIECE.plain[0] + (PIECE.plain[1] - PIECE.plain[0]) * rand()
    const start = first + (span - length) * rand()
    return { start, end: start + length }
  }

  const total = moments.reduce((s, m) => s + m.amount, 0)
  let r = rand() * total
  const moment = moments.find((m) => (r -= m.amount) < 0) ?? moments[moments.length - 1]
  let start = moment.start - PIECE.lead
  let end = moment.end + PIECE.tail
  if (end - start > PIECE.longest) {
    // A long one - a minute of typing - plays a part of itself, from a
    // different place in each video.
    const length = 3 + (PIECE.longest - 3) * rand()
    start += (end - start - length) * rand()
    end = start + length
  } else if (end - start < PIECE.shortest) {
    // A quick one - a tap - gets time around it, more after than before:
    // what it does is the point.
    const grow = PIECE.shortest - (end - start)
    start -= grow * 0.3
    end += grow * 0.7
  }
  return within({ start, end }, first, duration)
}

/** A step with a single clip is the same in every video - a fixed part, like
 *  the products shown in full ("Step 3 is one whole video of like 16 seconds
 *  that shows the products" - it was cut to a few seconds, and the video
 *  ended at 11). It plays whole, never cut to a moment and never counted in
 *  PIECE.showcaseMax. A step with several clips plays a moment of each. */
export function playsWhole(step: { files: readonly unknown[] } | null | undefined): boolean {
  return step?.files.length === 1
}

/** The steps' pieces brought down to PIECE.showcaseMax together, each
 *  shortened about its middle by the same share, none under a second. */
export function fitShowcase(pieces: readonly Range[], max: number = PIECE.showcaseMax): Range[] {
  const total = pieces.reduce((s, p) => s + (p.end - p.start), 0)
  if (total <= max) return pieces.map((p) => ({ ...p }))
  const share = max / total
  return pieces.map((p) => {
    const length = p.end - p.start
    const keep = Math.min(length, Math.max(1, length * share))
    const start = p.start + (length - keep) / 2
    return { start, end: start + keep }
  })
}

/** activityOf for a clip's picture track, from its index alone. */
export async function readActivity(track: InputVideoTrack, first: number, duration: number): Promise<number[]> {
  const packets: PacketInfo[] = []
  for await (const p of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
    packets.push({ timestamp: p.timestamp, bytes: p.byteLength, key: p.type === 'key' })
  }
  return activityOf(packets, first, duration)
}
