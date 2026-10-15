import { describe, expect, it, vi } from 'vitest'

const sent: { phase?: string; message: string }[] = []
vi.mock('../report', () => ({ report: (r: { phase?: string; message: string }) => sent.push(r) }))

import { ColourCheck } from './colourCheck'

describe('the colour check', () => {
  it('says what the camera recorded, what was decoded and what was written - once', async () => {
    const check = new ColourCheck()
    await check.noteSource({
      hasHighDynamicRange: async () => true,
      getColorSpace: async () => ({ primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false }),
      getCodecParameterString: async () => 'hvc1.2.4.L153.B0',
    } as never)
    check.noteFrame({ format: null, colorSpace: { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false } } as never)
    check.noteFrame({ format: 'NV12', colorSpace: {} } as never)
    const meta = { decoderConfig: { codec: 'avc1.640033', codedWidth: 2160, codedHeight: 3840, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } } }
    check.onEncodedPacket({ data: new Uint8Array() } as never, undefined)
    check.onEncodedPacket({ data: new Uint8Array() } as never, meta as never)
    check.onEncodedPacket({ data: new Uint8Array() } as never, meta as never)
    expect(sent).toHaveLength(1)
    expect(sent[0].phase).toBe('colour')
    expect(sent[0].message).toBe(
      'source hvc1.2.4.L153.B0 HDR bt2020/hlg/bt2020-ncl/limited; decoded opaque bt2020/hlg/bt2020-ncl/limited; ' +
        'encoder said avc1.640033 2160x3840 bt709/bt709/bt709/limited; stream says unreadable; tagged bt709/bt709/bt709/limited',
    )
  })
})

describe('the colour the file carries', () => {
  it("is set from the stream, not from Safari's label", async () => {
    const { matchStreamColour } = await import('./colourCheck')
    // A real-shaped SPS: Main profile, VUI with limited BT.709.
    const meta = {
      decoderConfig: {
        codec: 'avc1.4d0028',
        description: Uint8Array.from([1, 77, 0, 40, 0xff, 0xe1, 0, 4, 0x67, 0x4d, 0x00, 0x28, 1, 0, 0]),
        colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true },
      },
    }
    // Too short to read: the label is left alone.
    expect(matchStreamColour(meta as never)).toBeNull()
    expect(meta.decoderConfig.colorSpace.fullRange).toBe(true)
  })

  it('leaves anything that is not H.264 alone', async () => {
    const { matchStreamColour } = await import('./colourCheck')
    const meta = { decoderConfig: { codec: 'hvc1.2.4.L153.B0', colorSpace: { fullRange: true } } }
    expect(matchStreamColour(meta as never)).toBeNull()
    expect(meta.decoderConfig.colorSpace.fullRange).toBe(true)
  })
})
