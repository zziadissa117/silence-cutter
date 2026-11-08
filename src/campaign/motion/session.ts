// The video being worked on in Motion graphics, kept on the phone (IndexedDB)
// at every step - picked, heard, planned, each chat change, made - so closing
// the app or a reload never loses it: he comes back to where he was.
// Its own small database, apart from the queue's (store.ts), so nothing of
// the main Cutter can collide with it.

import type { ChatTurn, FormatAsk, Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import type { CampaignPlan } from '../plan'
import type { CaptionChoice } from './make'

export interface MotionSession {
  id: string
  file: Blob
  fileName: string
  /** What he typed for this video, if anything. */
  ask: string
  /** The look he picked for it, or Claude picks. */
  format?: FormatAsk
  plan?: CampaignPlan
  storyboard?: Storyboard
  chat: ChatTurn[]
  /** What he changed on the captions of this video (make.ts CaptionChoice). */
  captions?: CaptionChoice
  /** Sound effects off for this video; on when not set. */
  noSounds?: boolean
  /** He has been through the caption check (Claude's fixes kept or undone,
   *  approved) - it comes before the plan, once. */
  checked?: boolean
  /** The finished video, once made, and the storyboard it was made from. */
  made?: Blob
  madeFrom?: Storyboard
  /** What Claude has cost on this video, in cents. */
  costCents: number
}

const DB = 'cutter-motion'
const STORE = 'session'
const KEY = 'current'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = work(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// The recording and the made video are kept in records of their own, each
// written once: Safari deletes a stored file when its record is written
// again, and a Blob read from it before then can no longer be read - "The
// object can not be found here." when Make read the recording, after a chat
// change or a caption fix had saved the session again (his report,
// 2026-11-08). The session itself (the plan, the chat...) is rewritten at
// every step, with no file in it.
const FILE_KEY = 'file'
const MADE_KEY = 'made'

/** The files this page last read or wrote, so a step saved again never
 *  writes them again. */
let storedFile: Blob | null = null
let storedMade: Blob | null = null

type Kept = Omit<MotionSession, 'file' | 'made'> & { file?: Blob; made?: Blob }

async function get<T>(key: string): Promise<T | undefined> {
  return (await run('readonly', (s) => s.get(key))) as T | undefined
}

/** The video being worked on, or null. Never throws: storage that can't be
 *  read is the same as nothing kept. */
export async function loadSession(): Promise<MotionSession | null> {
  try {
    const kept = await get<Kept>(KEY)
    if (!kept) return null
    // Kept before the files had records of their own: moved out once, then
    // read again from where they now are.
    if (kept.file) {
      await run('readwrite', (s) => s.put({ id: kept.id, blob: kept.file }, FILE_KEY))
      if (kept.made) await run('readwrite', (s) => s.put({ id: kept.id, blob: kept.made }, MADE_KEY))
      const { file: _file, made: _made, ...rest } = kept
      await run('readwrite', (s) => s.put(rest, KEY))
    }
    const file = await get<{ id: string; blob: Blob }>(FILE_KEY)
    if (!file || file.id !== kept.id) return null
    const made = await get<{ id: string; blob: Blob }>(MADE_KEY)
    storedFile = file.blob
    storedMade = made && made.id === kept.id && kept.madeFrom ? made.blob : null
    const { file: _f, made: _m, ...meta } = kept
    return { ...fromOldFormat2(meta), file: file.blob, ...(storedMade ? { made: storedMade } : {}) }
  } catch {
    return null
  }
}

/** A video planned in the old Format 2 ("words", taken out 2026-11-08): its
 *  plan can't be drawn any more, so it goes back to its caption check and is
 *  planned again in the glass look that replaced it. */
export function fromOldFormat2<T extends Pick<MotionSession, 'format' | 'storyboard' | 'checked' | 'chat' | 'made' | 'madeFrom'>>(session: T): T {
  const old = (session.storyboard as { format?: string } | undefined)?.format === 'words' || (session.format as string | undefined) === 'words'
  if (!old) return session
  const { storyboard: _s, made: _m, madeFrom: _f, ...rest } = session
  return { ...rest, format: 'glass', checked: false, chat: [] } as unknown as T
}

/** The recording, read again from the phone's storage - a fresh Blob, for
 *  making the video - or `fallback` when it can't be. */
export async function freshFile(id: string, fallback: Blob): Promise<Blob> {
  try {
    const file = await get<{ id: string; blob: Blob }>(FILE_KEY)
    return file && file.id === id ? file.blob : fallback
  } catch {
    return fallback
  }
}

export async function saveSession(session: MotionSession): Promise<void> {
  try {
    const { file, made, ...meta } = session
    if (file !== storedFile) {
      await run('readwrite', (s) => s.put({ id: session.id, blob: file }, FILE_KEY))
      storedFile = file
    }
    if (made && made !== storedMade) {
      await run('readwrite', (s) => s.put({ id: session.id, blob: made }, MADE_KEY))
      storedMade = made
    }
    if (!made) storedMade = null
    await run('readwrite', (s) => s.put(meta, KEY))
  } catch (error) {
    console.warn("Motion graphics: this step couldn't be kept on the phone:", error)
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY))
    await run('readwrite', (s) => s.delete(FILE_KEY))
    await run('readwrite', (s) => s.delete(MADE_KEY))
    storedFile = null
    storedMade = null
  } catch {
    // Nothing kept, or nothing to clear.
  }
}
