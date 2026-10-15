// How sharp a made video comes out: 1080×1920 at its own frame rate, at a
// bitrate to match - the size and limits Instagram and TikTok ask for.
//
// Every video used to be encoded at the encoder's "high" setting, which on
// his iPhone came out as about 6 Mbps (the reports show "avc1.640028 …
// 6111000 bps"); the bitrate now follows the size and frame rate - ~16 Mbps
// for 1080p60. For a while a 4K take was posted as 4K, at up to 45 Mbps, but
// posted videos then looked soft on Instagram and TikTok: Instagram's API
// takes nothing over 1920 px across or 25 Mbps, so a 4K file was shrunk and
// re-compressed hard on the way in. They show 1080p anyway, so 1080p within
// their limits is what goes to them.

import { Quality, type InputVideoTrack } from 'mediabunny'

/** The shorter side of a posted video: 1080×1920. */
export const SHORT_HD = 1080
/** Instagram's API takes nothing over 25 Mbps; kept clear of it. */
export const MAX_BITRATE = 20_000_000

/** Bits per second for a `width`×`height` video at `fps`: 10 Mbps for
 *  1080p30, growing a little slower than the pixel count (bigger frames
 *  compress better), 1.6 times for 50-60 fps. 1080p60 ≈ 16 Mbps, 4K30 ≈ 28,
 *  capped at MAX_BITRATE. */
export function videoBitrate(width: number, height: number, fps: number): number {
  const pixels = Math.max(1, width * height) / (1080 * 1920)
  const motion = fps >= 45 ? 1.6 : fps >= 35 ? 1.3 : 1
  return Math.min(MAX_BITRATE, Math.round(10_000_000 * Math.pow(pixels, 0.75) * motion))
}

export function videoQuality(width: number, height: number, fps: number): Quality {
  return new Quality({ bitrate: videoBitrate(width, height, fps) })
}

/** The frames a second the source plays at, from its packets; 30 when it
 *  can't be told. */
export async function frameRateOf(track: InputVideoTrack): Promise<number> {
  try {
    const stats = await track.computePacketStats(120)
    return Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0 ? stats.averagePacketRate : 30
  } catch {
    return 30
  }
}

/** The size to make at: `size` at most 1080 on its shorter side. */
export function makeSize(size: (maxShort: number) => { width: number; height: number }): { width: number; height: number } {
  return size(SHORT_HD)
}

