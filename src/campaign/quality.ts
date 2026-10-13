// How sharp a made video comes out: its own size up to 4K, its own frame
// rate, and a bitrate to match.
//
// Every video used to be brought down to 1080×1920 and encoded at the
// encoder's "high" setting - which on his iPhone came out as about 6 Mbps
// (the reports show "avc1.640028 … 6111000 bps"). A 4K 60 fps take lost
// three quarters of its pixels and most of its detail; he could see it. Now
// a 4K take stays 4K, a 60 fps take stays 60, and the bitrate is about what
// the phone's own camera records at: ~16 Mbps for 1080p60, ~45 for 4K60.
//
// 4K is four times the pixels to draw and encode, so it is slower, and a
// phone may not manage it: when the encoder says it can't do 4K, or the
// first go fails, the video is made in 1080p instead - still at the higher
// bitrate - rather than not at all.

import { Quality, canEncodeVideo, type InputVideoTrack } from 'mediabunny'

/** The shorter side of a 4K frame (2160×3840), and of a 1080p one. */
export const SHORT_4K = 2160
export const SHORT_HD = 1080

/** Bits per second for a `width`×`height` video at `fps`: 10 Mbps for
 *  1080p30, growing a little slower than the pixel count (bigger frames
 *  compress better), 1.6 times for 50-60 fps. 1080p60 ≈ 16 Mbps, 4K30 ≈ 28,
 *  4K60 ≈ 45. */
export function videoBitrate(width: number, height: number, fps: number): number {
  const pixels = Math.max(1, width * height) / (1080 * 1920)
  const motion = fps >= 45 ? 1.6 : fps >= 35 ? 1.3 : 1
  return Math.round(10_000_000 * Math.pow(pixels, 0.75) * motion)
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

/** Whether this phone's encoder takes H.264 at that size and bitrate. */
export async function canMake(width: number, height: number, fps: number): Promise<boolean> {
  try {
    return await canEncodeVideo('avc', { width, height, quality: videoQuality(width, height, fps) })
  } catch {
    return false
  }
}

/** The size to make at: `size(SHORT_4K)` when the phone can encode it, else
 *  `size(SHORT_HD)`. `hd` goes straight to 1080p - a second go after the
 *  first failed. */
export async function makeSize(
  size: (maxShort: number) => { width: number; height: number },
  fps: number,
  hd = false,
): Promise<{ width: number; height: number }> {
  if (hd) return size(SHORT_HD)
  const big = size(SHORT_4K)
  if (Math.min(big.width, big.height) <= SHORT_HD) return big
  return (await canMake(big.width, big.height, fps)) ? big : size(SHORT_HD)
}
