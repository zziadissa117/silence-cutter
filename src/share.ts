// The share sheet: the one way a web page hands a file to another app, used
// by both pages. One helper, so the two pages treat its failures the same.

export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

/** What came of opening the share sheet.
 *   shared       it opened and he picked somewhere
 *   cancelled    it opened and he closed it
 *   retry        it did not open this time - a second tap while it was still
 *                opening, or a tap the browser did not count as a gesture -
 *                and a plain tap again will
 *   unsupported  this browser cannot share these files at all */
export type ShareOutcome = 'shared' | 'cancelled' | 'retry' | 'unsupported'

export async function shareFiles(files: File[]): Promise<ShareOutcome> {
  try {
    await navigator.share({ files })
    return 'shared'
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') return 'cancelled'
    if (name === 'InvalidStateError' || name === 'NotAllowedError') return 'retry'
    return 'unsupported'
  }
}
