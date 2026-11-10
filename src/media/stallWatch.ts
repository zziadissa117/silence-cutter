// A video that stops moving with no error at all - the phone's encoder or
// decoder going quiet - would otherwise sit at the same percent for ever.
// After a stretch with no progress it is given up on and takes the same way
// out as any failure: the row says so, the copy is kept, Try again works.
// Both pages use this; the campaign page adds its own restart on top.

/** A video that stopped moving for the stall limit (see `stallWatch`). */
export class StallError extends Error {}

/** How long a video may go without progress before it counts as stuck. Well
 *  past the slowest real step on a phone - a long window of listening, or
 *  finishing a big file. Getting the speech model is slower still on a slow
 *  connection, so it gets longer. */
export const STALL_MS = 90_000
export const MODEL_STALL_MS = 180_000

export function stallWatch(limit: () => number, describe: () => string) {
  let lastMoved = Date.now()
  return {
    /** Something happened: progress, a new phase. */
    moved() {
      lastMoved = Date.now()
    },
    /** `work`, failing with a StallError when nothing moves for the limit. */
    watched<T>(work: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        lastMoved = Date.now()
        const timer = window.setInterval(() => {
          // Hidden, the work waits on purpose; that is not stalling.
          if (document.visibilityState !== 'visible') lastMoved = Date.now()
          else if (Date.now() - lastMoved > limit()) {
            window.clearInterval(timer)
            reject(new StallError(`The phone stopped ${describe()} - nothing moved for ${Math.round(limit() / 1000)} seconds.`))
          }
        }, 5000)
        work.then(
          (value) => {
            window.clearInterval(timer)
            resolve(value)
          },
          (error: unknown) => {
            window.clearInterval(timer)
            reject(error)
          },
        )
      })
    },
  }
}
