// Recognising the same recording twice.
//
// A picked video has no id of its own - the browser hands over a name and some
// bytes - and the same file can arrive again however it is picked: the camera
// roll opened twice, a "pick more" that includes the first, a post tapped
// again after the screen was left. Each arrival used to get a fresh random id,
// so nothing could tell the second from a different video and it was kept,
// mixed into batches and posted as well.
//
// The fingerprint is the file's size plus a SHA-256 over three one-megabyte
// samples (the start, the middle, the end). Hashing a whole phone video would
// mean reading hundreds of megabytes before anything is even shown; three
// samples plus the exact size tell two recordings apart in practice - two
// different takes never share a size and the bytes of all three samples - and
// it costs a few milliseconds whatever the video's length.

const SAMPLE = 1_000_000

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** `size-<sha256 of the samples>`. Equal for equal files, whatever they are called. */
export async function fingerprint(file: Blob): Promise<string> {
  const middle = Math.max(0, Math.floor(file.size / 2) - Math.floor(SAMPLE / 2))
  const pieces = await Promise.all([
    file.slice(0, SAMPLE).arrayBuffer(),
    file.slice(middle, middle + SAMPLE).arrayBuffer(),
    file.slice(Math.max(0, file.size - SAMPLE)).arrayBuffer(),
  ])
  const all = new Uint8Array(pieces.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const piece of pieces) {
    all.set(new Uint8Array(piece), at)
    at += piece.byteLength
  }
  return `${file.size}-${(await sha256Hex(all.buffer)).slice(0, 32)}`
}

/** The ones in `files` that have not been seen: not in `known`, and not
 *  repeated within `files` itself. Returns what to keep and what to say. */
export function newOnes<T extends { fp: string; name: string }>(
  files: readonly T[],
  known: ReadonlySet<string>,
): { fresh: T[]; skipped: string[] } {
  const seen = new Set(known)
  const fresh: T[] = []
  const skipped: string[] = []
  for (const file of files) {
    if (seen.has(file.fp)) skipped.push(file.name)
    else {
      seen.add(file.fp)
      fresh.push(file)
    }
  }
  return { fresh, skipped }
}

/** "Skipped 2 duplicates: a.mp4, b.mp4" - said plainly, never silently. */
export function skippedNotice(skipped: readonly string[], where: string): string | null {
  if (skipped.length === 0) return null
  const names = skipped.length <= 3 ? skipped.join(', ') : `${skipped.slice(0, 3).join(', ')} and ${skipped.length - 3} more`
  return `Duplicate skipped: ${names} ${skipped.length === 1 ? 'is' : 'are'} already ${where}.`
}

/** The send key of a video posted by hand: what is in it, the campaign it is
 *  for, and the day. The same video for the same campaign on the same day is
 *  the same post - tapping Post twice, or picking it again, lands on the same
 *  key and the server's one-post-per-key rule does the rest - while another
 *  day, or another campaign, is a deliberate new post. */
export function handPostKey(fp: string, campaignId: string, day: string): string {
  return `post-${fp}-${campaignId}-${day}`
}
