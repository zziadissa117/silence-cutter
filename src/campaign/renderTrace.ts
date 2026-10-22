// Where the making of a talking video is, step by step, and what the video
// it is made from is - said in the report when it stops moving, so a video
// stuck at 0% says where it stopped and why it might (a 191 MB video stopped
// at 0% every time on 2026-10-22, even in a fresh page, and nothing said
// where). One render at a time (CampaignApp's queue), so one trace.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'

import { within } from '../media/within'

let step = 'not started'
let since = 0
let read = 0
let written = 0

/** A video's turn begins: nothing traced yet - a batch or reaction video
 *  isn't made by render.ts, and says nothing here. */
export function traceReset(): void {
  step = 'not started'
  since = Date.now()
  read = 0
  written = 0
}

/** Whether a talking video's render got as far as starting. */
export function traceStarted(): boolean {
  return step !== 'not started'
}

/** A render begins. */
export function traceStart(now = Date.now()): void {
  step = 'opening the video'
  since = now
  read = 0
  written = 0
}

/** It moved on to `name` ("measuring the voice", "making the frames"). */
export function traceStep(name: string, now = Date.now()): void {
  step = name
  since = now
}

/** A frame came out of the decoder. */
export function traceRead(): void {
  read++
}

/** A frame went into the encoder. */
export function traceWritten(): void {
  written++
}

/** "at "making the frames" for 92 s, 0 frames read, 0 written". */
export function traceLine(now = Date.now()): string {
  return `at "${step}" for ${Math.round((now - since) / 1000)} s, ${read} frame${read === 1 ? '' : 's'} read, ${written} written`
}

/** What a video is, for a report: "hvc1.2.4.L153 3840x2160 turned 90, 61.2 s,
 *  HDR". A few seconds at most; empty when it can't be read. */
export async function describeVideo(file: Blob): Promise<string> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    return await within(
      (async () => {
        const track = await input.getPrimaryVideoTrack()
        if (!track) return 'no video track'
        const [codec, width, height, rotation, hdr, seconds] = await Promise.all([
          track.getCodecParameterString().catch(() => null),
          track.getCodedWidth(),
          track.getCodedHeight(),
          track.getRotation(),
          track.hasHighDynamicRange().catch(() => false),
          input.computeDuration().catch(() => null),
        ])
        return [
          codec ?? 'unknown codec',
          `${width}x${height}${rotation ? ` turned ${rotation}` : ''}`,
          seconds === null ? null : `${seconds.toFixed(1)} s`,
          hdr ? 'HDR' : null,
        ]
          .filter(Boolean)
          .join(', ')
      })(),
      5000,
      '',
    )
  } catch {
    return ''
  } finally {
    input.dispose()
  }
}
