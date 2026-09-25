// Where a cut video is written while it is being made.
//
// It used to be built in one ArrayBuffer (mediabunny's BufferTarget). That
// keeps every encoded frame in memory until the end, assembles the file in a
// second buffer, and was then copied a third time into a Blob - so a minute of
// 4K iPhone footage, a few hundred MB of output, peaked well over a gigabyte.
// A computer shrugs that off. Safari on an iPhone kills the tab at around
// that size and, after the second time, shows "A problem repeatedly occurred"
// - which is exactly what cutting a real iPhone video did, while every small
// test clip went through fine.
//
// Now the file is streamed out as it is encoded, a few MB at a time, straight
// to the browser's private file storage on disk (OPFS). Memory use stays flat
// however long the video is. Browsers without writable OPFS files get the same
// streaming into Blob pieces instead, which at least never holds the whole
// file in one JavaScript buffer.

import { StreamTarget, type StreamTargetChunk } from 'mediabunny'

const DIR = 'cuts'
/** How much is gathered before each write. Big enough that a long video is a
 *  few hundred writes rather than tens of thousands, small enough to be
 *  nothing next to a phone's memory. */
const CHUNK_SIZE = 4 * 1024 * 1024

export interface OutputSink {
  target: StreamTarget
  /** The finished file. Only valid after the Output has been finalized. */
  finish(): Promise<Blob>
  /** Throws away a half-written file after a failed attempt. */
  discard(): Promise<void>
  /** Name in private storage, to delete it by later. Null when it was kept
   *  in memory instead. */
  storedAs: string | null
}

async function cutsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(DIR, { create: true })
  } catch {
    return null
  }
}

/** Every cut this tab is writing or still showing holds a Web Lock named
 *  after its file, released when the cut is thrown away or the tab closes. */
const LOCK_PREFIX = 'silence-cutter-cut:'
const releasers = new Map<string, () => void>()

async function holdLock(name: string): Promise<void> {
  if (!navigator.locks) return
  await new Promise<void>((granted) => {
    void navigator.locks.request(LOCK_PREFIX + name, () => {
      granted()
      return new Promise<void>((release) => releasers.set(name, release))
    })
  })
}

function releaseLock(name: string): void {
  releasers.get(name)?.()
  releasers.delete(name)
}

/** A day, for browsers with no Web Locks: a cut older than that belongs to no
 *  open tab, however long a video took. */
const STALE_MS = 24 * 60 * 60 * 1000

/** Clears out cuts left behind by an earlier visit. Finished videos only live
 *  on the screen that made them, so anything here nobody is holding is
 *  unreachable and would otherwise fill the phone's storage one visit at a
 *  time. It used to delete the whole folder, which also deleted the cut a
 *  second open tab was in the middle of writing - so now a file still locked
 *  by a live tab is left alone. Every new cut waits for this to finish. */
const leftoversCleared: Promise<void> = (async () => {
  try {
    const dir = await cutsDirectory()
    if (!dir) return
    const held = navigator.locks
      ? new Set((await navigator.locks.query()).held?.map((lock) => lock.name) ?? [])
      : null
    const names: string[] = []
    for await (const name of dir.keys()) names.push(name)
    for (const name of names) {
      const inUse = held
        ? held.has(LOCK_PREFIX + name)
        : Date.now() - Number(name.split('-')[0]) < STALE_MS
      if (!inUse) await dir.removeEntry(name).catch(() => {})
    }
  } catch {
    // Nothing there, or no OPFS at all.
  }
})()

export async function createOutputSink(): Promise<OutputSink> {
  await leftoversCleared
  const dir = await cutsDirectory()
  if (dir) {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
    await holdLock(name)
    try {
      const handle = await dir.getFileHandle(name, { create: true })
      if (typeof handle.createWritable === 'function') {
        const writable = await handle.createWritable()
        return {
          target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE }),
          finish: () => handle.getFile(),
          discard: async () => {
            await writable.abort().catch(() => {})
            await dir.removeEntry(name).catch(() => {})
            releaseLock(name)
          },
          storedAs: name,
        }
      }
      await dir.removeEntry(name).catch(() => {})
    } catch {
      // Fall through to Blob pieces.
    }
    releaseLock(name)
  }
  return blobPieceSink()
}

/** Streams into a list of Blobs. Writes arrive in order except for a few
 *  small ones near the start of the file that fill in sizes once they are
 *  known; those are kept aside and laid over the pieces at the end, which
 *  Blob.slice does without copying anything. */
function blobPieceSink(): OutputSink {
  const pieces: Blob[] = []
  const patches: { position: number; data: Uint8Array }[] = []
  let size = 0

  const writable = new WritableStream<StreamTargetChunk>({
    write({ data, position }) {
      const end = position + data.byteLength
      if (position > size) {
        pieces.push(new Blob([new Uint8Array(position - size)]))
        size = position
      }
      if (position === size) {
        pieces.push(new Blob([data.slice()]))
        size = end
      } else if (end <= size) {
        patches.push({ position, data: data.slice() })
      } else {
        const inside = size - position
        patches.push({ position, data: data.slice(0, inside) })
        pieces.push(new Blob([data.slice(inside)]))
        size = end
      }
    },
  })

  return {
    target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE }),
    finish: async () => {
      let blob = new Blob(pieces)
      for (const { position, data } of patches) {
        blob = new Blob([blob.slice(0, position), data as Uint8Array<ArrayBuffer>, blob.slice(position + data.byteLength)])
      }
      return blob
    },
    discard: async () => {
      pieces.length = 0
    },
    storedAs: null,
  }
}

/** Deletes one finished cut from private storage, once it is off the screen. */
export async function forgetCut(name: string): Promise<void> {
  const dir = await cutsDirectory()
  await dir?.removeEntry(name).catch(() => {})
  releaseLock(name)
}
