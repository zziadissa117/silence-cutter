// Each person's voice, measured once (his ask, 2026-11-11: "upload some
// recordings of our voices ... so we can adapt ... to how each person talks
// ... make sure it cuts silences perfectly"). A 45-second recording on the mic
// he films with (VoiceSetup.tsx): 3 seconds of quiet, a paragraph read the
// way he talks, a few "um"s, a breath. From it, what one video alone can't
// tell the cutter:
//   - how quiet his room is on that mic, and how loud he talks;
//   - how far his voice drops on the last sound of a word - the line between
//     "talking" and "silence" goes under that, so word endings are kept;
//   - his natural gap between words - a gap that short is never cut;
//   - how his "um" sounds - its loudness and length - for umFind.ts.
// A video that sounds clearly different (another mic, another phone) is cut
// without it, and he is asked to record it again.

import type { Level, SilenceSettings } from '../media/silenceMath'

export interface VoiceProfile {
  /** Which of his voices this is ("With my mic", "Phone mic"). */
  id?: string
  name?: string
  /** His room on that mic: where its quietest tenth sits, in dB. */
  roomDb: number
  /** His talking: where its loudest tenth sits. */
  speechDb: number
  /** How low his voice goes inside a word or at its end, before real quiet. */
  tailDb: number
  /** His usual short gap between two words, in seconds. */
  gapSec: number
  /** His "um": its usual loudness and length, when he said some. */
  umDb?: number
  umSec?: number
  /** The mic it was recorded on, as the phone names it. */
  mic?: string
  at: number
}

// Several of his voices (his ask, 2026-11-11: "sometimes I would have to
// record without a mic"): one per mic. Each video takes the one it sounds
// like by itself; he can pin one instead.
const OLD_KEY = 'voice.profile'
const KEY = 'voice.profiles'
const USE_KEY = 'voice.use'
const OFF_KEY = 'voice.offCount'
/** At most this many voices kept. */
const MOST = 4

const usable = (p: VoiceProfile | null | undefined): p is VoiceProfile => Boolean(p && Number.isFinite(p.roomDb) && Number.isFinite(p.speechDb))

export function loadProfiles(): VoiceProfile[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return (JSON.parse(raw) as VoiceProfile[]).filter(usable).map((p, i) => ({ ...p, id: p.id ?? `v${i}` }))
    const old = localStorage.getItem(OLD_KEY)
    const one = old ? (JSON.parse(old) as VoiceProfile) : null
    return usable(one) ? [{ ...one, id: 'v0', name: one.name ?? micName(one.mic) }] : []
  } catch {
    return []
  }
}

function saveProfiles(list: VoiceProfile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    localStorage.removeItem(OLD_KEY)
    localStorage.removeItem(OFF_KEY)
  } catch {
    // Measured again next time.
  }
}

/** A voice's name from the mic it was recorded on. */
export function micName(mic: string | undefined): string {
  if (!mic || /iphone|built-in|default|internal|phone/i.test(mic)) return 'Phone mic'
  return mic.replace(/\s*\(.*\)\s*$/, '').slice(0, 40) || 'My mic'
}

/** Any voice of his (for the reminder and Settings). */
export function loadProfile(): VoiceProfile | null {
  return loadProfiles()[0] ?? null
}

/** A new voice: in place of the one on the same mic, else added. */
export function addProfile(profile: VoiceProfile): VoiceProfile {
  const list = loadProfiles()
  const name = profile.name ?? micName(profile.mic)
  const same = list.find((p) => p.name === name)
  const made = { ...profile, id: same?.id ?? `v${Date.now().toString(36)}`, name }
  saveProfiles([...list.filter((p) => p.id !== made.id), made].slice(-MOST))
  return made
}

export function removeProfile(id: string): void {
  saveProfiles(loadProfiles().filter((p) => p.id !== id))
  if (chosenVoice() === id) chooseVoice('auto')
}

/** 'auto': each video takes the voice it sounds like. Else the one he pinned. */
export function chosenVoice(): string {
  try {
    return localStorage.getItem(USE_KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

export function chooseVoice(id: string): void {
  try {
    localStorage.setItem(USE_KEY, id)
  } catch {
    // Automatic, then.
  }
}

/** Kept for one voice (the first version): saves it as his only one. */
export function saveProfile(profile: VoiceProfile | null): void {
  if (profile) saveProfiles([{ ...profile, id: profile.id ?? 'v0', name: profile.name ?? micName(profile.mic) }])
  else saveProfiles([])
}

/** How many videos in a row sounded unlike the profile (another mic). */
export function offCount(): number {
  try {
    return Number(localStorage.getItem(OFF_KEY)) || 0
  } catch {
    return 0
  }
}

function noteOff(off: boolean): void {
  try {
    localStorage.setItem(OFF_KEY, String(off ? offCount() + 1 : 0))
  } catch {
    // Not counted.
  }
}

const finite = (levels: readonly Level[]) => levels.map((l) => l.db).filter((db) => Number.isFinite(db))

export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return -Infinity
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * (sorted.length - 1))))]
}

const within = (levels: readonly Level[], from: number, to: number) => levels.filter((l) => l.time >= from && l.time < to)

/** The parts of the setup recording, in seconds from its start. */
export interface SetupMarks {
  /** He stays quiet until here. */
  quietEnd: number
  readStart: number
  readEnd: number
  /** His "um"s, when he said some. */
  umStart?: number
  umEnd?: number
}

/** The profile, from the setup recording's loudness (20 ms windows) and
 *  where each part of it was. Null when it can't be read: too short, or no
 *  talking louder than the room. */
export function measureProfile(levels: readonly Level[], marks: SetupMarks, mic?: string, now = Date.now()): VoiceProfile | null {
  const quiet = finite(within(levels, 0.3, marks.quietEnd))
  const read = within(levels, marks.readStart, marks.readEnd)
  const readDb = finite(read)
  if (quiet.length < 20 || readDb.length < 100) return null
  const roomDb = percentile(quiet, 0.5)
  const speechDb = percentile(readDb, 0.9)
  if (!(speechDb - roomDb >= 12)) return null
  // Where his voice is: everything clearly above the room.
  const voiced = readDb.filter((db) => db > roomDb + 6)
  // Word endings and quiet sounds inside words: the low end of his voice.
  const tailDb = Math.max(roomDb + 4, percentile(voiced, 0.1))
  // His gaps: runs under the tail line between two stretches of voice.
  const gaps: number[] = []
  let run = 0
  let sawVoice = false
  const step = levels.length > 1 ? levels[1].time - levels[0].time : 0.02
  for (const l of read) {
    if (l.db < tailDb) run += step
    else {
      if (sawVoice && run > 0.03) gaps.push(run)
      run = 0
      sawVoice = true
    }
  }
  // His short gaps between words - the long ones are pauses.
  const short = gaps.filter((g) => g < 0.6)
  const gapSec = short.length >= 4 ? Math.min(0.45, percentile(short, 0.75)) : 0.15
  let umDb: number | undefined
  let umSec: number | undefined
  if (marks.umStart !== undefined && marks.umEnd !== undefined) {
    const um = within(levels, marks.umStart, marks.umEnd)
    // Each "um": a run of voice.
    const runs: { db: number[] }[] = []
    let current: number[] = []
    for (const l of um) {
      if (l.db > roomDb + 10) current.push(l.db)
      else {
        if (current.length * step >= 0.15) runs.push({ db: current })
        current = []
      }
    }
    if (current.length * step >= 0.15) runs.push({ db: current })
    if (runs.length > 0) {
      umDb = percentile(runs.flatMap((r) => r.db), 0.5)
      umSec = percentile(
        runs.map((r) => r.db.length * step),
        0.5,
      )
    }
  }
  return { roomDb, speechDb, tailDb, gapSec, ...(umDb !== undefined ? { umDb, umSec } : {}), ...(mic ? { mic } : {}), at: now }
}

/** Whether a video sounds like the profile: about as loud a voice, about as
 *  quiet a room. Clearly not - another mic or phone - and it is cut without. */
export function soundsLike(levels: readonly Level[], profile: VoiceProfile): boolean {
  const heard = finite(levels)
  if (heard.length < 100) return false
  const speech = percentile(heard, 0.9)
  const room = percentile(heard, 0.1)
  return Math.abs(speech - profile.speechDb) <= 10 && room <= profile.tailDb + 3
}

/** How far a video is from a voice: how much louder or quieter his voice and
 *  his room are. */
function distance(levels: readonly Level[], profile: VoiceProfile): number {
  const heard = finite(levels)
  return Math.abs(percentile(heard, 0.9) - profile.speechDb) + Math.abs(percentile(heard, 0.1) - profile.roomDb) / 2
}

/** The voice a video is cut with: the one he pinned, or - automatic - the one
 *  it sounds most like, none when it sounds like none of them. */
export function pickProfile(levels: readonly Level[], profiles: readonly VoiceProfile[], use = 'auto'): { profile: VoiceProfile | null; pinned: boolean } {
  if (use !== 'auto') {
    const pinned = profiles.find((p) => p.id === use)
    if (pinned) return { profile: pinned, pinned: true }
  }
  const like = profiles.filter((p) => soundsLike(levels, p)).sort((a, b) => distance(levels, a) - distance(levels, b))
  return { profile: like[0] ?? null, pinned: false }
}

/** His settings for one video, with his voice in: the silence line under
 *  his word endings (never higher than he set it, never far lower), and no
 *  pause shorter than his natural gap between words. Given several voices,
 *  the one it sounds like (pickProfile), or the one he pinned (`use`). The
 *  same settings when it sounds like none of them. */
export function withProfile(
  settings: SilenceSettings,
  levels: readonly Level[],
  voices: VoiceProfile | readonly VoiceProfile[] | null,
  use = 'auto',
): { settings: SilenceSettings; used: boolean; profile: VoiceProfile | null } {
  const list = voices ? (Array.isArray(voices) ? voices : [voices as VoiceProfile]) : []
  if (list.length === 0) return { settings, used: false, profile: null }
  const { profile, pinned } = pickProfile(levels, list, use)
  if (!pinned) noteOff(!profile)
  if (!profile) return { settings, used: false, profile: null }
  const line = (profile.roomDb + profile.tailDb) / 2
  const thresholdDb = Math.max(settings.thresholdDb - 15, Math.min(settings.thresholdDb, line))
  const minSilenceSec = Math.min(0.6, Math.max(settings.minSilenceSec, profile.gapSec + 0.05))
  return { settings: { ...settings, thresholdDb, minSilenceSec }, used: true, profile }
}
