// A made video to the phone's share sheet (Save Video, AirDrop, TikTok).
//
// His report (2026-11-06): pressing Save on a made video opened "an iPhone
// widget that doesn't load anything". A made video is often kept in the
// Cutter's private storage (outputSink), and the share sheet and the
// download preview both failed to read it from there. The video is copied
// into memory as soon as it is shown - not when he taps, which must open the
// sheet at once - and the copy is what is shared.

import { useEffect, useState } from 'react'

import { report } from '../report'

/** A copy of `blob` held in memory, named and typed for the share sheet;
 *  null until it is ready (or with nothing to copy). */
export function useSharable(blob: Blob | null | undefined, name: string): File | null {
  const [file, setFile] = useState<File | null>(null)
  useEffect(() => {
    setFile(null)
    if (!blob) return
    let alive = true
    void blob
      .arrayBuffer()
      .then((bytes) => {
        if (alive) setFile(new File([bytes], name, { type: 'video/mp4' }))
      })
      .catch(() => {
        // Read straight from where it is kept, then.
        if (alive) setFile(new File([blob], name, { type: 'video/mp4' }))
      })
    return () => {
      alive = false
    }
  }, [blob, name])
  return file
}

/** Opens the share sheet with the video. Says whether it opened (he may
 *  close it without saving: that counts). Why it didn't is reported. */
export async function shareVideo(file: File): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false
  try {
    await navigator.share({ files: [file] })
    return true
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return true
    report({ kind: 'check', phase: 'share', message: `share sheet: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)} (${Math.round(file.size / 1e6)} MB)` })
    return false
  }
}

/** Whether this browser has a share sheet at all (a computer may not: it downloads). */
export const hasShareSheet = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function'
