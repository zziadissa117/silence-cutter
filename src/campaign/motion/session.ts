// The video being worked on in Motion graphics, kept on the phone (IndexedDB)
// at every step - picked, heard, planned, each chat change, made - so closing
// the app or a reload never loses it: he comes back to where he was.
// Its own small database, apart from the queue's (store.ts), so nothing of
// the main Cutter can collide with it.

import type { ChatTurn, Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import type { CampaignPlan } from '../plan'
import type { CaptionChoice } from './make'

export interface MotionSession {
  id: string
  file: Blob
  fileName: string
  /** What he typed for this video, if anything. */
  ask: string
  plan?: CampaignPlan
  storyboard?: Storyboard
  chat: ChatTurn[]
  /** What he changed on the captions of this video (make.ts CaptionChoice). */
  captions?: CaptionChoice
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

/** The video being worked on, or null. Never throws: storage that can't be
 *  read is the same as nothing kept. */
export async function loadSession(): Promise<MotionSession | null> {
  try {
    return ((await run('readonly', (s) => s.get(KEY))) as MotionSession | undefined) ?? null
  } catch {
    return null
  }
}

export async function saveSession(session: MotionSession): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(session, KEY))
  } catch (error) {
    console.warn("Motion graphics: this step couldn't be kept on the phone:", error)
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY))
  } catch {
    // Nothing kept, or nothing to clear.
  }
}
