// The captions' phrases in a sheet over the screen (his ask, 2026-11-13: "I
// don't like the sort of caption scrollable feature, with a small screen it's
// horrible to use ... same scrollable but as a sort of overlay on screen. Take
// half or 75% of the screen, little opacity so we see behind it, and we can
// scroll thru the captions, close it, open it and when its closed i got the
// full screen for like other editing things ... do this everywhere").
//
// Over the bottom of the screen, see-through enough to watch the video behind
// it; its grip makes it half or three quarters of the screen; ✕ closes it.
// Typing, it sits on the keyboard. Open or closed and its size are kept for
// next time, so he sets them once.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A remembered yes/no, per phone. */
export function useSheetPref(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : stored === 'true'
    } catch {
      return initial
    }
  })
  const set = (next: boolean) => {
    setValue(next)
    try {
      localStorage.setItem(key, String(next))
    } catch {
      // Just won't be remembered.
    }
  }
  return [value, set]
}

/** How far the keyboard (or anything else) covers the bottom of the screen,
 *  and the height left above it. */
function useKeyboard(): { inset: number; room: number } {
  const read = () => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return { inset: 0, room: typeof window !== 'undefined' ? window.innerHeight : 0 }
    return { inset: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)), room: Math.round(vv.height) }
  }
  const [state, setState] = useState(read)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setState(read())
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return state
}

/** The least room the sheet keeps for the screen above it while he types. */
const ABOVE_KEYBOARD = 64

export function CaptionSheet({
  open,
  onClose,
  title,
  extra,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Its name and counts, beside ✕. */
  title: ReactNode
  /** Above the phrases, not scrolled with them: Claude's check, the filter. */
  extra?: ReactNode
  children: ReactNode
}) {
  const [tall, setTall] = useSheetPref('captions.sheetTall', false)
  const { inset, room } = useKeyboard()
  if (!open || typeof document === 'undefined') return null
  const typing = inset > 40
  return createPortal(
    <div
      className={`caption-sheet${tall ? ' tall' : ''}${typing ? ' over-keyboard' : ''}`}
      role="dialog"
      aria-label="Captions"
      style={typing ? { bottom: inset, height: Math.max(160, Math.min(room - ABOVE_KEYBOARD, room * (tall ? 0.8 : 0.6))) } : undefined}
    >
      <button type="button" className="caption-sheet-grip" aria-label={tall ? 'Make the captions smaller' : 'Make the captions bigger'} onClick={() => setTall(!tall)}>
        <span />
      </button>
      <div className="caption-sheet-head">
        <div className="caption-sheet-title">{title}</div>
        <button type="button" className="caption-sheet-close" aria-label="Close the captions" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {extra ? <div className="caption-sheet-extra">{extra}</div> : null}
      <div className="caption-sheet-body">{children}</div>
    </div>,
    document.body,
  )
}
