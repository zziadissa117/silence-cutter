// Videos joined onto a talking head: one before it - a hook, like someone
// doing it wrong before he comes on with "Oh hell no, do this instead" - and
// one after it, like a product showcase. Set on an angle, every video in it
// gets them; each video can change them before it is made.
//
// They stay on this phone. They are his own footage, and the angles his
// friend shares through the login are not touched by them: an angle's clips
// are kept here, by angle, rather than in the angle itself.

import { SilenceCutError } from '../media/errors'
import { openClip } from './clipParts'
import {
  clipsPickedByJobs,
  deleteClipFile,
  getMeta,
  loadClipFile,
  loadClipRows,
  saveClipFile,
  setMeta,
  type StoredClip,
} from './store'

export type ClipPlace = 'before' | 'after'
export const CLIP_PLACES: ClipPlace[] = ['before', 'after']
export type ClipInfo = StoredClip
/** The clips set on one angle, by clip id. */
export type AngleClips = Partial<Record<ClipPlace, string>>
/** The clips one video is made with, and any it should have had that are
 *  no longer on this phone. */
export type JoinedClips = Partial<Record<ClipPlace, Blob>> & { missing?: ClipPlace[] }

const ANGLE_CLIPS = 'angleClips'
/** Far past any hook or showcase; stops a whole film filling the phone. */
const MAX_BYTES = 400e6
/** How long a clip nothing uses yet is kept: it was just added, and is
 *  about to be picked. */
const FRESH_MS = 60 * 60 * 1000

export const angleKey = (campaignId: string, angleId: string) => `${campaignId}/${angleId}`

/** Keeps a clip from the phone's videos, once it is known to be readable. */
export async function addClip(file: File): Promise<ClipInfo> {
  if (file.size > MAX_BYTES) throw new SilenceCutError('That clip is over 400 MB. Trim it in Photos first.')
  // The same clip picked again is the one already kept, not a second copy.
  const same = (await loadClipRows()).find((c) => c.name === file.name && c.size === file.size)
  if (same) return same
  let seconds: number
  try {
    const clip = await openClip(file, 'chosen')
    seconds = clip.duration - clip.first
    clip.input.dispose()
  } catch (error) {
    if (error instanceof SilenceCutError) throw error
    throw new SilenceCutError("That video can't be read here. Try saving it again from Photos.")
  }
  const clip: ClipInfo = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || 'video/mp4',
    size: file.size,
    seconds,
    addedAt: Date.now(),
  }
  try {
    await saveClipFile(clip, file)
  } catch {
    throw new SilenceCutError("There isn't room on this phone to keep that clip. Clear some space and try again.")
  }
  return clip
}

export const listClips = loadClipRows
export const clipFile = loadClipFile

export async function loadAngleClips(): Promise<Record<string, AngleClips>> {
  try {
    const parsed: unknown = JSON.parse((await getMeta(ANGLE_CLIPS)) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, AngleClips>) : {}
  } catch {
    return {}
  }
}

/** Sets one angle's clips, and returns every angle's. */
export async function saveAngleClips(key: string, clips: AngleClips): Promise<Record<string, AngleClips>> {
  const all = { ...(await loadAngleClips()) }
  const kept: AngleClips = {}
  for (const place of CLIP_PLACES) if (clips[place]) kept[place] = clips[place]
  if (kept.before || kept.after) all[key] = kept
  else delete all[key]
  await setMeta(ANGLE_CLIPS, JSON.stringify(all))
  return all
}

/** The clip a video gets in one place: the one it picked, none, or its
 *  angle's. */
export function clipFor(pick: string | undefined, angleClip: string | undefined): string | null {
  if (pick === 'none') return null
  return pick ?? angleClip ?? null
}

/** Clips nothing uses: on no angle, picked by no waiting video, and not just
 *  added. */
export function unusedClips(clips: ClipInfo[], angleClips: Record<string, AngleClips>, picked: string[], now: number): string[] {
  const used = new Set(picked)
  for (const set of Object.values(angleClips)) for (const place of CLIP_PLACES) if (set[place]) used.add(set[place]!)
  return clips.filter((clip) => !used.has(clip.id) && now - clip.addedAt > FRESH_MS).map((clip) => clip.id)
}

/** Forgets the clips of angles that no longer exist, then deletes clips
 *  nothing uses. `angles` is every angle there is, as angleKey; with none
 *  known yet, nothing is touched. */
export async function tidyClips(angles: string[]): Promise<void> {
  if (angles.length === 0) return
  const live = new Set(angles)
  let angleClips = await loadAngleClips()
  const gone = Object.keys(angleClips).filter((key) => !live.has(key))
  if (gone.length > 0) {
    angleClips = Object.fromEntries(Object.entries(angleClips).filter(([key]) => live.has(key)))
    await setMeta(ANGLE_CLIPS, JSON.stringify(angleClips))
  }
  const [clips, picked] = await Promise.all([loadClipRows(), clipsPickedByJobs()])
  for (const id of unusedClips(clips, angleClips, picked, Date.now())) await deleteClipFile(id)
}
