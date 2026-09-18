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

import Dexie, { type EntityTable } from 'dexie'

interface StoredJob {
  id: string
  fileBlob: Blob
  fileName: string
  fileType: string
  settings: { thresholdDb: number; minSilenceSec: number; paddingSec: number }
  cleanSpeech: boolean
  /** How many times cutting this has been started. See the note above. */
  attempts: number
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
  attempts: number
}

/** Two goes. A first failure might have been bad luck - the tab trimmed in
 *  the background, the phone busy elsewhere. A second one is the video. */
export const MAX_ATTEMPTS = 2

const db = new Dexie('silence-cutter-queue') as Dexie & {
  jobs: EntityTable<StoredJob, 'id'>
}
db.version(1).stores({ jobs: 'id, addedAt' })

export async function persistJob(job: Omit<StoredJob, 'addedAt' | 'attempts'>): Promise<void> {
  await db.jobs.put({ ...job, attempts: 0, addedAt: Date.now() })
}

export async function forgetJob(id: string): Promise<void> {
  await db.jobs.delete(id)
}

/** Records that this job is about to be tried, and says whether it is still
 *  allowed to run. Written before the work starts, so the count survives the
 *  tab dying midway - which is the whole reason for counting. */
export async function claimAttempt(id: string): Promise<boolean> {
  const row = await db.jobs.get(id)
  if (!row) return true // Added this session, never persisted; nothing to count.
  const attempts = row.attempts + 1
  await db.jobs.update(id, { attempts })
  return attempts <= MAX_ATTEMPTS
}

/** Wipes the attempt count, for when he asks for a held-back video to be
 *  tried again himself. Without this the retry button would claim an attempt
 *  that is already spent and hold the video straight back - a button that
 *  does nothing. Asking counts as knowing. */
export async function resetAttempts(id: string): Promise<void> {
  await db.jobs.update(id, { attempts: 0 })
}

/** The video itself, read only when its turn comes. */
export async function loadJobFile(id: string): Promise<File | null> {
  const row = await db.jobs.get(id)
  if (!row) return null
  return new File([row.fileBlob], row.fileName, { type: row.fileType })
}

/** Everything still waiting from a previous visit, oldest first. Metadata
 *  only - see the note at the top. */
export async function loadPendingJobs(): Promise<PendingJob[]> {
  const rows = await db.jobs.orderBy('addedAt').toArray()
  return rows.map(({ id, fileName, fileType, settings, cleanSpeech, attempts }) => ({
    id,
    fileName,
    fileType,
    settings,
    cleanSpeech,
    attempts,
  }))
}
