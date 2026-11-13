// The words on a product step's clip, put where he wants them (his ask,
// 2026-11-11: "right next to the video we have an example of a phone screen.
// Then we can click on the phone screen and put, let's say, a text on top and
// a text at the bottom"). A phone screen with the step's own clip playing;
// tap anywhere to put words there, drag them, make them bigger or smaller,
// pick their look - as many as he likes. Drawn with the same code as the
// videos (overlay.ts), so what he sees is what every video of the step gets.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { BatchStep, StepText } from './batch'
import { stepTitle } from './batch'
import { headlineFontReady } from './headlineFont'
import type { Angle } from './look'
import { drawHeadline, layoutHeadline, type HeadlineLayout } from './overlay'
import { loadBankFile } from './store'
import { isUpright } from './framing916'

/** The frame the words are laid out on: the videos' own size. */
const W = 1080
const H = 1920
const STYLES: { style: NonNullable<StepText['style']>; label: string }[] = [
  { style: 'outline', label: 'Outline' },
  { style: 'box', label: 'White box' },
  { style: 'snap', label: 'Snapchat' },
]
const SCALE = { min: 0.4, max: 2.5, step: 0.15 }

/** A canvas only for measuring words, made once. */
let measuring: CanvasRenderingContext2D | null = null
const measureCtx = () => (measuring ??= document.createElement('canvas').getContext('2d'))

const newId = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** What he starts from: his words as saved, or the step's name at the top. */
export function startingTexts(step: Pick<BatchStep, 'name' | 'texts'>): StepText[] {
  if (step.texts) return step.texts
  const name = stepTitle(step.name)
  return name ? [{ id: newId(), text: name, place: { x: 0.5, y: 0.2, scale: 1 } }] : []
}

/** Where a laid-out text sits on the frame, for tapping it. */
function boxOf(layout: HeadlineLayout): { x: number; y: number; w: number; h: number } {
  const w = Math.max(...layout.lines.map((l) => l.width)) + layout.fontPx
  const h = layout.lines.length * layout.lineHeight + layout.fontPx * 0.4
  return { x: layout.centerX - w / 2, y: layout.top - layout.fontPx * 0.2, w, h }
}

export function StepTexts({
  step,
  look,
  onSave,
  onClose,
}: {
  step: BatchStep
  /** The campaign's headline look: size, outline colour - the words take it. */
  look: Angle['headline']
  /** The step's words; undefined puts its name back at the top. */
  onSave: (texts: StepText[] | undefined) => void
  onClose: () => void
}) {
  const [texts, setTexts] = useState<StepText[]>(() => startingTexts(step))
  const [selected, setSelected] = useState<string | null>(texts[0]?.id ?? null)
  const [url, setUrl] = useState<string | null>(null)
  const [whole, setWhole] = useState(false)
  const [fontReady, setFontReady] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const current = texts.find((t) => t.id === selected) ?? null

  // The step's first clip, playing on the phone.
  const first = step.files[0]
  useEffect(() => {
    if (!first) return
    let alive = true
    let made: string | null = null
    void loadBankFile(first)
      .then((file) => {
        if (!alive || !file) return
        made = URL.createObjectURL(file)
        setUrl(made)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [first])

  useEffect(() => {
    let alive = true
    void headlineFontReady()
      .catch(() => {})
      .then(() => alive && setFontReady(true))
    return () => {
      alive = false
    }
  }, [])

  // Each text laid out as the videos lay it out.
  const layouts = useMemo(() => {
    const ctx = measureCtx()
    if (!ctx) return new Map<string, HeadlineLayout>()
    const out = new Map<string, HeadlineLayout>()
    for (const t of texts) {
      if (!t.text.trim()) continue
      try {
        const laid = layoutHeadline(ctx, W, H, { ...look, style: t.style ?? 'outline', text: t.text, place: t.place })
        if (laid) out.set(t.id, laid)
      } catch {
        // A word it can't draw yet (a picture still loading): left off the preview.
      }
    }
    return out
    // fontReady: laid out again once the headline font is in.
  }, [texts, look, fontReady]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    for (const [id, laid] of layouts) {
      drawHeadline(ctx, laid)
      if (id === selected) {
        const b = boxOf(laid)
        ctx.save()
        ctx.strokeStyle = '#0a84ff'
        ctx.lineWidth = 6
        ctx.setLineDash([24, 14])
        ctx.strokeRect(b.x, b.y, b.w, b.h)
        ctx.restore()
      }
    }
  }, [layouts, selected])

  const change = (id: string, fields: Partial<StepText>) => setTexts((all) => all.map((t) => (t.id === id ? { ...t, ...fields } : t)))

  const add = (x: number, y: number) => {
    const t: StepText = { id: newId(), text: '', place: { x: clamp(x, 0.1, 0.9), y: clamp(y, 0.06, 0.94), scale: 1 } }
    setTexts((all) => [...all, t])
    setSelected(t.id)
    window.setTimeout(() => input.current?.focus(), 0)
  }

  /** A point on the phone screen, as fractions of the frame. */
  const at = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const down = (e: React.PointerEvent) => {
    const p = at(e)
    const hit = [...layouts].reverse().find(([, laid]) => {
      const b = boxOf(laid)
      return p.x * W >= b.x && p.x * W <= b.x + b.w && p.y * H >= b.y && p.y * H <= b.y + b.h
    })
    if (!hit) return add(p.x, p.y)
    const t = texts.find((x) => x.id === hit[0])!
    setSelected(t.id)
    drag.current = { id: t.id, dx: p.x - t.place.x, dy: p.y - t.place.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = at(e)
    const t = texts.find((x) => x.id === d.id)
    if (!t) return
    change(d.id, { place: { ...t.place, x: clamp(p.x - d.dx, 0.1, 0.9), y: clamp(p.y - d.dy, 0.05, 0.95) } })
  }

  const up = () => {
    drag.current = null
  }

  const resize = (by: number) => current && change(current.id, { place: { ...current.place, scale: clamp(Math.round((current.place.scale + by) * 100) / 100, SCALE.min, SCALE.max) } })

  const save = () => {
    onSave(texts.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text))
    onClose()
  }

  return (
    <div className="step-texts">
      <div className="step-texts-main">
        <div
          className="step-phone"
          role="application"
          aria-label={`Phone screen for ${step.name}: tap to put words there, drag them to move`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {url ? (
            <video
              src={url}
              muted
              loop
              autoPlay
              playsInline
              // A wide clip is shown whole in the made video, as here.
              className={whole ? 'whole' : undefined}
              onLoadedMetadata={(e) => setWhole(!isUpright(e.currentTarget.videoWidth, e.currentTarget.videoHeight))}
            />
          ) : (
            <span className="step-phone-empty">{first ? '…' : 'Add a clip to see it here'}</span>
          )}
          <canvas ref={canvas} width={W} height={H} />
        </div>
        <div className="step-texts-side">
          <p className="hint">Tap the screen where words should go, then type them. Drag to move.</p>
          <button type="button" className="btn small" onClick={() => add(0.5, 0.18)}>
            + Text at the top
          </button>
          <button type="button" className="btn small" onClick={() => add(0.5, 0.8)}>
            + Text at the bottom
          </button>
        </div>
      </div>

      {current ? (
        <div className="step-text-edit">
          <label className="field">
            <span className="label">Words</span>
            <input ref={input} type="text" value={current.text} maxLength={120} placeholder="Type the words" onChange={(e) => change(current.id, { text: e.target.value })} />
          </label>
          <div className="seg" role="group" aria-label="Look">
            {STYLES.map((s) => (
              <button key={s.style} type="button" className={(current.style ?? 'outline') === s.style ? 'active' : ''} aria-pressed={(current.style ?? 'outline') === s.style} onClick={() => change(current.id, { style: s.style })}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="stepper">
            <span className="label">Size</span>
            <button type="button" className="btn small icon-btn" aria-label="Smaller" disabled={current.place.scale <= SCALE.min} onClick={() => resize(-SCALE.step)}>
              −
            </button>
            <span className="stepper-value">{Math.round(current.place.scale * 100)}%</span>
            <button type="button" className="btn small icon-btn" aria-label="Bigger" disabled={current.place.scale >= SCALE.max} onClick={() => resize(SCALE.step)}>
              +
            </button>
          </div>
          <button
            type="button"
            className="btn small danger"
            onClick={() => {
              setTexts((all) => all.filter((t) => t.id !== current.id))
              setSelected(null)
            }}
          >
            Take these words out
          </button>
        </div>
      ) : texts.length === 0 ? (
        <p className="hint">No words on this step's clip. Tap the screen to add some.</p>
      ) : null}

      <div className="actions-row">
        <button type="button" className="btn primary" onClick={save}>
          Save
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {step.texts ? (
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              onSave(undefined)
              onClose()
            }}
          >
            Back to its name at the top
          </button>
        ) : null}
      </div>
    </div>
  )
}
