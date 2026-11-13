// The height of a talking head format's captions, dragged on a small phone
// screen (his ask, 2026-11-13: "let me change the captions' height ... at the
// top, at the bottom, or at the middle. Let me change it manually and not in
// a set space"). Set once per format; every video of it puts them there.
// Near the middle it snaps there and shows the line, like the step words.

import { useRef, useState } from 'react'

import { CAPTION_SPOT, captionY } from './captions'

/** Within this of the middle, a drag snaps to it. */
const SNAP = 0.015

/** A dragged height kept inside the room captions have, snapped to the
 *  middle when close. */
export function captionHeightAt(y: number): number {
  if (Math.abs(y - 0.5) < SNAP) return 0.5
  return Math.round(Math.min(CAPTION_SPOT.max, Math.max(CAPTION_SPOT.min, y)) * 1000) / 1000
}

export function CaptionHeight({ value, onChange }: { value: number | undefined; onChange: (y: number | undefined) => void }) {
  const [dragging, setDragging] = useState<number | null>(null)
  const screen = useRef<HTMLDivElement>(null)
  const y = dragging ?? captionY(value ?? 'usual')
  const at = (e: React.PointerEvent) => {
    const r = screen.current!.getBoundingClientRect()
    return captionHeightAt((e.clientY - r.top) / r.height)
  }
  return (
    <div className="caption-height">
      <div
        ref={screen}
        className="caption-height-screen"
        role="slider"
        aria-label="Captions height"
        aria-valuemin={Math.round(CAPTION_SPOT.min * 100)}
        aria-valuemax={Math.round(CAPTION_SPOT.max * 100)}
        aria-valuenow={Math.round(y * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(at(e))
        }}
        onPointerMove={(e) => dragging !== null && setDragging(at(e))}
        onPointerUp={() => {
          if (dragging !== null) onChange(dragging)
          setDragging(null)
        }}
        onPointerCancel={() => setDragging(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(captionHeightAt(y + (e.key === 'ArrowUp' ? -0.02 : 0.02)))
          }
        }}
      >
        {y === 0.5 && dragging !== null ? <span className="caption-height-middle" /> : null}
        <span className="caption-height-sample" style={{ top: `${y * 100}%` }}>
          your captions
        </span>
      </div>
      <div className="setting-text">
        <span className="row-name">Captions height</span>
        <span className="row-line">Drag them up or down on the screen. Every video of this format puts them there.</span>
        {value !== undefined ? (
          <button type="button" className="linkbtn" onClick={() => onChange(undefined)}>
            Back to the usual place
          </button>
        ) : null}
      </div>
    </div>
  )
}
