// A screen of its own over everything, the way the Cutter's edit screen is a
// page of its own (his report, 2026-11-15: "The timeline editor page in the
// batch section does not open good"). The batch's clip screens are drawn
// inside the Batch tab; the timeline nested there shared the tab's page - it
// could scroll under his drags and sit under the tab bar on the iPhone. Here
// it is put straight on the page's body, alone, the page under it held still.

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function FullPage({ children, className = '' }: { children: ReactNode; className?: string }) {
  useEffect(() => {
    const body = document.body
    const was = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = was
    }
  }, [])
  return createPortal(<main className={`full-page ${className}`.trim()}>{children}</main>, document.body)
}
