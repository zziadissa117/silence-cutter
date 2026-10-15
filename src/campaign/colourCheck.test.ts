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
    check.onEncodedPacket({} as never, undefined)
    check.onEncodedPacket({} as never, meta as never)
    check.onEncodedPacket({} as never, meta as never)
    expect(sent).toHaveLength(1)
    expect(sent[0].phase).toBe('colour')
    expect(sent[0].message).toBe(
      'source hvc1.2.4.L153.B0 HDR bt2020/hlg/bt2020-ncl/limited; decoded opaque bt2020/hlg/bt2020-ncl/limited; written avc1.640033 2160x3840 bt709/bt709/bt709/limited',
    )
  })
})
