// The part of a video a player asks for (an HTTP Range header): Safari's
// player asks for a range first and plays nothing from a server that answers
// with the whole file.
//
// Plain TypeScript with no imports, for Deno and the tests.

/** The bytes a Range header asks for, within a file of `size`: null for the
 *  whole file, 'bad' for a range outside it. One range only, as players ask. */
export function byteRange(header: string | null, size: number): [number, number] | null | 'bad' {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (m[1] === '' && m[2] === '')) return null
  let from: number
  let to: number
  if (m[1] === '') {
    from = Math.max(0, size - Number(m[2]))
    to = size - 1
  } else {
    from = Number(m[1])
    to = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  return from > to || from >= size ? 'bad' : [from, to]
}
