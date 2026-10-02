// Postiz only takes MP4. A finished video saved to Photos - from TikTok, from
// an editor, straight off the camera - often comes out of the picker as a
// QuickTime .mov instead, and Postiz turned those away with "Unsupported
// file type". So a video posted by hand is put into an MP4 first.
//
// Nothing is re-encoded when it doesn't have to be: H.264 and HEVC pictures
// and AAC sound are copied across as they are, so it takes seconds and loses
// nothing. Only a format no platform takes is made again, as H.264 and AAC.

import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { createOutputSink } from '../media/outputSink'

/** Brands at the start of a file that are MP4 already. QuickTime's is "qt  ". */
export function isMp4Header(head: Uint8Array): boolean {
  if (head.length < 12) return false
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  return text(4, 8) === 'ftyp' && text(8, 12) !== 'qt  '
}

export async function isMp4(file: Blob): Promise<boolean> {
  return isMp4Header(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
}

export interface AsMp4 {
  file: File
  /** Its name in the phone's private storage when it had to be made, to
   *  delete it by once it has been kept to send. */
  storedAs: string | null
}

/** The video as an MP4 - the same file when it is one already. */
export async function asMp4(file: File, onProgress?: (fraction: number) => void): Promise<AsMp4> {
  if (await isMp4(file)) return { file, storedAs: null }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const sink = await createOutputSink()
  let done = false
  try {
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      video: async (track) => {
        const codec = await track.getCodec()
        return codec === 'avc' || codec === 'hevc' ? {} : { codec: 'avc', quality: QUALITY_VERY_HIGH }
      },
      audio: async (track) => ((await track.getCodec()) === 'aac' ? {} : { codec: 'aac', quality: QUALITY_HIGH }),
    })
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isVideoTrack())) {
      throw new SilenceCutError(`${file.name} couldn't be turned into an MP4, which Postiz needs. Save it again from Photos, or export it as MP4.`)
    }
    if (onProgress) conversion.onProgress = (fraction) => onProgress(Math.min(0.99, fraction))
    await conversion.execute()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError(`Turning ${file.name} into an MP4 produced nothing. Try again.`)
    done = true
    onProgress?.(1)
    const name = `${file.name.replace(/\.[^./]+$/, '') || 'video'}.mp4`
    return { file: new File([blob], name, { type: 'video/mp4' }), storedAs: sink.storedAs }
  } finally {
    input.dispose()
    if (!done) await sink.discard()
  }
}
