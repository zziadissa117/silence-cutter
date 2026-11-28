// Where a batch format's headline goes over the hook (his ask, 2026-11-28:
// "make it so we can move the headline however we want in the hook"). A
// phone screen with one of the format's hook clips behind, the headline drawn
// over it with the same code as the videos (overlay.ts): drag it anywhere,
// pinch or slide its size; near the middle it snaps there with a guide line.
// Every video of the format puts its own headline at that spot
// (BatchFormat.headlinePlace); "Usual spot" puts the campaign's back.

import { useEffect, useRef, useState } from 'react'

import type { BankFile } from './batch'
import { DeadZone } from './DeadZone'
import { headlineFontReady } from './headlineFont'
import { HEADLINE_SCALE, type Angle, type HeadlinePlace } from './look'
import { drawHeadline, layoutHeadline } from './overlay'
import { snapToMiddle } from './StepTexts'

const W = 1080
const H = 1920
const START: HeadlinePlace = { x: 0.5, y: 0.3, scale: 1 }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function HookPlace({
  place,
  look,
  text,
  clip,
  loadFile,
  onSave,
  onClose,
}: {
  place: HeadlinePlace | undefined
  /** The headline's look as the videos draw it (style, size, colours). */
  look: Angle['headline']
  /** One of the headlines, to see it. */
  text: string
  /** One of the format's hook clips, behind it. */
  clip: BankFile | null
  loadFile: (file: BankFile) => Promise<Blob | null>
  onSave: (place: HeadlinePlace | undefined) => void
  onClose: () => void
}) {
  const [at, setAt] = useState<HeadlinePlace>(place ?? START)
  const [url, setUrl] = useState<string | null>(null)
  const [guides, setGuides] = useState({ across: false, down: false })
  const [dragging, setDragging] = useState(false)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const screen = useRef<HTMLDivElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const grab = useRef<{ dx: number; dy: number; pinch?: { from: number; scale: number } } | null>(null)

  useEffect(() => {
    if (!clip) return
    let made: string | null = null
    let alive = true
    void loadFile(clip).then((blob) => {
      if (!alive || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [clip, loadFile])

  useEffect(() => {
    let alive = true
    void headlineFontReady().then(() => {
      const ctx = canvas.current?.getContext('2d')
      if (!alive || !ctx) return
      ctx.clearRect(0, 0, W, H)
      const laid = layoutHeadline(ctx, W, H, { ...look, text: text || 'Your headline here', place: at })
      if (laid) drawHeadline(ctx, laid)
    })
    return () => {
      alive = false
    }
  }, [at, look, text])

  const point = (e: React.PointerEvent) => {
    const r = screen.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, (a.y - b.y) * (H / W)) : 0
  }

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = point(e)
    pointers.current.set(e.pointerId, p)
    setDragging(true)
    if (pointers.current.size === 2) grab.current = { dx: 0, dy: 0, pinch: { from: spread(), scale: at.scale } }
    else grab.current = { dx: p.x - at.x, dy: p.y - at.y }
  }
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !grab.current) return
    const p = point(e)
    pointers.current.set(e.pointerId, p)
    const pinch = grab.current.pinch
    if (pinch && pointers.current.size === 2) {
      const now = spread()
      if (pinch.from > 0) setAt((a) => ({ ...a, scale: clamp((pinch.scale * now) / pinch.from, HEADLINE_SCALE.min, HEADLINE_SCALE.max) }))
      return
    }
    const snapped = snapToMiddle(clamp(p.x - grab.current.dx, 0.05, 0.95), clamp(p.y - grab.current.dy, 0.04, 0.96))
    setGuides({ across: snapped.across, down: snapped.down })
    setAt((a) => ({ ...a, x: snapped.x, y: snapped.y }))
  }
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      grab.current = null
      setDragging(false)
      setGuides({ across: false, down: false })
    } else {
      const [rest] = [...pointers.current.values()]
      grab.current = { dx: rest.x - at.x, dy: rest.y - at.y }
    }
  }

  return (
    <div className="hook-place" role="dialog" aria-label="Where the headline goes">
      <p className="hint">Drag the headline where you want it on every video of this format. Pinch, or use Size, to make it bigger or smaller.</p>
      <div
        ref={screen}
        className="hook-place-screen"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ touchAction: 'none' }}
      >
        {url ? <video src={`${url}#t=0.5`} muted playsInline preload="metadata" /> : <span className="hook-place-empty" />}
        <canvas ref={canvas} width={W} height={H} aria-hidden="true" />
        {dragging ? <DeadZone label={false} /> : null}
        {guides.across ? <span className="hook-place-guide across" /> : null}
        {guides.down ? <span className="hook-place-guide down" /> : null}
      </div>
      <label className="slider">
        <span>Size</span>
        <input
          type="range"
          min={HEADLINE_SCALE.min}
          max={HEADLINE_SCALE.max}
          step={0.05}
          value={at.scale}
          aria-label="Headline size"
          onChange={(e) => setAt((a) => ({ ...a, scale: Number(e.target.value) }))}
        />
        <output>{Math.round(at.scale * 100)}%</output>
      </label>
      <div className="actions-row">
        <button
          type="button"
          className="btn small primary"
          onClick={() => {
            onSave(at)
            onClose()
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            onSave(undefined)
            onClose()
          }}
        >
          Usual spot
        </button>
        <button type="button" className="linkbtn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
