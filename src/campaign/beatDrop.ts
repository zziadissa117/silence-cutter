// A batch's videos synced to a song's beat drop (his ask, 2026-11-23: "you
// select the point where it's like, 'This is the beat drop.' ... the reaction
// video cuts exactly at the same time as the beat drop"). He marks the drop
// once per song in the batch (BatchBank.beatDrops, BeatDropPicker.tsx) and
// turns it on per format (BatchFormat.syncDrop); each video then starts the
// song early by as much as its reaction lasts, so the drop lands right as
// the video switches to the product. A reaction longer than the song before
// its drop is never cut short: the song starts at its beginning, the drop a
// little after the switch ("don't cut reaction short just do your best").

/** Where in the song a video's music starts, in seconds: the drop minus the
 *  moment the video switches (`switchAt`, on the video's clock). With the
 *  music only starting at the switch (a talking hook kept as filmed,
 *  `musicFromSwitch`), at the drop itself. */
export function songStart(drop: number, switchAt: number, musicFromSwitch = false): number {
  if (!Number.isFinite(drop) || drop <= 0) return 0
  if (musicFromSwitch) return drop
  return Math.max(0, Math.round((drop - Math.max(0, switchAt)) * 1000) / 1000)
}

/** A song's beat drop in this batch for a format synced to it, or null. */
export function dropFor(
  bank: { beatDrops?: Record<string, number> } | null | undefined,
  format: { syncDrop?: boolean } | null | undefined,
  songId: string | null | undefined,
): number | null {
  if (!format?.syncDrop || !songId) return null
  const drop = bank?.beatDrops?.[songId]
  return typeof drop === 'number' && Number.isFinite(drop) && drop > 0 ? drop : null
}

/** How loud the song is every `STEP` seconds (root mean square of a mono
 *  mix) - what a tap is snapped against. */
export const STEP = 0.01

export function loudness(channels: readonly Float32Array[], sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * STEP))
  const length = channels[0]?.length ?? 0
  const out = new Float32Array(Math.ceil(length / size))
  for (let w = 0; w < out.length; w++) {
    let sum = 0
    const end = Math.min(length, (w + 1) * size)
    for (let i = w * size; i < end; i++) {
      let v = 0
      for (const c of channels) v += c[i] ?? 0
      v /= channels.length || 1
      sum += v * v
    }
    out[w] = Math.sqrt(sum / Math.max(1, end - w * size))
  }
  return out
}

/** A tap moved onto the hit it was meant for: within `before` seconds
 *  before it (a finger is a little late) or `after` after, the moment the
 *  sound jumps the most - the next tenth of a second against the fifth
 *  before it. The tap itself when nothing there jumps. */
export function snapToHit(level: Float32Array, tap: number, before = 0.35, after = 0.12): number {
  const at = (t: number) => Math.round(t / STEP)
  const from = Math.max(20, at(tap - before))
  const to = Math.min(level.length - 10, at(tap + after))
  let best = -1
  let bestRise = 1.6
  for (let w = from; w <= to; w++) {
    let past = 0
    for (let k = w - 20; k < w; k++) past += level[k]
    let next = 0
    for (let k = w; k < w + 10; k++) next += level[k]
    const rise = next / 10 / (past / 20 + 1e-4)
    if (rise > bestRise) {
      bestRise = rise
      best = w
    }
  }
  return best < 0 ? tap : Math.round(best * STEP * 1000) / 1000
}
