// What an H.264 stream itself says about its colour - the "video signal
// type" in its sequence parameter set (SPS) - read from the encoder's avcC.
//
// Safari's encoder reports a colour for what it wrote that is not what it
// wrote: an iPhone's ordinary limited-range BT.709 take came back labelled
// sRGB, full range ("written avc1.640028 bt709/iec61966-2-1/bt709/full").
// mediabunny puts that label in the MP4 (its `colr` box), so apps that trust
// the box and apps that trust the stream show the same video with different
// black and white levels - the harsh-contrast "filter" seen once posted. The
// stream is what the encoder actually made, so the box is set from it.

export interface StreamColour {
  primaries: VideoColorPrimaries
  transfer: VideoTransferCharacteristics
  matrix: VideoMatrixCoefficients
  fullRange: boolean
  /** Whether the stream said anything, or these are H.264's defaults. */
  stated: boolean
}

// 8-bit H.264 made from a canvas is never HDR; anything else reads as BT.709.
const PRIMARIES: Record<number, VideoColorPrimaries> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' }
const TRANSFERS: Record<number, VideoTransferCharacteristics> = { 1: 'bt709', 6: 'smpte170m', 13: 'iec61966-2-1' }
const MATRICES: Record<number, VideoMatrixCoefficients> = { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' }

/** What every player assumes of an H.264 stream that says nothing. */
export const H264_DEFAULT: StreamColour = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false, stated: false }

class Bits {
  private pos = 0
  private readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  bit(): number {
    const byte = this.bytes[this.pos >> 3]
    if (byte === undefined) throw new RangeError('SPS ended early')
    const value = (byte >> (7 - (this.pos & 7))) & 1
    this.pos++
    return value
  }
  bits(n: number): number {
    let value = 0
    for (let i = 0; i < n; i++) value = value * 2 + this.bit()
    return value
  }
  ue(): number {
    let zeros = 0
    while (this.bit() === 0) {
      if (++zeros > 31) throw new RangeError('bad Exp-Golomb code')
    }
    return 2 ** zeros - 1 + this.bits(zeros)
  }
  se(): number {
    const k = this.ue()
    return k % 2 === 1 ? (k + 1) / 2 : -k / 2
  }
}

/** The SPS without its emulation-prevention bytes (00 00 03 → 00 00). */
function unescape(nal: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue
    out.push(nal[i])
  }
  return Uint8Array.from(out)
}

function skipScalingList(b: Bits, size: number): void {
  let last = 8
  let next = 8
  for (let j = 0; j < size; j++) {
    if (next !== 0) next = (last + b.se() + 256) % 256
    last = next === 0 ? last : next
  }
}

/** The colour an SPS NAL unit (with its one-byte header) states. */
export function spsColour(nal: Uint8Array): StreamColour {
  const b = new Bits(unescape(nal))
  b.bits(8) // NAL header
  const profile = b.bits(8)
  b.bits(16) // constraint flags, level
  b.ue() // seq_parameter_set_id
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    const chroma = b.ue()
    if (chroma === 3) b.bit() // separate_colour_plane_flag
    b.ue() // bit_depth_luma_minus8
    b.ue() // bit_depth_chroma_minus8
    b.bit() // qpprime_y_zero_transform_bypass_flag
    if (b.bit()) {
      // seq_scaling_matrix_present_flag
      for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) if (b.bit()) skipScalingList(b, i < 6 ? 16 : 64)
    }
  }
  b.ue() // log2_max_frame_num_minus4
  const pocType = b.ue()
  if (pocType === 0) b.ue()
  else if (pocType === 1) {
    b.bit()
    b.se()
    b.se()
    const cycle = b.ue()
    for (let i = 0; i < cycle; i++) b.se()
  }
  b.ue() // max_num_ref_frames
  b.bit() // gaps_in_frame_num_value_allowed_flag
  b.ue() // pic_width_in_mbs_minus1
  b.ue() // pic_height_in_map_units_minus1
  if (!b.bit()) b.bit() // frame_mbs_only_flag, mb_adaptive_frame_field_flag
  b.bit() // direct_8x8_inference_flag
  if (b.bit()) {
    // frame_cropping_flag
    b.ue()
    b.ue()
    b.ue()
    b.ue()
  }
  if (!b.bit()) return H264_DEFAULT // vui_parameters_present_flag
  if (b.bit()) {
    // aspect_ratio_info_present_flag
    if (b.bits(8) === 255) b.bits(32)
  }
  if (b.bit()) b.bit() // overscan
  if (!b.bit()) return H264_DEFAULT // video_signal_type_present_flag
  b.bits(3) // video_format
  const fullRange = b.bit() === 1
  if (!b.bit()) return { ...H264_DEFAULT, fullRange, stated: true } // colour_description_present_flag
  const [p, t, m] = [b.bits(8), b.bits(8), b.bits(8)]
  return {
    primaries: PRIMARIES[p] ?? 'bt709',
    transfer: TRANSFERS[t] ?? 'bt709',
    matrix: MATRICES[m] ?? 'bt709',
    fullRange,
    stated: true,
  }
}

/** The colour of the first SPS in an avcC record, or null when it can't be
 *  read (then nothing is changed). */
export function avcColour(description: AllowSharedBufferSource | undefined): StreamColour | null {
  if (!description) return null
  try {
    const bytes =
      description instanceof ArrayBuffer
        ? new Uint8Array(description)
        : ArrayBuffer.isView(description)
          ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
          : new Uint8Array(description as ArrayBufferLike)
    if (bytes[0] !== 1 || (bytes[5] & 0x1f) === 0) return null
    const length = (bytes[6] << 8) | bytes[7]
    return spsColour(bytes.subarray(8, 8 + length))
  } catch {
    return null
  }
}

/** The colour of the first SPS found in a packet - Annex B (start codes) or
 *  length-prefixed - for an encoder that sends no avcC. */
export function packetColour(data: Uint8Array): StreamColour | null {
  try {
    for (let i = 0; i + 3 < data.length; i++) {
      // Annex B: 00 00 01 then the NAL header.
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
        let end = i + 3
        while (end + 2 < data.length && !(data[end] === 0 && data[end + 1] === 0 && (data[end + 2] === 1 || data[end + 2] === 0))) end++
        return spsColour(data.subarray(i + 3, end + 2 < data.length ? end : data.length))
      }
    }
    // Length-prefixed (4 bytes each).
    for (let i = 0; i + 4 < data.length; ) {
      const length = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0
      if (length === 0 || i + 4 + length > data.length) break
      if ((data[i + 4] & 0x1f) === 7) return spsColour(data.subarray(i + 4, i + 4 + length))
      i += 4 + length
    }
  } catch {
    // Unreadable: nothing is changed.
  }
  return null
}
