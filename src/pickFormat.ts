// Why a picked video can take a minute or more to arrive, and the one
// iPhone setting that makes it instant.
//
// Measured in September 2026 in the iOS Simulator (Safari) with one of his
// real 26-second 4K clips. The photo picker's Format option starts on
// "Automatic", which re-encodes an iPhone's own HEVC video into H.264 before
// the page gets anything: 40 seconds or more for that one clip, 196 MB down
// to 83 MB, with only a small circle on the thumbnail to show for it. Nothing
// reaches the page until it is done, so a day's worth of 4K takes minutes of
// "I picked them and nothing happened". Set to "Current", the same clip
// arrived in about three seconds, untouched, and the picker kept that choice
// for every pick after.
//
// No accept attribute changes it - video/*, video/quicktime, video/hevc and
// none at all were all re-encoded - so only he can flip it. The page says
// how until it sees an untouched video come in, and says it louder right
// after a pick that was converted.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'

import { within } from './media/within'

const KEY = 'pick.originals'

/** An iPhone or iPad, where the photo picker converts. */
export function isAppleTouch(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** An untouched video has come through the picker on this phone, so it is
 *  already set to Current. */
export function originalsArrive(): boolean {
  try {
    return localStorage.getItem(KEY) === 'yes'
  } catch {
    return false
  }
}

async function codecOf(file: File): Promise<string | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    return (await (await input.getPrimaryVideoTrack())?.getCodec()) ?? null
  } finally {
    input.dispose()
  }
}

/** Whether the picker handed these over as they were recorded - an iPhone
 *  records HEVC - or converted them to H.264 on the way. Remembers the
 *  first. 'unknown' for anything else, or when the file can't be read in a
 *  few seconds; this is only ever advice. */
export async function pickedAs(files: File[]): Promise<'original' | 'converted' | 'unknown'> {
  if (!isAppleTouch() || files.length === 0) return 'unknown'
  const codecs = await Promise.all(files.slice(0, 3).map((f) => within(codecOf(f).catch(() => null), 5000, null)))
  if (codecs.includes('hevc')) {
    try {
      localStorage.setItem(KEY, 'yes')
    } catch {
      // Just asked again next time.
    }
    return 'original'
  }
  return codecs.length > 0 && codecs.every((c) => c === 'avc') ? 'converted' : 'unknown'
}

/** What the add button says under it, if anything: how to switch the picker
 *  to Current, or - right after a converted pick - that that was the wait. */
export type PickTip = 'how' | 'converted' | null

let lastPick: 'converted' | null = null

export function pickTip(): PickTip {
  if (!isAppleTouch() || originalsArrive()) return null
  return lastPick ?? 'how'
}

/** Looks at what just came through and says what the tip is now. */
export async function afterPick(files: File[]): Promise<PickTip> {
  const as = await pickedAs(files)
  if (as === 'converted') lastPick = 'converted'
  return pickTip()
}
