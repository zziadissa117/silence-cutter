// Finished videos on their way to Postiz.
//
// A video is copied the moment it is finished, into this app's own private
// files and apart from the cuts the page clears, so nothing that happens to
// the list - Clear finished, a reload, iOS closing the app - can lose it
// before the server has it. Then it goes up in parts, one at a time, each
// tried again until it lands. The server says which parts it already has,
// so a dropped connection costs one part and a restart carries on where it
// stopped; sending the same video twice makes one post.
//
// The copy stays on the phone afterwards, for Save and Share, until the
// post has gone out or been rejected.

import { PostingError, finishSend, putPart, startSend, type ServerPost } from './posting'
import { deleteSend, loadSendVideo, loadSends, saveSend, saveSendVideo, updateSend, type SendEntry } from './store'

const DIR = 'posting'
/** A copy with no post to show for it any more is let go after this. */
const KEEP_DAYS = 4
const PART_TRIES = 3

export type { SendEntry }

export interface Sending {
  entry: SendEntry
  /** 0-1 while its parts go up. */
  progress: number
}

let entries: SendEntry[] = []
const progress = new Map<string, number>()
const listeners = new Set<() => void>()
let loaded: Promise<void> | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

/** Told whenever anything about a video being sent changes. */
export function watchSending(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function sending(): Sending[] {
  return entries.map((entry) => ({ entry, progress: progress.get(entry.key) ?? (entry.state === 'sent' ? 1 : 0) }))
}

function load(): Promise<void> {
  loaded ??= loadSends()
    .then((rows) => {
      entries = rows
      emit()
    })
    .catch(() => {})
  return loaded
}

async function refresh(): Promise<void> {
  entries = await loadSends().catch(() => entries)
  emit()
}

// --- The phone's copy -----------------------------------------------------------

async function directory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(DIR, { create: true })
  } catch {
    return null
  }
}

const fileName = (key: string) => `${key.replace(/[^\w.-]/g, '_')}.mp4`

/** Streamed, never held in memory whole. */
async function keepCopy(key: string, video: Blob): Promise<SendEntry['where']> {
  const dir = await directory()
  if (dir) {
    try {
      const handle = await dir.getFileHandle(fileName(key), { create: true })
      if (typeof handle.createWritable === 'function') {
        const writable = await handle.createWritable()
        await video.stream().pipeTo(writable)
        if ((await handle.getFile()).size === video.size) return 'opfs'
      }
    } catch {
      // Falls through to the database.
    }
    await dir.removeEntry(fileName(key)).catch(() => {})
  }
  await saveSendVideo(key, video)
  return 'idb'
}

/** Where the phone's copy of a video is kept: private files are read from
 *  disk as they are used; the database copy is read into memory whole, so
 *  it is only fetched when asked for. */
export async function copyKind(key: string): Promise<SendEntry['where'] | null> {
  await load()
  return entries.find((e) => e.key === key)?.where ?? null
}

/** The phone's own copy of a video sent to Postiz, or null once it has
 *  been let go. */
export async function localVideo(key: string): Promise<Blob | null> {
  await load()
  const entry = entries.find((e) => e.key === key)
  if (!entry) return null
  if (entry.where === 'idb') return loadSendVideo(key).catch(() => null)
  try {
    const dir = await directory()
    const file = await dir?.getFileHandle(fileName(key)).then((h) => h.getFile())
    return file && file.size > 0 ? file : null
  } catch {
    return null
  }
}

/** Lets a video go: its copy and its place in the queue. */
export async function forgetSend(key: string): Promise<void> {
  const dir = await directory()
  await dir?.removeEntry(fileName(key)).catch(() => {})
  await deleteSend(key).catch(() => {})
  progress.delete(key)
  await refresh()
}

// --- Sending ------------------------------------------------------------------

/** Puts a finished video in line for Postiz. Safe to call twice. */
export async function queueSend(
  fields: Omit<SendEntry, 'where' | 'state' | 'tries' | 'addedAt' | 'size'>,
  video: Blob,
): Promise<void> {
  await load()
  if (entries.some((e) => e.key === fields.key)) return
  const where = await keepCopy(fields.key, video)
  await saveSend({ ...fields, size: video.size, where, state: 'sending', tries: 0, addedAt: Date.now() })
  await refresh()
  kick()
}

let running = false
let again = false
let retryTimer = 0

/** Sends whatever is waiting, one video at a time. */
export function kick(): void {
  if (running) {
    again = true
    return
  }
  void pump()
}

async function pump(): Promise<void> {
  running = true
  window.clearTimeout(retryTimer)
  try {
    do {
      again = false
      await refresh()
      for (const entry of entries.filter((e) => e.state === 'sending')) {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return
        try {
          await sendOne(entry)
        } catch (error) {
          const said = error instanceof Error ? error.message : String(error)
          const tries = entry.tries + 1
          await updateSend(entry.key, { error: said, tries })
          progress.delete(entry.key)
          // Tried again by itself: soon, then less often.
          const wait = [5, 15, 30, 60, 120, 300][Math.min(tries - 1, 5)] * 1000
          window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(kick, wait)
        }
      }
    } while (again)
  } finally {
    running = false
    await refresh()
  }
}

async function sendOne(entry: SendEntry): Promise<void> {
  const video = await localVideo(entry.key)
  if (!video) throw new PostingError("This video's copy is gone from the phone - make it again to send it.")
  for (let round = 0; round < 3; round++) {
    const started = await startSend({
      profile: entry.profileId,
      key: entry.key,
      size: entry.size,
      campaign: entry.campaign,
      meta: entry.meta,
    })
    if (started.status !== 'uploading') return sent(entry, started.id)
    const partBytes = started.partBytes
    const parts = Math.ceil(entry.size / partBytes)
    let done = parts - started.uploads.length
    progress.set(entry.key, done / parts)
    emit()
    for (const { part, url } of started.uploads) {
      const piece = video.slice(part * partBytes, (part + 1) * partBytes)
      for (let attempt = 1; ; attempt++) {
        try {
          await putPart(url, piece)
          break
        } catch (error) {
          if (attempt >= PART_TRIES) throw error
          await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
        }
      }
      done++
      progress.set(entry.key, done / parts)
      emit()
    }
    const finished = await finishSend(entry.profileId, entry.key)
    if (!finished.missing?.length) return sent(entry, finished.id)
  }
  throw new PostingError('Part of the video did not arrive. Trying again.', true)
}

async function sent(entry: SendEntry, postId: string): Promise<void> {
  await updateSend(entry.key, { state: 'sent', postId, error: undefined })
  progress.set(entry.key, 1)
  emit()
}

/** Lets go of copies whose post has gone out or been rejected, and of any
 *  sent long ago with no post to show for it. */
export async function tidySends(posts: ServerPost[]): Promise<void> {
  await load()
  const byKey = new Map(posts.map((p) => [p.key, p]))
  const old = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const entry of entries) {
    if (entry.state !== 'sent') continue
    const post = byKey.get(entry.key)
    const over = post ? post.status === 'posted' || post.status === 'rejected' : entry.addedAt < old
    if (over) await forgetSend(entry.key)
  }
}

/** Starts sending when the page opens, when it comes back, and when the
 *  signal returns. */
export function startSending(): () => void {
  void load().then(kick)
  const onVisible = () => document.visibilityState === 'visible' && kick()
  window.addEventListener('online', kick)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener('online', kick)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
