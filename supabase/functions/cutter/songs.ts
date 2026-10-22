// The music bank, shared by everyone who uses the Cutter: the same songs on
// every phone, added once by anyone. Only ever sound - a song taken from a
// video is its sound alone, made on the phone (musicBank.soundOf).
//
// Each song is a row of cutter_config, `song:<id>`, read and written only by
// the cutter function, after a valid login. Its file is in the cutter-files
// bucket at music/<sha>, named by what is in it, so the same song is only
// ever uploaded once.
//
// No imports: the cutter function runs it on Deno, the tests under Vitest.

export const SONG_KEY = 'song:'
export const MUSIC_DIR = 'music'
/** A song's file, at most: an M4A or MP3 of a few minutes is a few MB. */
export const MAX_SONG_BYTES = 40_000_000

export interface SharedSong {
  id: string
  name: string
  type: string
  size: number
  /** What is in it (fingerprint.ts), so the same recording is kept once. */
  fp?: string
  /** SHA-256 of the file: where it is kept. */
  sha: string
  addedAt: number
}

const SHA = /^[0-9a-f]{64}$/
const ID = /^[\w-]{1,80}$/

/** A song as a phone sent it, checked - or null. */
export function cleanSong(value: unknown, now = Date.now()): SharedSong | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const id = typeof v.id === 'string' && ID.test(v.id) ? v.id : null
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, 120) : ''
  const type = typeof v.type === 'string' && /^audio\/[\w.+-]+$/.test(v.type) ? v.type : null
  const size = Number(v.size)
  const sha = typeof v.sha === 'string' && SHA.test(v.sha) ? v.sha : null
  const fp = typeof v.fp === 'string' && v.fp.length > 0 && v.fp.length <= 200 ? v.fp : undefined
  if (!id || !name || !type || !sha || !Number.isInteger(size) || size <= 0 || size > MAX_SONG_BYTES) return null
  const addedAt = Number(v.addedAt)
  return { id, name, type, size, sha, ...(fp ? { fp } : {}), addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : now }
}

/** The song already in the bank that is this one: the same file, or the
 *  same recording. */
export function sameSong(songs: readonly SharedSong[], song: Pick<SharedSong, 'sha' | 'fp'>): SharedSong | null {
  return songs.find((s) => s.sha === song.sha || (song.fp !== undefined && s.fp === song.fp)) ?? null
}

/** The songs from their cutter_config rows, oldest first, any bad row left out. */
export function songsFrom(rows: readonly { value: string }[]): SharedSong[] {
  const songs: SharedSong[] = []
  for (const row of rows) {
    try {
      const song = cleanSong(JSON.parse(row.value), 0)
      if (song) songs.push(song)
    } catch {
      // Not a song.
    }
  }
  return songs.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))
}
