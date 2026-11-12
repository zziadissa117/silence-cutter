// The shot moving with the graphics (2026-11-12, "a lot of things are
// missing"): a motion-graphics video whose picture never moves looks like a
// screen recording with stickers. So, in both looks, the way a person edits
// one: a slow push-in on his face while the video opens, the shot a little
// closer or back out at some cuts, and a quick punch-in when a big moment
// lands - a card over his face, a number, the call to action. The board
// look had none of it, the glass look only the cuts.
//
// The moves are the Cutter's own (effects.ts), so the made video, the Play
// preview and the stills all move the same way.

import { cutTime } from '../captions'
import { framingAt, planMotion, type AngleEffects, type Framing } from '../effects'
import { formatOf, popScene, type Storyboard } from '../../../supabase/functions/postiz/motion'

/** Subtle everywhere: he talks to the camera, the moves only keep it alive. */
export const MOTION_EFFECTS: AngleEffects = { cutPunch: 'subtle', hookPush: 'subtle', brandHit: 'subtle', logoPop: false }

/** Punches at least this far apart, and at most this many: more and it
 *  reads as a gimmick. */
export const PUNCH_GAP_SEC = 5
export const MAX_PUNCHES = 6

/** When the shot punches in, on the recording's clock: as a big moment lands
 *  over his face. Not while the board is up (his face is small under it)
 *  nor on the steps screen (his video is in a box). */
export function punchMoments(board: Storyboard, wordStart: (index: number) => number): number[] {
  const glass = formatOf(board) === 'glass'
  const at: number[] = []
  if (board.hook) at.push(board.hook.at)
  for (const scene of board.scenes) {
    if (!glass && !popScene(scene)) continue
    for (const part of scene.parts) {
      if (part.kind === 'pop' || part.kind === 'stat' || part.kind === 'picture') at.push(part.at)
      else if (part.kind === 'tag' && part.mark) at.push(part.at)
      else if (part.kind === 'blocks' && part.after) at.push(part.after.at)
    }
  }
  if (board.end) at.push(board.end.at)
  const times = at
    .map(wordStart)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const kept: number[] = []
  for (const t of times) {
    if (kept.length >= MAX_PUNCHES) break
    // The first seconds belong to the slow push-in.
    if (t < 1.5) continue
    if (kept.length && t - kept[kept.length - 1] < PUNCH_GAP_SEC) continue
    kept.push(t)
  }
  return kept
}

/** The shot's framing at each moment of the finished video, as the render
 *  will make it - for the Play preview and the stills. */
export function motionCamera(
  board: Storyboard,
  wordStart: (index: number) => number,
  keep: readonly { start: number; end: number }[],
  seed: string,
): { punches: number[]; at: (t: number) => Framing } {
  const punches = punchMoments(board, wordStart)
  const plan = planMotion(
    MOTION_EFFECTS,
    keep.map((r) => r.end - r.start),
    seed,
    punches.length,
  )
  const onVideo = punches.map((t) => cutTime(t, keep as { start: number; end: number }[]))
  const starts: number[] = []
  let total = 0
  for (const r of keep) {
    starts.push(total)
    total += r.end - r.start
  }
  return {
    punches,
    at: (t) => {
      let index = 0
      while (index + 1 < starts.length && t >= starts[index + 1]) index++
      return framingAt(plan, index, t, onVideo)
    },
  }
}
