// What a batch clip file is made of, in one line for a report: its format,
// size and turn, how far apart its frames are and how evenly, whether they
// are stored out of order (B-frames), how long it says each frame lasts.
//
// Some reactions came out laggy in every video made from them while others
// never did, from the same phone and the same filming - 8 of 17 - and the
// files play smoothly in Photos. What sets those files apart is read here,
// from the packets alone (nothing decoded), and reported once per file.

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'

import { steadyFrom } from './clipParts'

/** Enough frames to see how a file is put together, quickly. */
const LOOK_AT = 600

export interface FrameTiming {
  frames: number
  /** Frames a second, from the usual gap between frames. */
  fps: number
  /** The usual, smallest and largest gap between frames, in ms. */
  gapMs: { usual: number; min: number; max: number }
  /** Gaps over half as long again as the usual one: frames missing or held. */
  uneven: number
  /** Stored in another order than shown. */
  reordered: boolean
  /** How long the file says a frame lasts, usually, in ms. */
  statedMs: number
  keyFrames: number
}

/** Frame timing from packets in the order they are stored. */
export function frameTiming(packets: readonly { timestamp: number; duration: number; key: boolean }[]): FrameTiming {
  const shown = packets.map((p) => p.timestamp).sort((a, b) => a - b)
  const gaps = shown.slice(1).map((t, k) => t - shown[k]).filter((g) => g > 0)
  const middle = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0)
  const usual = middle(gaps)
  const ms = (s: number) => Math.round(s * 10_000) / 10
  return {
    frames: packets.length,
    fps: usual > 0 ? Math.round(100 / usual) / 100 : 0,
    gapMs: { usual: ms(usual), min: ms(gaps.length ? Math.min(...gaps) : 0), max: ms(gaps.length ? Math.max(...gaps) : 0) },
    uneven: gaps.filter((g) => g > usual * 1.5).length,
    reordered: packets.some((p, k) => k > 0 && p.timestamp < packets[k - 1].timestamp),
    statedMs: ms(middle(packets.map((p) => p.duration))),
    keyFrames: packets.filter((p) => p.key).length,
  }
}

/** One line on what `file` is made of. */
export async function describeClip(name: string, file: Blob): Promise<string> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) return `${name}: no picture`
    const [codec, config, width, height, rotation, colour, seconds, readable] = await Promise.all([
      video.getCodec(),
      video.getDecoderConfig(),
      video.getCodedWidth(),
      video.getCodedHeight(),
      video.getRotation(),
      video.getColorSpace().catch(() => null),
      input.computeDuration(),
      video.canDecode(),
    ])
    const packets: { timestamp: number; duration: number; key: boolean }[] = []
    for await (const p of new EncodedPacketSink(video).packets(undefined, undefined, { metadataOnly: true })) {
      packets.push({ timestamp: p.timestamp, duration: p.duration, key: p.type === 'key' })
      if (packets.length >= LOOK_AT) break
    }
    const t = frameTiming(packets)
    // Where a video made from it starts it (clipParts.steadyStart): past a
    // first frame that comes late, or first frames that come every other one.
    const shownFrom = Math.max(0, packets.length ? Math.min(...packets.map((p) => p.timestamp)) : 0)
    const playsFrom = steadyFrom(
      packets.map((p) => p.timestamp),
      shownFrom,
    )
    return [
      `${name}: ${config?.codec ?? codec ?? '?'} ${width}x${height}${rotation ? ` turned ${rotation}` : ''}`,
      colour ? `${colour.primaries ?? '?'}/${colour.transfer ?? '?'}` : 'colour ?',
      `${t.fps} fps`,
      `gaps ${t.gapMs.usual}/${t.gapMs.min}-${t.gapMs.max} ms, ${t.uneven} uneven of ${t.frames}`,
      `says ${t.statedMs} ms a frame`,
      t.reordered ? 'stored out of order' : 'stored in order',
      `${t.keyFrames} key`,
      `${packets.filter((p) => p.timestamp < 0).length} hidden before the start`,
      playsFrom > shownFrom + 0.001 ? `plays from ${Math.round(playsFrom * 1000)} ms (start not steady)` : 'steady start',
      `${Math.round(seconds * 10) / 10} s`,
      `${Math.round(file.size / 100_000) / 10} MB`,
      readable ? '' : 'NOT readable',
    ]
      .filter(Boolean)
      .join(', ')
  } finally {
    input.dispose()
  }
}
