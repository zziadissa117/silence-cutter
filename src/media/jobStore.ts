// Durable storage for the queue, so a video that has been added survives
// whatever happens to the tab before it is cut - a reload, the browser
// discarding the page for memory, or the phone killing it outright.
//
// Two things here are deliberate and both were learned the hard way.
//
// The video is not read at startup. Only the small metadata row is, and the
// file itself is fetched when its turn actually comes. Pulling ten videos'
// worth of bytes back into memory the moment the page opens is a good way to
// be killed for using too much memory before anything has started.
//
// And every attempt is counted, before it begins. A video heavy enough to
// crash the tab would otherwise be restored on the next load, crash it again,
// and keep doing that forever - which is exactly what Safari means by "a
// problem repeatedly occurred". After two goes a video is held back and waits
// to be asked again by hand.
//
// The video lives in a table of its own, apart from its row. Changing a row
// means storing the whole row again, and on an iPhone storing a video that
// was read back out of the database fails ("Error preparing Blob/File data
// to be stored in object store") - so while the video sat in the row, the
// attempt count could not be written and every video failed at "reading the
// audio". Rows now hold nothing but plain values, and a video is written
// once, when it is added, and never again.

import { orTimeout, within } from './within'
import Dexie, { type EntityTable } from 'dexie'

interface StoredJob {
  id: string
  fileName: string
  fileType: string
  settings: { thresholdDb: number; minSilenceSec: number; paddingSec: number }
  cleanSpeech: boolean
  wantCaptions: boolean
  /** How many times cutting this has been started. See the note above. */
  attempts: number
  /** The last phase this video was seen entering before the tab stopped
   *  responding - 'model' (downloading/loading the speech model),
   *  'listening' (transcribing) or 'cutting' (re-encoding). Written as the
   *  work happens, not just at the end, precisely so a crash that never gets
   *  to run any of *this* file's own code still leaves a record of how far
   *  it got - the one thing a silent tab kill on an iPhone doesn't otherwise
   *  tell you. */
  lastPhase?: 'reading' | 'model' | 'listening' | 'cutting'
  addedAt: number
}

/** Everything about a queued video except the video, which stays on disk
 *  until it is needed. */
export interface PendingJob {
  id: string
  fileName: string
  fileType: string
  settings: StoredJob['settings']
  cleanSpeech: boolean
  wantCaptions: boolean
  attempts: number
  lastPhase?: StoredJob['lastPhase']
}

/** Two goes. A first failure might have been bad luck - the tab trimmed in
 *  the background, the phone busy elsewhere. A second one is the video. */
export const MAX_ATTEMPTS = 2

/** A queued video, kept under its job's id. */
interface StoredVideo {
  id: string
  blob: Blob
}

const db = new Dexie('silence-cutter-queue') as Dexie & {
  jobs: EntityTable<StoredJob, 'id'>
  videos: EntityTable<StoredVideo, 'id'>
}
db.version(1).stores({ jobs: 'id, addedAt' })
// Videos out of the rows - see the note at the top. Rows from before are
// dropped rather than moved: moving means storing their videos again, the
// very thing that fails, and a failure inside an upgrade would stop the
// queue opening at all. On the iPhone none of them could run anyway.
db.version(2)
  .stores({ jobs: 'id, addedAt', videos: 'id' })
  .upgrade((tx) => tx.table('jobs').clear())

/** What the browser will let this site keep on the phone, and how much of
 *  that is already spoken for. Both in bytes; nulls when the browser won't
 *  say (older Safari), which is treated as "go ahead". */
export async function spaceOnDevice(): Promise<{ free: number | null; quota: number | null }> {
  try {
    const { quota, usage } = await navigator.storage.estimate()
    if (quota === undefined || usage === undefined) return { free: null, quota: null }
    return { free: quota - usage, quota }
  } catch {
    return { free: null, quota: null }
  }
}

/** Keeps the video itself, and says whether it managed to.
 *
 *  A queued video is kept so it survives the page being reloaded or killed
 *  mid-cut. But the cut has to be written somewhere too, and both come out
 *  of the same allowance: a 2 minute 4K video is most of a gigabyte in, and
 *  its cut is nearly as much again. Keeping a copy of something that big is
 *  what leaves no room to write the result - so past a point the copy is
 *  skipped, the video is cut straight from memory, and the only thing lost
 *  is resuming it after a crash. */
export async function persistJob(
  job: Omit<StoredJob, 'addedAt' | 'attempts'> & { fileBlob: Blob },
): Promise<boolean> {
  const { fileBlob, ...meta } = job
  try {
    await db.jobs.put({ ...meta, attempts: 0, addedAt: Date.now() })
    const { free } = await spaceOnDevice()
    // Room for the video, its cut, and room to spare.
    if (free !== null && free <= fileBlob.size * 2.5) return false
    await db.videos.put({ id: job.id, blob: fileBlob })
    return true
  } catch {
    // Out of room, or storage blocked. The cut itself does not depend on
    // this having worked.
    return false
  }
}

/** Lets go of the kept copy once the cut is reading the video from memory
 *  anyway, so the space is free for the cut being written. */
export async function forgetFile(id: string): Promise<void> {
  await db.videos.delete(id).catch(() => {})
}

/** Both or neither: a page being torn down mid-delete must not leave a
 *  video with no row, taking up space that nothing will ever free. */
export async function forgetJob(id: string): Promise<void> {
  await db.transaction('rw', db.jobs, db.videos, async () => {
    await db.jobs.delete(id)
    await db.videos.delete(id)
  })
}

/** Records that this job is about to be tried, and says whether it is still
 *  allowed to run. Written before the work starts, so the count survives the
 *  tab dying midway - which is the whole reason for counting. */
export async function claimAttempt(id: string): Promise<boolean> {
  return within(countAttempt(id), 10_000, true)
}

async function countAttempt(id: string): Promise<boolean> {
  try {
    const row = await db.jobs.get(id)
    if (!row) return true // Added this session, never persisted; nothing to count.
    const attempts = row.attempts + 1
    await db.jobs.update(id, { attempts })
    return attempts <= MAX_ATTEMPTS
  } catch {
    // The count is a safety net, not a gate: a write that fails must never
    // be what stops a video.
    return true
  }
}

/** Wipes the attempt count, for when he asks for a held-back video to be
 *  tried again himself. Without this the retry button would claim an attempt
 *  that is already spent and hold the video straight back - a button that
 *  does nothing. Asking counts as knowing. */
export async function resetAttempts(id: string): Promise<void> {
  await db.jobs.update(id, { attempts: 0 }).catch(() => {})
}

/** Records the phase a video just entered. Called throughout the actual cut,
 *  not just once, so if the tab is killed outright - no error, no unmount,
 *  nothing JS ever gets to run - the next load still shows which phase it
 *  never got past. Best-effort: a write that loses the race with the crash
 *  itself just leaves the previous phase in place. */
export async function recordPhase(id: string, phase: StoredJob['lastPhase']): Promise<void> {
  await db.jobs.update(id, { lastPhase: phase }).catch(() => {})
}

/** The video itself, read only when its turn comes. */
export async function loadJobFile(id: string): Promise<File | null> {
  const [row, video] = await orTimeout(Promise.all([db.jobs.get(id), db.videos.get(id)]), 20_000, 'Reading the saved video')
  // No video means it was too big to keep a copy of - see persistJob. There
  // is nothing to pick the cut back up from.
  if (!row || !video || video.blob.size === 0) return null
  return new File([video.blob], row.fileName, { type: row.fileType })
}

/** Deletes kept videos whose job is gone - left by versions that could lose
 *  a row and keep its video. Runs inside the caller's transaction, so a job
 *  being added at the same moment is never mistaken for one. */
async function dropOrphans(jobIds: string[]): Promise<void> {
  const live = new Set(jobIds)
  const kept = await db.videos.toCollection().primaryKeys()
  const orphans = kept.filter((id) => !live.has(id))
  if (orphans.length > 0) await db.videos.bulkDelete(orphans)
}

/** Everything still waiting from a previous visit, oldest first. Metadata
 *  only - see the note at the top. */
export async function loadPendingJobs(): Promise<PendingJob[]> {
  const rows = await db.transaction('rw', db.jobs, db.videos, async () => {
    const rows = await db.jobs.orderBy('addedAt').toArray()
    await dropOrphans(rows.map((row) => row.id))
    return rows
  })
  return rows.map(({ id, fileName, fileType, settings, cleanSpeech, wantCaptions, attempts, lastPhase }) => ({
    id,
    fileName,
    fileType,
    settings,
    cleanSpeech,
    wantCaptions: wantCaptions ?? false, // rows saved before captions existed
    attempts,
    lastPhase,
  }))
}
