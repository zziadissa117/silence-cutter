// Each video's cover on the profile grid (his ask, 2026-11-11: "make it so
// every cover is different by making it a different timestamp per video, not
// ... always the same one, which is usually the start" - a brand's CEO does
// not like a grid where the videos look the same). Instagram takes a moment
// of the video for the cover (thumb_offset, in ms; 0, the first frame, when
// none is given); Postiz passes a media item's `thumbnailTimestamp` on as
// that.
//
// Each video, on each account, gets its own moment, worked out from the
// post's and the account's ids: different from every other video and
// account, and the same every time it is sent again - a retried send never
// changes it. Never the first frame, never the very end.
//
// No imports: Deno runs it, Vitest tests it.

/** Where in the video a cover may be: past the start, before the end. */
const FROM = 0.12
const TO = 0.88
/** Without a known length: somewhere in its first seconds. */
const UNKNOWN_FROM_MS = 800
const UNKNOWN_TO_MS = 6000

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** The cover's moment, in milliseconds, for one video on one account. */
export function coverMs(postId: string, accountId: string, durationSec: number | null | undefined): number {
  const share = hash(`${postId}|${accountId}`) / 0x100000000
  const total = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 1 ? durationSec * 1000 : null
  if (total === null) return Math.round(UNKNOWN_FROM_MS + share * (UNKNOWN_TO_MS - UNKNOWN_FROM_MS))
  return Math.round(total * (FROM + share * (TO - FROM)))
}

/** A video for Postiz, with its own cover moment. */
export function withCover(media: { id: string; path: string }, postId: string, accountId: string, durationSec: number | null | undefined) {
  return { id: media.id, path: media.path, thumbnailTimestamp: coverMs(postId, accountId, durationSec) }
}
