// What happens to a video's colour on its way through: what the camera
// recorded (HDR or not, and how it is tagged), what the decoder hands over,
// and what the encoder says it wrote. Sent once per video as a "check"
// report, so a picture that comes out with harsh contrast can be traced to
// the step that did it - the video itself never leaves the phone.

import type { EncodedPacket, InputVideoTrack, VideoSample } from 'mediabunny'

import { report } from '../report'
import { avcColour, packetColour, type StreamColour } from './avcColour'

type Colour = { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null }

const describe = (c: Colour | null | undefined): string =>
  c ? `${c.primaries ?? '?'}/${c.transfer ?? '?'}/${c.matrix ?? '?'}/${c.fullRange == null ? '?' : c.fullRange ? 'full' : 'limited'}` : 'none'

/** Sets the colour the MP4 will carry to what the H.264 stream itself says
 *  (avcColour.ts), on the encoder's metadata before mediabunny muxes it - the
 *  same object goes on to the muxer. Returns what the stream says, or null
 *  when it isn't H.264 or can't be read (then nothing is changed). For a
 *  VideoSampleSource's `onEncodedPacket`. */
export function matchStreamColour(meta: EncodedVideoChunkMetadata | undefined, packet?: EncodedPacket): StreamColour | null {
  const config = meta?.decoderConfig
  if (!config || !/^avc[13]\./.test(config.codec)) return null
  const colour = config.description ? avcColour(config.description) : packet ? packetColour(packet.data) : null
  if (colour) config.colorSpace = { primaries: colour.primaries, transfer: colour.transfer, matrix: colour.matrix, fullRange: colour.fullRange }
  return colour
}

export const onEncodedPacketMatchingColour = (packet: EncodedPacket, meta: EncodedVideoChunkMetadata | undefined): void => {
  matchStreamColour(meta, packet)
}

export class ColourCheck {
  private source = 'unknown'
  private frame: string | null = null
  private sent = false

  async noteSource(track: InputVideoTrack): Promise<void> {
    try {
      const [hdr, colour, codec] = await Promise.all([track.hasHighDynamicRange(), track.getColorSpace(), track.getCodecParameterString()])
      this.source = `${codec ?? '?'} ${hdr ? 'HDR' : 'SDR'} ${describe(colour)}`
    } catch (error) {
      this.source = `unreadable (${error instanceof Error ? error.message : String(error)})`
    }
  }

  /** The first decoded frame: its pixel format and colour. */
  noteFrame(sample: VideoSample): void {
    if (this.frame !== null) return
    try {
      this.frame = `${sample.format ?? 'opaque'} ${describe(sample.colorSpace)}`
    } catch {
      this.frame = 'unreadable'
    }
  }

  /** For the encoder's `onEncodedPacket`: sends the report with the first
   *  packet that says how it was written. */
  readonly onEncodedPacket = (packet: EncodedPacket, meta: EncodedVideoChunkMetadata | undefined): void => {
    if (!meta?.decoderConfig) return
    const said = describe(meta.decoderConfig.colorSpace)
    const stream = matchStreamColour(meta, packet)
    if (this.sent) return
    this.sent = true
    const out = meta.decoderConfig
    report({
      kind: 'check',
      phase: 'colour',
      message:
        `source ${this.source}; decoded ${this.frame ?? 'not seen'}; ` +
        `encoder said ${out.codec} ${out.codedWidth ?? '?'}x${out.codedHeight ?? '?'} ${said}; ` +
        `stream says ${stream ? `${describe(stream)}${stream.stated ? '' : ' (unstated)'}` : 'unreadable'}; tagged ${describe(out.colorSpace)}`,
    })
  }
}
