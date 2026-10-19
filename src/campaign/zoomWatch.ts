// The bar along the bottom stops staying put while the screen is zoomed in:
// on an iPhone, tapping a text box whose writing is under 16 px zooms the
// page, and a fixed bar then slides with the scroll until the zoom goes.
// That is stopped at the source (campaign.html maximum-scale, campaign.css
// 16 px boxes); if the screen still zooms, this says when and on what, so
// the next cause is read from his reports instead of guessed.

import { report } from '../report'

/** What was being typed in when the zoom came, in words for a report. */
export function describeFocus(el: Element | null): string {
  if (!el || el === document.body) return 'nothing focused (a pinch?)'
  const label = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? ''
  const size = getComputedStyle(el).fontSize
  return `${el.tagName.toLowerCase()}${label ? ` "${label}"` : ''} at ${size}`
}

/** Watches for the screen being zoomed in; reports it once a session. */
export function watchZoom(): void {
  const viewport = window.visualViewport
  if (!viewport) return
  let told = false
  viewport.addEventListener('resize', () => {
    if (told || viewport.scale <= 1.05) return
    told = true
    report({ page: 'campaign', kind: 'check', phase: 'zoom', message: `Screen zoomed to ${viewport.scale.toFixed(2)}x on ${describeFocus(document.activeElement)}` })
  })
}
