// How long a song is, next to how long his video will be once it is cut -
// his ask (2026-11-06): "my video, let's say, is 50 seconds long, and I don't
// want to put music that's under that". A song under a talking video stops
// where it ends (music.ts), so a short one leaves the end silent.
//
// The length is read from the file's own header (mediabunny), once per song,
// and kept on the phone - never downloading a song just to measure it.

import { useEffect, useState } from 'react'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'

import { keptLength } from './cuts'
import type { Job } from './jobs'

const KEY = 'campaign.songLengths'
const known = new Map<string, number>(readKept())

function readKept(): [string, number][] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (Object.entries(JSON.parse(raw)).filter(([, v]) => typeof v === 'number') as [string, number][]) : []
  } catch {
    return []
  }
}

function keep(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(known)))
  } catch {
    // Measured again next time.
  }
}

/** Seconds of sound in `file`, or null when it can't be read. */
export async function measureSong(file: Blob): Promise<number | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const seconds = await input.computeDuration()
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  } catch {
    return null
  } finally {
    input.dispose()
  }
}

export interface SongToMeasure {
  key: string
  /** Its length when already known (a bank file's `seconds`). */
  seconds?: number
  /** The file, only if it is on the phone already. */
  load: () => Promise<Blob | null>
}

/** The lengths of `songs` as they are measured, by key. */
export function useSongLengths(songs: SongToMeasure[]): Record<string, number> {
  const [lengths, setLengths] = useState<Record<string, number>>(() => lengthsNow(songs))
  const keys = songs.map((s) => s.key).join('|')
  useEffect(() => {
    let alive = true
    setLengths(lengthsNow(songs))
    void (async () => {
      for (const song of songs) {
        if (!alive) return
        if (known.has(song.key) || song.seconds) continue
        const file = await song.load().catch(() => null)
        const seconds = file ? await measureSong(file) : null
        if (seconds === null) continue
        known.set(song.key, seconds)
        keep()
        if (alive) setLengths((now) => ({ ...now, [song.key]: seconds }))
      }
    })()
    return () => {
      alive = false
    }
  }, [keys]) // eslint-disable-line react-hooks/exhaustive-deps
  return lengths
}

function lengthsNow(songs: SongToMeasure[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of songs) {
    const seconds = s.seconds ?? known.get(s.key)
    if (seconds) out[s.key] = seconds
  }
  return out
}

/** How long the video comes out once it is cut: what is kept of it (his own
 *  cuts when he changed them), or all of it when it isn't cut. Null before it
 *  has been listened to. */
export function cutLength(job: Pick<Job, 'day'>): number | null {
  const plan = job.day?.plan
  if (!plan) return null
  if (job.day?.noSpeech) return plan.duration
  const keep = job.day?.keep ?? plan.keep
  return keep.length > 0 ? keptLength(keep) : null
}

/** "0:42". */
export function songTime(s: number): string {
  return `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`
}

/** What to tell him: the song against the video. */
export function songAgainstVideo(song: number | undefined, video: number | null): { text: string; short: boolean } | null {
  if (!song) return null
  const time = songTime
  if (video === null) return { text: `Song ${time(song)}.`, short: false }
  const gap = Math.round(video - song)
  if (gap >= 1) return { text: `Song ${time(song)} · your video ${time(video)} once cut - the song ends ${gap} s before the video does.`, short: true }
  return { text: `Song ${time(song)} · your video ${time(video)} once cut - the song lasts the whole video.`, short: false }
}
