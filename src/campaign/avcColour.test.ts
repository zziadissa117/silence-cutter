import { describe, expect, it } from 'vitest'

import { H264_DEFAULT, avcColour, packetColour, spsColour } from './avcColour'

/** Writes an H.264 SPS bit by bit, with emulation prevention, so the reader
 *  is tested against the layout the standard sets out. */
function sps({ profile = 100, vui }: { profile?: number; vui?: { fullRange: boolean; colour?: [number, number, number] } }): Uint8Array {
  const bits: number[] = []
  const put = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push(Math.floor(value / 2 ** i) % 2)
  }
  const ue = (v: number) => {
    const n = Math.floor(Math.log2(v + 1))
    put(0, n)
    put(v + 1, n + 1)
  }
  put(0x67, 8) // NAL header, type 7
  put(profile, 8)
  put(0, 8) // constraints
  put(40, 8) // level 4.0
  ue(0) // sps id
  if (profile === 100) {
    ue(1) // 4:2:0
    ue(0)
    ue(0)
    put(0, 1)
    put(1, 1) // scaling matrix present
    put(1, 1) // the first list is sent...
    for (let j = 0; j < 16; j++) ue(0) // ...delta 0 every step: se(0) = ue(0)
    for (let i = 1; i < 8; i++) put(0, 1) // the other seven are not
  }
  ue(0) // log2_max_frame_num_minus4
  ue(0) // poc type 0
  ue(0)
  ue(4) // refs
  put(0, 1)
  ue(67) // 1088 wide → 68 mbs
  ue(119) // 1920 high → 120
  put(1, 1) // frame_mbs_only
  put(1, 1) // direct_8x8
  put(1, 1) // cropping
  ue(0)
  ue(4)
  ue(0)
  ue(0)
  put(vui ? 1 : 0, 1)
  if (vui) {
    put(1, 1) // aspect ratio info
    put(1, 8) // 1:1
    put(0, 1) // overscan
    put(1, 1) // video signal type
    put(5, 3)
    put(vui.fullRange ? 1 : 0, 1)
    put(vui.colour ? 1 : 0, 1)
    if (vui.colour) for (const c of vui.colour) put(c, 8)
    put(0, 1) // chroma loc
    put(0, 1) // timing
    put(0, 1)
    put(0, 1)
    put(0, 1) // pic_struct
    put(0, 1) // bitstream restriction
  }
  put(1, 1) // rbsp stop bit
  while (bits.length % 8) bits.push(0)
  const raw: number[] = []
  for (let i = 0; i < bits.length; i += 8) raw.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  const out: number[] = []
  for (const byte of raw) {
    if (out.length >= 2 && out[out.length - 1] === 0 && out[out.length - 2] === 0 && byte <= 3) out.push(3)
    out.push(byte)
  }
  return Uint8Array.from(out)
}

const avcC = (nal: Uint8Array) => Uint8Array.from([1, 100, 0, 40, 0xff, 0xe1, nal.length >> 8, nal.length & 0xff, ...nal, 1, 0, 0])

describe("what an H.264 stream says about its colour", () => {
  it('reads limited-range BT.709 from the stream', () => {
    expect(spsColour(sps({ vui: { fullRange: false, colour: [1, 1, 1] } }))).toEqual({
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      fullRange: false,
      stated: true,
    })
  })

  it('reads full range and an sRGB curve when that is what was written', () => {
    expect(spsColour(sps({ vui: { fullRange: true, colour: [1, 13, 1] } }))).toMatchObject({ transfer: 'iec61966-2-1', fullRange: true })
  })

  it("takes H.264's defaults - limited BT.709 - when the stream says nothing", () => {
    expect(spsColour(sps({}))).toEqual(H264_DEFAULT)
    expect(spsColour(sps({ profile: 77 }))).toEqual(H264_DEFAULT)
  })

  it('a range with no colour description keeps BT.709', () => {
    expect(spsColour(sps({ vui: { fullRange: true } }))).toEqual({ ...H264_DEFAULT, fullRange: true, stated: true })
  })

  it('finds the SPS in an avcC record or in a packet', () => {
    const nal = sps({ vui: { fullRange: false, colour: [1, 1, 1] } })
    expect(avcColour(avcC(nal))?.fullRange).toBe(false)
    expect(avcColour(avcC(nal).buffer)?.stated).toBe(true)
    expect(packetColour(Uint8Array.from([0, 0, 0, 1, ...nal, 0, 0, 0, 1, 0x68, 0xee]))?.stated).toBe(true)
    const prefixed = Uint8Array.from([0, 0, 0, nal.length, ...nal])
    expect(packetColour(prefixed)?.stated).toBe(true)
  })

  it('changes nothing when it cannot read it', () => {
    expect(avcColour(undefined)).toBeNull()
    expect(avcColour(Uint8Array.from([1, 2]))).toBeNull()
    expect(packetColour(Uint8Array.from([1, 2, 3, 4, 5]))).toBeNull()
  })
})
