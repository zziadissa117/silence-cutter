// What happens to a video's colour on its way through: what the camera
// recorded (HDR or not, and how it is tagged), what the decoder hands over,
// and what the encoder says it wrote. Sent once per video as a "check"
// report, so a picture that comes out with harsh contrast can be traced to
// the step that did it - the video itself never leaves the phone.

import type { EncodedPacket, InputVideoTrack, VideoSample } from 'mediabunny'

import { report } from '../report'

type Colour = { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null }

const describe = (c: Colour | null | undefined): string =>
  c ? `${c.primaries ?? '?'}/${c.transfer ?? '?'}/${c.matrix ?? '?'}/${c.fullRange == null ? '?' : c.fullRange ? 'full' : 'limited'}` : 'none'

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
  readonly onEncodedPacket = (_packet: EncodedPacket, meta: EncodedVideoChunkMetadata | undefined): void => {
    if (this.sent || !meta?.decoderConfig) return
    this.sent = true
    const out = meta.decoderConfig
    report({
      kind: 'check',
      phase: 'colour',
      message: `source ${this.source}; decoded ${this.frame ?? 'not seen'}; written ${out.codec} ${out.codedWidth ?? '?'}x${out.codedHeight ?? '?'} ${describe(out.colorSpace)}`,
    })
  }
}
