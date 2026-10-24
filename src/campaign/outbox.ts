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

import { PostingError, finishSend, listPosts, postAction, putPart, startSend, type ServerPost } from './posting'
import { deleteSend, loadSendVideo, loadSends, saveSend, saveSendVideo, updateSend, type SendEntry } from './store'
import { SERVER_MODE } from './serverFlag'
import { within } from '../media/within'

const DIR = 'posting'
/** A copy with no post to show for it any more is let go after this. */
const KEEP_DAYS = 4
const PART_TRIES = 3

export type { SendEntry }

export interface Sending {
  entry: SendEntry
  /** 0-1 while its parts go up. */
  progress: number
  /** Going up right now: the queue sends one video at a time, so the rest
   *  are only waiting their turn - not stuck, whatever went wrong before. */
  now: boolean
}

let entries: SendEntry[] = []
const progress = new Map<string, number>()
/** The video going up right now. */
let current: string | null = null
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
  return entries.map((entry) => ({ entry, progress: progress.get(entry.key) ?? (entry.state === 'sent' ? 1 : 0), now: entry.key === current }))
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

/** How long the private files get to keep a copy: WebKit's storage can stop
 *  answering altogether, and a video then never went out. */
const COPY_WAIT_MS = 60_000

/** Streamed, never held in memory whole. */
async function keepCopy(key: string, video: Blob): Promise<SendEntry['where']> {
  const dir = await within(directory(), COPY_WAIT_MS, null)
  if (dir) {
    const onDisk = async (): Promise<boolean> => {
      try {
        const handle = await dir.getFileHandle(fileName(key), { create: true })
        if (typeof handle.createWritable === 'function') {
          const writable = await handle.createWritable()
          await video.stream().pipeTo(writable)
          if ((await handle.getFile()).size === video.size) return true
        }
      } catch {
        // Falls through to the database.
      }
      return false
    }
    if (await within(onDisk(), COPY_WAIT_MS, false)) return 'opfs'
    void dir.removeEntry(fileName(key)).catch(() => {})
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

/** Whether a video is already in line, or already sent and not yet let go. */
export async function isQueued(key: string): Promise<boolean> {
  await load()
  return entries.some((e) => e.key === key)
}

/** The fingerprints of what is in line or sent for a campaign, so a video
 *  picked again can be recognised before anything is done with it. */
export async function fingerprintsFor(campaignId: string): Promise<Set<string>> {
  await load()
  return new Set(entries.filter((e) => e.campaign.id === campaignId && e.fp).map((e) => e.fp as string))
}

/** Puts a finished video in line for Postiz. Safe to call twice: the second
 *  call does nothing and says so ('duplicate'), so a caller can tell him. */
export async function queueSend(
  fields: Omit<SendEntry, 'where' | 'state' | 'tries' | 'addedAt' | 'size'>,
  video: Blob,
): Promise<'queued' | 'duplicate'> {
  await load()
  if (entries.some((e) => e.key === fields.key)) return 'duplicate'
  const where = await keepCopy(fields.key, video)
  await saveSend({ ...fields, size: video.size, where, state: 'sending', tries: 0, addedAt: Date.now() })
  await refresh()
  kick()
  return 'queued'
}

let running = false
let again = false
let retryTimer = 0

/** Sends whatever is waiting, one video at a time. */
/** Try again on a video that got stuck: it goes back in line and the queue
 *  is kicked. */
export async function retryStuck(key: string): Promise<void> {
  await updateSend(key, { stuck: undefined, error: undefined })
  kick()
}

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
      // Old versions still to take out (no signal when their new one arrived).
      for (const entry of entries.filter((e) => e.state === 'sent' && e.replaces)) {
        if (!navigator.onLine) break
        await retireReplaced(entry).catch(() => {})
      }
      // A stuck one (its copy gone, the server said no) waits for Try again:
      // tried every five minutes it only read its copy back for nothing.
      for (const entry of entries.filter((e) => e.state === 'sending' && !e.stuck)) {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return
        current = entry.key
        emit()
        try {
          await sendOne(entry)
        } catch (error) {
          const said = error instanceof Error ? error.message : String(error)
          const tries = entry.tries + 1
          // Only what can't pass by itself is his to act on.
          await updateSend(entry.key, { error: said, tries, stuck: error instanceof PostingError && !error.later })
          progress.delete(entry.key)
          // Tried again by itself: soon, then less often.
          const wait = [5, 15, 30, 60, 120, 300][Math.min(tries - 1, 5)] * 1000
          window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(kick, wait)
        } finally {
          current = null
        }
      }
    } while (again)
  } finally {
    running = false
    current = null
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

/** A post this soon - or one approved to go straight away - is taken out as
 *  soon as its new version is made, as before: waiting for the new one to
 *  arrive, it could go out first, and both would. */
const REPLACE_SOON_MS = 15 * 60_000

/** Whether a post being replaced must come out now rather than once its new
 *  version is on the server (queueSend's `replaces`). */
export function replaceNow(old: Pick<ServerPost, 'status' | 'postAt'>, now = Date.now()): boolean {
  if (old.status !== 'scheduled' && old.status !== 'approved') return false
  return !old.postAt || Date.parse(old.postAt) <= now + REPLACE_SOON_MS
}

/** The post an entry replaces, taken out now that the entry is on the
 *  server - unless it went out meanwhile, which can't be taken back (this one
 *  then goes as a post of its own). Tried again by the queue if it fails. */
async function retireReplaced(entry: SendEntry): Promise<void> {
  if (!entry.replaces) return
  const old = (await listPosts(true)).find((p) => p.key === entry.replaces)
  const goneOut = old && (old.status === 'posted' || (old.status === 'scheduled' && old.postAt !== null && Date.parse(old.postAt) <= Date.now()))
  if (old && !goneOut && old.status !== 'rejected' && old.status !== 'failed') await postAction('reject', old.id)
  await forgetSend(entry.replaces).catch(() => {})
  await updateSend(entry.key, { replaces: undefined })
}

async function sent(entry: SendEntry, postId: string): Promise<void> {
  await updateSend(entry.key, { state: 'sent', postId, error: undefined, stuck: undefined })
  progress.set(entry.key, 1)
  await retireReplaced(entry).catch(() => {})
  // On the Cutter server nobody watches it there - the phone plays Postiz's
  // copy - and a week of batch videos kept would fill its small disk.
  if (SERVER_MODE) await forgetSend(entry.key)
  emit()
}

/** Whether the phone's copy of a sent video can go: its post went out or was
 *  rejected - or Postiz has the video, so watching, saving and adding music
 *  play Postiz's copy. Kept while he still decides (waiting, approved): it
 *  plays at once, with no signal. Every copy used to stay until its post
 *  went out, so a batch of 120 posting a few a day kept them all on the phone
 *  for weeks - over 100 GB on one phone. */
export function copyDone(post: Pick<ServerPost, 'status' | 'videoUrl'>): boolean {
  if (post.status === 'posted' || post.status === 'rejected') return true
  return (post.status === 'scheduled' || post.status === 'error') && Boolean(post.videoUrl)
}

/** Lets go of copies no longer needed (copyDone), and of any sent long ago
 *  with no post to show for it. */
export async function tidySends(posts: ServerPost[]): Promise<void> {
  await load()
  const byKey = new Map(posts.map((p) => [p.key, p]))
  const old = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const entry of entries) {
    if (entry.state !== 'sent') continue
    const post = byKey.get(entry.key)
    const over = post ? copyDone(post) : entry.addedAt < old
    if (over) await forgetSend(entry.key)
  }
}

/** What the send queue holds on the phone, for the storage report. */
export async function sendsHeld(): Promise<{ sending: number; sent: number; mb: number }> {
  await load()
  return {
    sending: entries.filter((e) => e.state === 'sending').length,
    sent: entries.filter((e) => e.state === 'sent').length,
    mb: Math.round(entries.reduce((sum, e) => sum + (e.size ?? 0), 0) / 1e6),
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
