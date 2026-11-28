// A batch the owner shares with his students (his ask, 2026-11-28: "share
// batches to students, so they only have to film and drop in clips"). The
// phone packs it (src/campaign/batchShare.ts): the campaign and its batch's
// setup, its product clips and pictures - never his own clips. Its files go
// to `share/<share id>/<key>` in the cutter-files bucket (his OK, the same
// day: the product clips through the Cutter's storage), what it is to
// `share:<student space>:<share id>` in cutter_config, one row per student.
// A student's phone takes it once and says it is done; the files go once
// every student it went to has taken it. Plain TypeScript, for Deno and tests.

/** A share's id: made by the server. */
export const SHARE_ID = /^[a-z0-9]{8,40}$/
/** A file's key inside a share: the phone's file id, or c<n> for a picture of the campaign. */
export const SHARE_KEY = /^[A-Za-z0-9_-]{1,80}$/

export const shareRow = (spaceId: string, shareId: string) => `share:${spaceId}:${shareId}`
export const sharePath = (shareId: string, key: string) => `share/${shareId}/${key}`

/** The keys asked for that are fine to use: well formed, each once, at most `most`. */
export function cleanKeys(value: unknown, most = 500): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((k): k is string => typeof k === 'string' && SHARE_KEY.test(k)))].slice(0, most)
}

/** The students' names asked for, as login names (cutter cleanLoginName rules). */
export function cleanNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((n): n is string => typeof n === 'string').map((n) => n.trim().toLowerCase()).filter((n) => /^[a-z0-9_.-]{3,30}$/.test(n)))].slice(0, 100)
}
