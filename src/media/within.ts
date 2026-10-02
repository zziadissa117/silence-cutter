// A time limit for waiting on the phone's storage.
//
// In some states WebKit's storage stops answering after a save it could not
// do: no error, no success, nothing - the wait simply never ends. A video
// waiting on it sat on "Waiting" for ever. Nothing here depends on storage
// to make a video, so after a while the wait gives up and the work goes on.

/** Resolves with `promise`, or with `fallback` after `ms` - whichever is
 *  first. */
export function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Like `within`, but a wait that runs out is an error, for when there is
 *  nothing sensible to carry on with. */
export function orTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  const late = Symbol('late')
  return within<T | typeof late>(promise, ms, late).then((value) => {
    if (value === late) throw new Error(`${what} took too long`)
    return value
  })
}
