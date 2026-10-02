// The moves that make a talking-head video feel edited rather than recorded:
// the shot punching in and out at each jump cut, a slow push-in under the
// hook, a quick punch when he says the brand, and the logo springing in.
//
// Every one is off until he turns it on, after seeing its example. The
// examples on the setup screen and the real videos both run on the functions
// here, so an example is exactly what a video will do.
//
// Each video varies a little - which cuts punch in, and by how much - within
// fixed limits, so a batch of one angle looks hand-edited instead of stamped
// from one template, and does not read as the same video posted again.
//
// The headline and logo never move with any of this: they are drawn after,
// on a steady frame.

export type EffectLevel = 'off' | 'subtle' | 'strong'

export interface AngleEffects {
  /** At each cut, the shot jumps a little closer or back out. */
  cutPunch: EffectLevel
  /** A slow push-in over the first seconds. */
  hookPush: EffectLevel
  /** A quick punch-in when he says the brand. */
  brandHit: EffectLevel
  /** The logo - and any pictures - spring in instead of just appearing. */
  logoPop: boolean
}

export const NO_EFFECTS: AngleEffects = { cutPunch: 'off', hookPush: 'off', brandHit: 'off', logoPop: false }

/** Where zooms head: the middle of the frame, a little above centre - where
 *  he says his face usually is. */
export const FACE = { x: 0.5, y: 0.4 } as const

/** How much closer each move gets, as [least, most]; each video picks within
 *  the range. 1.1 is 10% closer. */
const CUT_ZOOM: Record<Exclude<EffectLevel, 'off'>, [number, number]> = { subtle: [1.08, 1.13], strong: [1.15, 1.22] }
const HOOK_ZOOM: Record<Exclude<EffectLevel, 'off'>, [number, number]> = { subtle: [0.05, 0.07], strong: [0.1, 0.14] }
const HIT_ZOOM: Record<Exclude<EffectLevel, 'off'>, [number, number]> = { subtle: [0.07, 0.1], strong: [0.13, 0.18] }

/** A stretch between cuts shorter than this keeps the framing it had: a jump
 *  in and back out inside half a second reads as a glitch. */
const MIN_SEGMENT_SEC = 0.7
/** How often a cut changes the framing. Not every one - that is what makes
 *  it look like a person edited it. */
const CHANGE_CHANCE = 0.75
/** How far a close shot may sit off-centre, as a share of the width. */
const SIDEWAYS = 0.015
const HOOK_SEC = 3
const HIT = { rise: 0.12, hold: 0.55, fall: 0.3 } as const
const MAX_SCALE = 1.45

/** A repeatable random sequence from a seed: the same video, rendered again,
 *  moves the same way. */
export function randomFrom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function between([low, high]: [number, number], random: () => number): number {
  return low + (high - low) * random()
}

export interface Framing {
  /** 1 is the whole frame; 1.12 is 12% closer. */
  scale: number
  /** Sideways offset of the zoom's centre, as a share of the width. */
  dx: number
}

export interface MotionPlan {
  /** The framing of each kept stretch, in order. */
  segments: Framing[]
  /** The hook push-in's extra zoom at its fullest, or 0 for none. */
  hook: number
  /** The brand punch's extra zoom, or 0 for none. Each mention varies a
   *  little around it. */
  hit: number
  /** One extra zoom per brand mention, picked once so the video is
   *  repeatable. */
  hitJitter: number[]
}

/** Decides every move in one video, before a frame is drawn. `segmentSec` is
 *  how long each kept stretch lasts. */
export function planMotion(effects: AngleEffects, segmentSec: number[], seed: string, mentions = 8): MotionPlan {
  const random = randomFrom(seed)
  const segments: Framing[] = []
  let close = false
  for (let i = 0; i < segmentSec.length; i++) {
    // Three draws for every stretch whatever happens, so one choice never
    // shifts the dice for the rest of the video.
    const [change, amount, side] = [random(), random(), random()]
    const previous = segments[i - 1] ?? { scale: 1, dx: 0 }
    // The first stretch opens wide: the hook push-in, if on, does the moving.
    if (effects.cutPunch === 'off' || i === 0 || segmentSec[i] < MIN_SEGMENT_SEC || change > CHANGE_CHANCE) {
      segments.push(effects.cutPunch === 'off' ? { scale: 1, dx: 0 } : previous)
      continue
    }
    close = !close
    const [low, high] = CUT_ZOOM[effects.cutPunch]
    segments.push(close ? { scale: low + (high - low) * amount, dx: (side * 2 - 1) * SIDEWAYS } : { scale: 1, dx: 0 })
  }
  return {
    segments,
    hook: effects.hookPush === 'off' ? 0 : between(HOOK_ZOOM[effects.hookPush], random),
    hit: effects.brandHit === 'off' ? 0 : between(HIT_ZOOM[effects.brandHit], random),
    hitJitter: Array.from({ length: mentions }, () => 0.85 + random() * 0.3),
  }
}

/** Starts fast, settles gently. */
function easeOut(x: number): number {
  const c = Math.min(1, Math.max(0, x))
  return 1 - Math.pow(1 - c, 3)
}

function easeInOut(x: number): number {
  const c = Math.min(1, Math.max(0, x))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

/** The brand punch's extra zoom `since` seconds after the word began: in
 *  fast, held, eased back out. */
export function hitAmount(since: number, amount: number): number {
  if (since < 0) return 0
  if (since < HIT.rise) return amount * easeOut(since / HIT.rise)
  if (since < HIT.rise + HIT.hold) return amount
  const out = (since - HIT.rise - HIT.hold) / HIT.fall
  return out >= 1 ? 0 : amount * (1 - easeInOut(out))
}

/** The framing at output time `t`, in segment `index`. `brandAt` are the
 *  moments he said the brand, on the output timeline. */
export function framingAt(plan: MotionPlan, index: number, t: number, brandAt: readonly number[]): Framing {
  const segment = plan.segments[index] ?? { scale: 1, dx: 0 }
  // The push-in lasts only as long as the opening stretch: the first cut
  // ends it, the way a cut would in a hand edit.
  const hook = index === 0 && plan.hook > 0 ? 1 + plan.hook * easeOut(t / HOOK_SEC) : 1
  let hit = 0
  brandAt.forEach((at, i) => {
    hit = Math.max(hit, hitAmount(t - at, plan.hit * (plan.hitJitter[i % plan.hitJitter.length] ?? 1)))
  })
  return { scale: Math.min(MAX_SCALE, segment.scale * hook * (1 + hit)), dx: segment.dx }
}

/** Where to draw a frame of `width`×`height` so it is `framing.scale` times
 *  bigger and centred toward the face - and still covers the whole canvas. */
export function placeFrame(framing: Framing, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const w = width * framing.scale
  const h = height * framing.scale
  const clamp = (value: number, min: number) => Math.min(0, Math.max(min, value))
  return {
    x: clamp((FACE.x + framing.dx) * (width - w), width - w),
    y: clamp(FACE.y * (height - h), height - h),
    width: w,
    height: h,
  }
}

const POP = { in: 0.38, out: 0.18 } as const

/** How the logo looks `since` seconds after it came up, with `left` seconds
 *  until it goes: springs in (a little past full size, then settles), and
 *  fades as it leaves. */
export function logoPop(since: number, left: number): { scale: number; alpha: number } {
  if (since < 0 || left <= 0) return { scale: 1, alpha: 0 }
  let scale = 1
  let alpha = 1
  if (since < POP.in) {
    const x = since / POP.in
    // A spring's shape: from 60% up past 100% to about 106%, and back.
    scale = 1 - 0.4 * Math.exp(-3.5 * x) * Math.cos(1.6 * Math.PI * x)
    alpha = Math.min(1, since / 0.12)
  }
  if (left < POP.out) {
    const x = left / POP.out
    alpha = Math.min(alpha, x)
    scale *= 0.92 + 0.08 * x
  }
  return { scale, alpha }
}
