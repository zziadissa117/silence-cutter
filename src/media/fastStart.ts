// Moves a finished MP4's index - its "moov" box - from the end of the file
// to the front, as Instagram's API asks ("moov atom at the front of the
// file"). It is what the qt-faststart tool does.
//
// The cutter writes the index last, because only then is it known, and a
// file streamed to disk can't make room at its start afterwards. (mediabunny
// can reserve the room up front, but fails an assertion as soon as a video
// has B-frames, which some iPhone footage does.) So the finished file is put
// back together: everything before the media data, then the index - its
// chunk offsets moved on by its own size - then the media data. The media
// data is sliced from the file, never read into memory, so a 300 MB video
// costs only its index, a few hundred KB.
//
// Anything it doesn't understand gives back the file as it was: a video
// with its index at the end still plays everywhere else.

interface Box {
  type: string
  start: number
  size: number
}

const MAX_U32 = 0xffffffff

/** The top-level boxes of an MP4, or null when it doesn't read as one. */
async function topLevel(file: Blob): Promise<Box[] | null> {
  const boxes: Box[] = []
  for (let at = 0; at < file.size; ) {
    const head = new DataView(await file.slice(at, at + 16).arrayBuffer())
    if (head.byteLength < 8) return null
    let size = head.getUint32(0)
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7))
    if (size === 1) {
      if (head.byteLength < 16) return null
      size = head.getUint32(8) * 2 ** 32 + head.getUint32(12)
    } else if (size === 0) size = file.size - at
    if (size < 8 || at + size > file.size) return null
    boxes.push({ type, start: at, size })
    at += size
  }
  return boxes
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

/** Moves every chunk offset in `moov` on by `shift`, in place. False when
 *  one no longer fits a 32-bit `stco`, or the boxes don't read. */
function shiftOffsets(moov: Uint8Array, shift: number): boolean {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const walk = (from: number, to: number): boolean => {
    for (let at = from; at + 8 <= to; ) {
      const size = view.getUint32(at)
      const type = String.fromCharCode(moov[at + 4], moov[at + 5], moov[at + 6], moov[at + 7])
      if (size < 8 || at + size > to) return false
      if (CONTAINERS.has(type)) {
        if (!walk(at + 8, at + size)) return false
      } else if (type === 'stco' || type === 'co64') {
        const count = view.getUint32(at + 12)
        const wide = type === 'co64'
        if (16 + count * (wide ? 8 : 4) > size) return false
        for (let i = 0; i < count; i++) {
          const p = at + 16 + i * (wide ? 8 : 4)
          if (wide) {
            const value = view.getUint32(p) * 2 ** 32 + view.getUint32(p + 4) + shift
            view.setUint32(p, Math.floor(value / 2 ** 32))
            view.setUint32(p + 4, value % 2 ** 32)
          } else {
            const value = view.getUint32(p) + shift
            if (value > MAX_U32) return false
            view.setUint32(p, value)
          }
        }
      }
      at += size
    }
    return true
  }
  return walk(8, moov.byteLength)
}

/** `file` with its index at the front, or `file` itself when it already is
 *  or can't be done. Never throws. */
export async function moovToFront(file: Blob): Promise<Blob> {
  try {
    const boxes = await topLevel(file)
    if (!boxes) return file
    const moov = boxes.find((b) => b.type === 'moov')
    const firstMdat = boxes.findIndex((b) => b.type === 'mdat')
    if (!moov || firstMdat < 0 || moov.start < boxes[firstMdat].start) return file
    // A 64-bit moov header is never written for an index this size.
    const index = new Uint8Array(await file.slice(moov.start, moov.start + moov.size).arrayBuffer())
    if (new DataView(index.buffer).getUint32(0) !== moov.size) return file
    if (!shiftOffsets(index, moov.size)) return file
    const before = boxes.slice(0, firstMdat)
    const after = boxes.slice(firstMdat).filter((b) => b !== moov)
    const slice = (b: Box) => file.slice(b.start, b.start + b.size)
    return new Blob([...before.map(slice), index, ...after.map(slice)], { type: file.type || 'video/mp4' })
  } catch {
    return file
  }
}
