// Whether the page is on its way out - a reload, or navigating to the other
// section. Work cut short by that is not a failure of the video: the speech
// model's worker is ended with the page, the listen rejects, and treating
// that as a failure deleted the video, so it never came back on the next
// load. Its row has to stay.

let leaving = false

let stayed = 0

if (typeof window !== 'undefined') {
  // A reload cancels the page's downloads - the speech model mid-download -
  // before "pagehide", so "beforeunload" is what comes first. If the page
  // turns out to stay after all, it stops counting as leaving shortly after.
  window.addEventListener('beforeunload', () => {
    leaving = true
    window.clearTimeout(stayed)
    stayed = window.setTimeout(() => {
      leaving = false
    }, 10_000)
  })
  // "pagehide" too stops counting after a while: a browser that fires it for
  // a page merely sent to the background, or a navigation given up on, left
  // the page "leaving" for good - and every later failure was then swallowed
  // as if the page were gone, the row stuck at "working".
  window.addEventListener('pagehide', () => {
    leaving = true
    window.clearTimeout(stayed)
    stayed = window.setTimeout(() => {
      leaving = false
    }, 10_000)
  })
  // Brought back from the back-forward cache, or simply shown again: still
  // here after all.
  window.addEventListener('pageshow', () => {
    leaving = false
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      leaving = false
      window.clearTimeout(stayed)
    }
  })
}

export function pageLeaving(): boolean {
  return leaving
}
