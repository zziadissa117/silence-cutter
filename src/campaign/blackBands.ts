// A clip already made for 9:16 with a wide video inside it - black above and
// below baked in (his ask, 2026-11-13: "The video is going to be in 9:16,
// but it's going to have a horizontal, already premade thing. Just don't
// change anything about the video itself"). Zooming into one (a push-in, a
// punch at a cut) would crop its picture and grow its bands, so a clip like
// this is drawn exactly as it is. Told from the picture itself, a few frames
// in, never asked.

/** The small copy a frame is judged at. */
const W = 18
const H = 32
/** Darker than this (0-255) is black: a band's black comes out 0 to 16. */
const BLACK = 26
/** The middle needs something brighter than this to judge by: a black frame
 *  (a fade in) says nothing. */
const SOMETHING = 40

/** Whether a frame (RGBA, `width`×`height`) has black bands above and below
 *  its picture: the top and bottom eighth all black, the middle not. Null
 *  when the frame is too dark to tell. */
export function hasBlackBands(rgba: ArrayLike<number>, width: number, height: number): boolean | null {
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  }
  const band = Math.max(1, Math.round(height * 0.12))
  let edge = 0
  for (let y = 0; y < band; y++)
    for (let x = 0; x < width; x++) edge = Math.max(edge, luma(x, y), luma(x, height - 1 - y))
  let middle = 0
  for (let y = Math.floor(height * 0.4); y < Math.ceil(height * 0.6); y++) for (let x = 0; x < width; x++) middle = Math.max(middle, luma(x, y))
  if (middle < SOMETHING) return null
  return edge < BLACK
}

let probe: OffscreenCanvasRenderingContext2D | null | undefined

/** The same for a frame drawn by `draw` (a video sample's own draw), at a
 *  small size. False where there is no canvas to look with. */
export function bandsIn(draw: (ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) => void): boolean | null {
  if (probe === undefined) probe = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })
  if (!probe) return false
  probe.fillStyle = '#000'
  probe.fillRect(0, 0, W, H)
  draw(probe, W, H)
  return hasBlackBands(probe.getImageData(0, 0, W, H).data, W, H)
}
