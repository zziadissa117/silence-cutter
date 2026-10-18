// @vitest-environment node
import { ALL_FORMATS, BufferSource, BufferTarget, EncodedPacket, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output } from 'mediabunny'
import { describe, expect, it } from 'vitest'

import { PIECE, activityOf, fitShowcase, momentsOf, pickPiece, readActivity, type PacketInfo } from './stepPiece'

const FPS = 30

/** A clip's frames: `size(t)` bytes each, a key frame every two seconds. */
function frames(seconds: number, size: (t: number) => number): PacketInfo[] {
  return Array.from({ length: Math.round(seconds * FPS) }, (_, i) => {
    const t = i / FPS
    const key = i % (2 * FPS) === 0
    return { timestamp: t, bytes: key ? 40_000 : size(t), key }
  })
}

/** A screen recording: still, except while `busy` says something happens. */
const screen = (seconds: number, busy: (t: number) => boolean) => frames(seconds, (t) => (busy(t) ? 9_000 : 80))

function seeded(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

describe('finding the moment something happens in a step clip', () => {
  it('finds a scroll in an otherwise still screen recording, key frames or not', () => {
    const moments = momentsOf(activityOf(screen(10, (t) => t >= 3 && t < 5), 0, 10), 0)
    expect(moments).toHaveLength(1)
    expect(moments[0].start).toBeGreaterThanOrEqual(2.5)
    expect(moments[0].start).toBeLessThanOrEqual(3)
    expect(moments[0].end).toBeGreaterThanOrEqual(5)
    expect(moments[0].end).toBeLessThanOrEqual(5.5)
  })

  it('plays it from just before it starts to just after it settles', () => {
    const activity = activityOf(screen(10, (t) => t >= 3 && t < 5), 0, 10)
    const piece = pickPiece(activity, 0, 10, seeded(1))
    expect(piece.start).toBeLessThan(3)
    expect(piece.start).toBeGreaterThan(2)
    expect(piece.end).toBeGreaterThan(5)
    expect(piece.end).toBeLessThan(6.5)
  })

  it('keeps typing with little pauses as one thing happening', () => {
    // A key press every 0.4 s from 2 s to 4.4 s.
    const typing = (t: number) => t >= 2 && t < 4.4 && (t * 10) % 4 < 1
    expect(momentsOf(activityOf(screen(10, typing), 0, 10), 0)).toHaveLength(1)
  })

  it('gives a quick tap time around it, more after than before', () => {
    const activity = activityOf(screen(10, (t) => t >= 6 && t < 6.2), 0, 10)
    const piece = pickPiece(activity, 0, 10, seeded(2))
    expect(piece.end - piece.start).toBeCloseTo(PIECE.shortest, 5)
    expect(6 - piece.start).toBeLessThan(piece.end - 6.2)
  })

  it('plays part of a long one, from a different place in different videos', () => {
    const activity = activityOf(screen(30, (t) => t >= 2 && t < 25), 0, 30)
    const rand = seeded(3)
    const pieces = Array.from({ length: 6 }, () => pickPiece(activity, 0, 30, rand))
    for (const p of pieces) {
      expect(p.end - p.start).toBeGreaterThanOrEqual(3)
      expect(p.end - p.start).toBeLessThanOrEqual(PIECE.longest)
      expect(p.start).toBeGreaterThanOrEqual(1.5)
      expect(p.end).toBeLessThanOrEqual(26)
    }
    expect(new Set(pieces.map((p) => p.start.toFixed(1))).size).toBeGreaterThan(3)
  })

  it('picks among several moments, the bigger ones more often', () => {
    const busy = (t: number) => (t >= 2 && t < 2.5) || (t >= 7 && t < 9)
    const activity = activityOf(screen(12, busy), 0, 12)
    expect(momentsOf(activity, 0)).toHaveLength(2)
    const rand = seeded(4)
    const picks = Array.from({ length: 200 }, () => pickPiece(activity, 0, 12, rand))
    const big = picks.filter((p) => p.start > 5).length
    expect(big).toBeGreaterThan(120)
    expect(big).toBeLessThan(200)
  })

  it('plays a random couple of seconds when nothing stands out: all still, or moving all the time', () => {
    for (const clip of [frames(10, () => 80), frames(10, (t) => 30_000 + 3_000 * Math.sin(t * 7))]) {
      const activity = activityOf(clip, 0, 10)
      expect(momentsOf(activity, 0)).toEqual([])
      const piece = pickPiece(activity, 0, 10, seeded(5))
      expect(piece.end - piece.start).toBeGreaterThanOrEqual(PIECE.plain[0])
      expect(piece.end - piece.start).toBeLessThanOrEqual(PIECE.plain[1])
      expect(piece.start).toBeGreaterThanOrEqual(0)
      expect(piece.end).toBeLessThanOrEqual(10)
    }
    // ...and when the clip couldn't be read at all.
    const piece = pickPiece(null, 0, 10, seeded(6))
    expect(piece.end - piece.start).toBeGreaterThanOrEqual(PIECE.plain[0])
  })

  it('plays a clip he trimmed short whole', () => {
    const activity = activityOf(screen(3.5, (t) => t > 1 && t < 1.5), 0.05, 3.5)
    expect(pickPiece(activity, 0.05, 3.5, seeded(7))).toEqual({ start: 0.05, end: 3.5 })
  })

  it('never plays outside the clip, even for a moment at its very end', () => {
    const activity = activityOf(screen(10, (t) => t >= 9.6), 0, 10)
    const piece = pickPiece(activity, 0, 10, seeded(8))
    expect(piece.end).toBeLessThanOrEqual(10)
    expect(piece.end - piece.start).toBeGreaterThanOrEqual(PIECE.shortest - 1e-9)
  })

  it('keeps all the steps together under the showcase limit', () => {
    const pieces = Array.from({ length: 5 }, (_, i) => ({ start: i, end: i + 4 }))
    const fitted = fitShowcase(pieces)
    expect(fitted.reduce((s, p) => s + (p.end - p.start), 0)).toBeCloseTo(PIECE.showcaseMax)
    // Shortened about the middle.
    expect((fitted[0].start + fitted[0].end) / 2).toBeCloseTo(2)
    // Short enough already: left alone.
    expect(fitShowcase([{ start: 0, end: 3 }])).toEqual([{ start: 0, end: 3 }])
    // Never under a second, however many steps.
    expect(Math.min(...fitShowcase(Array.from({ length: 20 }, () => ({ start: 0, end: 2 }))).map((p) => p.end - p.start))).toBe(1)
  })

  it("reads the frame sizes from a real MP4's index", async () => {
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat(), target })
    const source = new EncodedVideoPacketSource('avc')
    output.addVideoTrack(source)
    await output.start()
    const clip = screen(10, (t) => t >= 3 && t < 5)
    for (const [i, f] of clip.entries()) {
      const packet = new EncodedPacket(new Uint8Array(f.bytes), f.key ? 'key' : 'delta', f.timestamp, 1 / FPS)
      const meta =
        i === 0
          ? { decoderConfig: { codec: 'avc1.42001f', codedWidth: 540, codedHeight: 960, description: new Uint8Array([1, 0x42, 0, 0x1f, 0xff, 0xe0, 0]) } }
          : undefined
      await source.add(packet, meta)
    }
    await output.finalize()

    const input = new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS })
    const track = (await input.getPrimaryVideoTrack())!
    const first = await track.getFirstTimestamp()
    const activity = await readActivity(track, first, await input.computeDuration())
    expect(activity).toEqual(activityOf(clip, first, await input.computeDuration()))
    expect(momentsOf(activity, first)).toHaveLength(1)
  })
})
