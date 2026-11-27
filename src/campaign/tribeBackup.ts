// Trybe videos backed up on his own Cutter server (his ask, 2026-11-27: "back
// up Trybe videos to the server too"). The phone stays first (rule 5): a
// Trybe video is kept here as before, and once his server is connected
// (Settings -> Server) each one goes up by itself as three files - the
// finished video, its recording while Tribe hasn't approved it, and its row
// (the words heard, his edits) so it can be edited again on a phone that lost
// it. Only to his own server (AGENTS.md rule 4), kept there until he approves
// (the recording goes) or deletes it (all of it goes); the server never
// sweeps them (server/main.mjs `isBackup`).

import { downloadFile } from './talkLink'
import { call, sendBlob, serverFiles, serverUrl } from './serverLink'
import { heldVideos, loadHeldVideo, loadRecording, markTribeBackedUp, restoreTribe, tribeRow, type PendingJob, type StoredJob } from './store'

const PREFIX = 'tribe-'

/** A job id as the server's file names take it (letters, digits, - and _). */
function slug(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
}

/** The three files a Trybe video is kept as on the server. */
export function backupIds(jobId: string): { video: string; recording: string; row: string } {
  const base = `${PREFIX}${slug(jobId)}`
  return { video: `${base}-video`, recording: `${base}-rec`, row: `${base}-meta` }
}

/** The Trybe videos the server holds that this phone doesn't (a wiped phone,
 *  another phone of the same login): their row files' ids. */
export function onlyOnServer(files: Readonly<Record<string, unknown>>, here: readonly string[]): string[] {
  const mine = new Set(here.map((id) => backupIds(id).row))
  return Object.keys(files).filter((id) => id.startsWith(PREFIX) && id.endsWith('-meta') && !mine.has(id))
}

/** Whether this go of a video still needs to go up. */
export function needsBackup(row: Pick<PendingJob, 'tribe' | 'version'>): boolean {
  return Boolean(row.tribe) && row.tribe?.backedUp !== (row.version ?? 1)
}

export const backupOn = (): boolean => Boolean(serverUrl())

/** One Trybe video up to the server, what it hasn't got of it. */
export async function backUp(jobId: string, files?: Record<string, { size: number }>): Promise<void> {
  const row = await tribeRow(jobId)
  if (!row) return
  const there = files ?? (await serverFiles())
  const ids = backupIds(jobId)
  const video = await loadHeldVideo(jobId)
  if (video && there[ids.video]?.size !== video.size) await sendBlob(ids.video, `${row.fileName}.mp4`, 'video/mp4', video)
  if (!row.tribe?.approvedAt) {
    const recording = await loadRecording(jobId)
    if (recording && there[ids.recording]?.size !== recording.size) {
      await sendBlob(ids.recording, row.fileName, recording.type || 'video/quicktime', recording)
    }
  } else if (there[ids.recording]) {
    await forget(ids.recording)
  }
  const { addedAt: _added, ...kept } = row
  await sendBlob(ids.row, `${row.fileName}.json`, 'application/json', new Blob([JSON.stringify(kept)], { type: 'application/json' }))
  await markTribeBackedUp(jobId, row.version ?? 1)
}

/** Every Trybe video not backed up yet, one after another. Says how many
 *  couldn't go up (no signal, a full disk) - tried again next time. */
export async function backUpAll(rows: readonly PendingJob[]): Promise<number> {
  if (!backupOn()) return 0
  const waiting = rows.filter(needsBackup)
  if (waiting.length === 0) return 0
  let files: Record<string, { size: number }>
  try {
    files = await serverFiles()
  } catch {
    return waiting.length
  }
  let missed = 0
  for (const row of waiting) {
    try {
      await backUp(row.id, files)
    } catch {
      missed++
    }
  }
  return missed
}

const forget = (id: string) => call('DELETE', `/files/${encodeURIComponent(id)}`).catch(() => undefined)

/** Approved: the server lets go of its recording (the video stays). */
export async function approvedOnServer(jobId: string): Promise<void> {
  if (backupOn()) await forget(backupIds(jobId).recording)
}

/** Deleted: the server lets go of all of it. */
export async function deleteFromServer(jobId: string): Promise<void> {
  if (!backupOn()) return
  const ids = backupIds(jobId)
  await Promise.all([forget(ids.video), forget(ids.recording), forget(ids.row)])
}

/** A Trybe video only on the server, as listed: its row read back. */
export async function serverOnly(): Promise<StoredJob[]> {
  if (!backupOn()) return []
  const files = await serverFiles()
  const here = (await heldVideos()).filter((r) => r.tribe).map((r) => r.id)
  const rows: StoredJob[] = []
  for (const id of onlyOnServer(files, here)) {
    try {
      const row = JSON.parse(await (await downloadFile(id)).text()) as StoredJob
      if (row?.id && row.tribe) rows.push(row)
    } catch {
      // Read next time.
    }
  }
  return rows
}

/** A Trybe video from the server back onto this phone. */
export async function bringBack(row: StoredJob): Promise<void> {
  const ids = backupIds(row.id)
  const video = await downloadFile(ids.video)
  const recording = row.tribe?.approvedAt ? null : await downloadFile(ids.recording).catch(() => null)
  await restoreTribe({ ...row, tribe: { ...row.tribe, backedUp: row.version ?? 1 } }, video, recording)
}
