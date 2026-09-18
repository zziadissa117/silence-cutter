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

/** Clears out cuts left behind by an earlier visit. Finished videos only live
 *  on the screen that made them, so anything here at startup is unreachable
 *  and would otherwise fill the phone's storage one visit at a time. Runs once
 *  when the page loads, and every new cut waits for it, so it can never delete
 *  a file this visit is still writing. */
const leftoversCleared: Promise<void> = (async () => {
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(DIR, { recursive: true })
  } catch {
    // Nothing there, or no OPFS at all.
  }
})()

export async function createOutputSink(): Promise<OutputSink> {
  await leftoversCleared
  const dir = await cutsDirectory()
  if (dir) {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
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
          },
          storedAs: name,
        }
      }
      await dir.removeEntry(name).catch(() => {})
    } catch {
      // Fall through to Blob pieces.
    }
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
}
