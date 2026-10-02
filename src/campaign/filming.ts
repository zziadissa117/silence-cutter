// When a recording was filmed, read from the file - iPhone videos carry the
// moment they were filmed - and how long it is. Two recordings filmed
// moments apart are likely one video filmed in parts (the selfie camera,
// then the back camera), so they are offered to be joined. Only offered:
// the file says nothing about which camera, so nothing is joined without
// his tap.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'

import { within } from '../media/within'

export interface Filming {
  filmedAt?: number
  seconds?: number
}

/** The gap between two recordings of one video: flipping the camera and
 *  starting again. Separate videos, filmed one after another, usually have
 *  more between them than this. */
const PARTS_GAP_MS = 30_000

/** Never holds up adding the videos: a file that won't say in time says
 *  nothing. */
export async function filmingOf(file: Blob): Promise<Filming> {
  const read = async (): Promise<Filming> => {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    try {
      const [tags, seconds] = await Promise.all([input.getMetadataTags().catch(() => null), input.computeDuration()])
      return { ...(tags?.date ? { filmedAt: tags.date.getTime() } : {}), seconds }
    } finally {
      input.dispose()
    }
  }
  return within(
    read().catch(() => ({})),
    3000,
    {},
  )
}

/** Recordings worth offering to join, first part then second: each filmed
 *  right after the one before it ends. A video is in one pair at most. */
export function joinSuggestions(
  videos: { id: string; filmedAt?: number; seconds?: number }[],
  dismissed: Set<string>,
): [string, string][] {
  const timed = videos
    .filter((v) => v.filmedAt !== undefined && v.seconds !== undefined)
    .sort((a, b) => a.filmedAt! - b.filmedAt!)
  const pairs: [string, string][] = []
  const used = new Set<string>()
  for (let i = 0; i + 1 < timed.length; i++) {
    const [a, b] = [timed[i], timed[i + 1]]
    if (used.has(a.id)) continue
    const gap = b.filmedAt! - (a.filmedAt! + a.seconds! * 1000)
    if (gap >= -5000 && gap <= PARTS_GAP_MS && !dismissed.has(`${a.id}|${b.id}`)) {
      pairs.push([a.id, b.id])
      used.add(a.id)
      used.add(b.id)
    }
  }
  return pairs
}
