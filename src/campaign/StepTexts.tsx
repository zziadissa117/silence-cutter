// The words on a product step's clip, put where he wants them (his ask,
// 2026-11-11: "right next to the video we have an example of a phone screen.
// Then we can click on the phone screen and put, let's say, a text on top and
// a text at the bottom"). A phone screen with the step's own clip playing;
// tap anywhere to put words there, drag them, make them bigger or smaller,
// pick their look - as many as he likes. Drawn with the same code as the
// videos (overlay.ts), so what he sees is what every video of the step gets.
//
// And pictures and videos over it the same way (his ask, 2026-11-13: "make
// it so I can add an overlay too, not only text ... a video or a picture from
// the video bank, from whatever"): from his phone, the video bank or the
// picture bank, dragged where he wants, bigger or smaller - each pops up
// every time the step plays (stepOverlays.ts). Dragging anything near the
// middle snaps it there and shows a line, so he knows it is centred.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { BankFile, BatchStep, StepOverlay, StepText } from './batch'
import { stepTitle } from './batch'
import { fingerprint } from './fingerprint'
import { headlineFontReady } from './headlineFont'
import type { Angle, BankPicture } from './look'
import { drawHeadline, layoutHeadline, type HeadlineLayout } from './overlay'
import { loadBank, loadBankFile, retireBankFiles, saveBankFile } from './store'
import { isUpright } from './framing916'
import { OVERLAY_START, OVERLAY_WIDTH, overlayBox } from './stepOverlays'
import { useVideoBank, videoFile } from './videoBank'

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

/** Within this of the middle (share of the frame), a drag snaps to it. */
const SNAP = { x: 0.025, y: 0.015 } as const

/** A dragged point, snapped to the middle across and up and down when close,
 *  and which of the two it snapped to - for the guide lines. */
export function snapToMiddle(x: number, y: number): { x: number; y: number; across: boolean; down: boolean } {
  const across = Math.abs(x - 0.5) < SNAP.x
  const down = Math.abs(y - 0.5) < SNAP.y
  return { x: across ? 0.5 : x, y: down ? 0.5 : y, across, down }
}

/** What he saved: the step's words (undefined: its name at the top) and
 *  its pictures and videos. */
export interface StepLook {
  texts: StepText[] | undefined
  overlays: StepOverlay[]
}

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
  /** The step's words (undefined puts its name back at the top) and its
   *  pictures and videos. */
  onSave: (saved: StepLook) => void
  onClose: () => void
}) {
  const [texts, setTexts] = useState<StepText[]>(() => startingTexts(step))
  const [selected, setSelected] = useState<string | null>(texts[0]?.id ?? null)
  const [overlays, setOverlays] = useState<StepOverlay[]>(() => step.overlays ?? [])
  const [chosen, setChosen] = useState<string | null>(null)
  /** Each overlay's picture or video, and its shape (height over width). */
  const [media, setMedia] = useState<Record<string, { url: string; shape: number }>>({})
  /** Files kept on this phone while he was here - let go if he cancels. */
  const added = useRef<string[]>([])
  const [guides, setGuides] = useState({ across: false, down: false })
  const [picking, setPicking] = useState(false)
  const [keeping, setKeeping] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const videos = useVideoBank()
  const [pictures, setPictures] = useState<BankPicture[]>([])
  const currentOverlay = overlays.find((o) => o.id === chosen) ?? null
  const [url, setUrl] = useState<string | null>(null)
  const [whole, setWhole] = useState(false)
  const [fontReady, setFontReady] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const drag = useRef<{ id: string; overlay: boolean; dx: number; dy: number } | null>(null)
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

  // Each overlay's file, to show on the phone screen.
  useEffect(() => {
    let alive = true
    for (const o of overlays) {
      if (media[o.file.id]) continue
      void loadBankFile(o.file).then((file) => {
        if (!alive || !file) return
        const url = URL.createObjectURL(file)
        setMedia((m) => (m[o.file.id] ? m : { ...m, [o.file.id]: { url, shape: 1 } }))
      })
    }
    return () => {
      alive = false
    }
  }, [overlays]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(media).forEach((m) => URL.revokeObjectURL(m.url)), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (picking && pictures.length === 0) void loadBank().then(setPictures).catch(() => {})
  }, [picking]) // eslint-disable-line react-hooks/exhaustive-deps
  const shapeOf = (fileId: string, w: number, h: number) =>
    w > 0 && h > 0 && setMedia((m) => (m[fileId] && Math.abs(m[fileId].shape - h / w) > 1e-3 ? { ...m, [fileId]: { ...m[fileId], shape: h / w } } : m))

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
    // The middle, while something dragged sits exactly on it.
    ctx.save()
    ctx.strokeStyle = '#ffd60a'
    ctx.lineWidth = 5
    if (guides.across) {
      ctx.beginPath()
      ctx.moveTo(W / 2, 0)
      ctx.lineTo(W / 2, H)
      ctx.stroke()
    }
    if (guides.down) {
      ctx.beginPath()
      ctx.moveTo(0, H / 2)
      ctx.lineTo(W, H / 2)
      ctx.stroke()
    }
    ctx.restore()
  }, [layouts, selected, guides])

  const change = (id: string, fields: Partial<StepText>) => setTexts((all) => all.map((t) => (t.id === id ? { ...t, ...fields } : t)))

  const add = (x: number, y: number) => {
    const t: StepText = { id: newId(), text: '', place: { x: clamp(x, 0.1, 0.9), y: clamp(y, 0.06, 0.94), scale: 1 } }
    setTexts((all) => [...all, t])
    setSelected(t.id)
    setChosen(null)
    window.setTimeout(() => input.current?.focus(), 0)
  }

  const changeOverlay = (id: string, place: Partial<StepOverlay['place']>) => setOverlays((all) => all.map((o) => (o.id === id ? { ...o, place: { ...o.place, ...place } } : o)))

  /** A picture or video kept on this phone with the batch's clips, then on
   *  the step in the middle, chosen to move. */
  const keepOverlay = async (blob: Blob, name: string, type: string) => {
    setProblem(null)
    setKeeping(`Keeping ${name}…`)
    try {
      const id = crypto.randomUUID()
      await saveBankFile(id, blob)
      added.current.push(id)
      const file: BankFile = { id, name, type, size: blob.size, fp: await fingerprint(blob).catch(() => undefined) }
      const overlay: StepOverlay = { id: newId(), file, place: { ...OVERLAY_START } }
      setOverlays((all) => [...all, overlay])
      setChosen(overlay.id)
      setSelected(null)
      setPicking(false)
    } catch (error) {
      setProblem(`${name} couldn't be kept: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setKeeping(null)
    }
  }

  /** Where each overlay is on the phone screen, as fractions. */
  const boxOfOverlay = (o: StepOverlay) => {
    const b = overlayBox(o.place, media[o.file.id]?.shape ?? 1, W, H)
    return { x: b.x / W, y: b.y / H, w: b.width / W, h: b.height / H }
  }

  /** A point on the phone screen, as fractions of the frame. */
  const at = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const down = (e: React.PointerEvent) => {
    const p = at(e)
    // Words are on top of the pictures, as in the videos.
    const hit = [...layouts].reverse().find(([, laid]) => {
      const b = boxOf(laid)
      return p.x * W >= b.x && p.x * W <= b.x + b.w && p.y * H >= b.y && p.y * H <= b.y + b.h
    })
    if (hit) {
      const t = texts.find((x) => x.id === hit[0])!
      setSelected(t.id)
      setChosen(null)
      drag.current = { id: t.id, overlay: false, dx: p.x - t.place.x, dy: p.y - t.place.y }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const over = [...overlays].reverse().find((o) => {
      const b = boxOfOverlay(o)
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
    })
    if (!over) return add(p.x, p.y)
    setChosen(over.id)
    setSelected(null)
    drag.current = { id: over.id, overlay: true, dx: p.x - over.place.x, dy: p.y - over.place.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = at(e)
    const snapped = snapToMiddle(p.x - d.dx, p.y - d.dy)
    setGuides((g) => (g.across === snapped.across && g.down === snapped.down ? g : { across: snapped.across, down: snapped.down }))
    if (d.overlay) {
      changeOverlay(d.id, { x: clamp(snapped.x, 0.02, 0.98), y: clamp(snapped.y, 0.02, 0.98) })
      return
    }
    const t = texts.find((x) => x.id === d.id)
    if (!t) return
    change(d.id, { place: { ...t.place, x: clamp(snapped.x, 0.1, 0.9), y: clamp(snapped.y, 0.05, 0.95) } })
  }

  const up = () => {
    drag.current = null
    setGuides({ across: false, down: false })
  }

  const resize = (by: number) => current && change(current.id, { place: { ...current.place, scale: clamp(Math.round((current.place.scale + by) * 100) / 100, SCALE.min, SCALE.max) } })

  /** Files no longer on the step, let go: the ones taken out, and ones
   *  added here and taken out again. */
  const letGo = (kept: StepOverlay[]) => {
    const still = new Set(kept.map((o) => o.file.id))
    const gone = [...(step.overlays ?? []).map((o) => o.file.id), ...added.current].filter((id) => !still.has(id))
    if (gone.length > 0) void retireBankFiles([...new Set(gone)]).catch(() => {})
  }

  const save = () => {
    letGo(overlays)
    onSave({ texts: texts.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text), overlays })
    onClose()
  }

  const cancel = () => {
    if (added.current.length > 0) void retireBankFiles(added.current).catch(() => {})
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
          {overlays.map((o) => {
            const m = media[o.file.id]
            if (!m) return null
            const b = boxOfOverlay(o)
            const style = { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }
            const cls = `step-overlay${o.id === chosen ? ' chosen' : ''}`
            return o.file.type.startsWith('image/') ? (
              <img key={o.id} src={m.url} alt="" className={cls} style={style} onLoad={(e) => shapeOf(o.file.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
            ) : (
              <video
                key={o.id}
                src={m.url}
                muted
                loop
                autoPlay
                playsInline
                className={cls}
                style={style}
                onLoadedMetadata={(e) => shapeOf(o.file.id, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
              />
            )
          })}
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
          <label className="btn small picker">
            + Picture or video
            <input
              type="file"
              accept="image/*,video/*"
              aria-label="Add a picture or video from your phone"
              disabled={keeping !== null}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void keepOverlay(file, file.name, file.type || (file.name.match(/\.(mov|mp4|m4v)$/i) ? 'video/mp4' : 'image/png'))
              }}
            />
          </label>
          <button type="button" className="btn small" aria-expanded={picking} disabled={keeping !== null} onClick={() => setPicking((p) => !p)}>
            + From your banks
          </button>
          {keeping ? <p className="hint">{keeping}</p> : null}
        </div>
      </div>

      {picking ? (
        <div className="step-bank-pick">
          {videos.length + pictures.length === 0 ? <p className="hint">Nothing in your video or picture bank yet.</p> : null}
          {videos.map((v) => (
            <button
              key={v.id}
              type="button"
              className="btn small"
              onClick={() =>
                void videoFile(v).then((file) => (file ? keepOverlay(file, v.name, v.type || 'video/mp4') : setProblem(`${v.name} is no longer on this phone.`)))
              }
            >
              {v.name}
            </button>
          ))}
          {pictures.map((pic) => (
            <button key={pic.id} type="button" className="step-bank-picture" aria-label={`Picture: ${pic.words.join(', ') || 'from the bank'}`} onClick={() => void keepOverlay(pic.image, `${pic.words[0] ?? 'picture'}.png`, pic.image.type || 'image/png')}>
              <BankThumb image={pic.image} />
            </button>
          ))}
        </div>
      ) : null}
      {problem ? <p className="hint warn-text">{problem}</p> : null}

      {currentOverlay ? (
        <div className="step-text-edit">
          <span className="label">{currentOverlay.file.type.startsWith('image/') ? 'Picture' : 'Video'} · {currentOverlay.file.name}</span>
          <p className="hint">Pops up every time this step plays{currentOverlay.file.type.startsWith('image/') ? ', for the whole step' : ', muted, playing to its end'}. Drag it to move it.</p>
          <div className="stepper">
            <span className="label">Size</span>
            <button
              type="button"
              className="btn small icon-btn"
              aria-label="Smaller"
              disabled={currentOverlay.place.width <= OVERLAY_WIDTH.min}
              onClick={() => changeOverlay(currentOverlay.id, { width: clamp(Math.round((currentOverlay.place.width - OVERLAY_WIDTH.step) * 100) / 100, OVERLAY_WIDTH.min, OVERLAY_WIDTH.max) })}
            >
              −
            </button>
            <span className="stepper-value">{Math.round(currentOverlay.place.width * 100)}%</span>
            <button
              type="button"
              className="btn small icon-btn"
              aria-label="Bigger"
              disabled={currentOverlay.place.width >= OVERLAY_WIDTH.max}
              onClick={() => changeOverlay(currentOverlay.id, { width: clamp(Math.round((currentOverlay.place.width + OVERLAY_WIDTH.step) * 100) / 100, OVERLAY_WIDTH.min, OVERLAY_WIDTH.max) })}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="btn small danger"
            onClick={() => {
              setOverlays((all) => all.filter((o) => o.id !== currentOverlay.id))
              setChosen(null)
            }}
          >
            Take it out
          </button>
        </div>
      ) : null}

      {current && !currentOverlay ? (
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
      ) : texts.length === 0 && overlays.length === 0 ? (
        <p className="hint">No words on this step's clip. Tap the screen to add some.</p>
      ) : null}

      <div className="actions-row">
        <button type="button" className="btn primary" onClick={save}>
          Save
        </button>
        <button type="button" className="btn" onClick={cancel}>
          Cancel
        </button>
        {step.texts ? (
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              letGo(overlays)
              onSave({ texts: undefined, overlays })
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

/** A bank picture's small still. */
function BankThumb({ image }: { image: Blob }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const made = URL.createObjectURL(image)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [image])
  return url ? <img src={url} alt="" /> : null
}
