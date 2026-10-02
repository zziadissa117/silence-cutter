// The angle's effects, each with an example to watch before it is used.
//
// An example plays the effect on a stand-in frame - or on a frame of one of
// his own videos - through the same functions the real render uses (see
// effects.ts), so what plays here is what a video will do. Choosing a level
// plays its example straight away, the way choosing a sound plays it.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'

import {
  NO_EFFECTS,
  framingAt,
  logoPop,
  placeFrame,
  planMotion,
  type AngleEffects,
  type EffectLevel,
  type MotionPlan,
} from './effects'
import type { VideoLook } from './look'
import { drawHeadline, drawLogo, drawPoppedLogo, layoutHeadline, layoutLogo } from './overlay'

type Example = 'cutPunch' | 'hookPush' | 'brandHit' | 'logoPop' | 'all'

const WIDTH = 540
const HEIGHT = 960

const LEVELS: { value: EffectLevel; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'strong', label: 'Strong' },
]

const NAMES: Record<Example, string> = {
  cutPunch: 'Punch-in at cuts',
  hookPush: 'Hook push-in',
  brandHit: 'Brand punch-in',
  logoPop: 'Pop-in',
  all: 'Everything together',
}

/** One example: how long it runs, where its cuts fall, and when the brand is
 *  said - a short stand-in for a real video. */
interface Script {
  segments: number[]
  brandAt: number[]
  effects: AngleEffects
}

function scriptFor(example: Example, effects: AngleEffects): Script {
  const at = (level: EffectLevel): EffectLevel => (level === 'off' ? 'subtle' : level)
  switch (example) {
    case 'cutPunch':
      return { segments: [1.2, 1.0, 1.3, 0.9, 1.2], brandAt: [], effects: { ...NO_EFFECTS, cutPunch: at(effects.cutPunch) } }
    case 'hookPush':
      return { segments: [4.5], brandAt: [], effects: { ...NO_EFFECTS, hookPush: at(effects.hookPush) } }
    case 'brandHit':
      return { segments: [4.2], brandAt: [1.2], effects: { ...NO_EFFECTS, brandHit: at(effects.brandHit), logoPop: effects.logoPop } }
    case 'logoPop':
      return { segments: [4], brandAt: [0.8], effects: { ...NO_EFFECTS, logoPop: true } }
    case 'all':
      return { segments: [1.5, 1.2, 1.6, 1.3], brandAt: [2.9], effects }
  }
}

/** A plan for the example. Cuts in a real video change the framing about
 *  three times in four; an example that happened to change it once would
 *  show nothing, so a seed is picked that shows the effect clearly - a
 *  different one each play, to show how videos vary. */
function examplePlan(script: Script, play: number): MotionPlan {
  let best: MotionPlan | null = null
  for (let tries = 0; tries < 40; tries++) {
    const plan = planMotion(script.effects, script.segments, `example-${play}-${tries}`, script.brandAt.length)
    const changes = plan.segments.filter((s, i) => i > 0 && s.scale !== plan.segments[i - 1].scale).length
    if (!best || changes >= 3) best = plan
    if (changes >= 3) break
  }
  return best!
}

/** A stand-in for a video frame: a person at a desk, framed the way he films
 *  - face in the middle, a little above centre - so zooms have something to
 *  move toward. */
function standInFrame(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
  const g = canvas.getContext('2d')!
  const wall = g.createLinearGradient(0, 0, 0, HEIGHT)
  wall.addColorStop(0, '#3a4250')
  wall.addColorStop(1, '#262c36')
  g.fillStyle = wall
  g.fillRect(0, 0, WIDTH, HEIGHT)
  // A shelf behind him, for depth.
  g.fillStyle = '#2f3642'
  g.fillRect(0, HEIGHT * 0.22, WIDTH * 0.3, HEIGHT * 0.3)
  g.fillStyle = '#4a5363'
  for (let i = 0; i < 6; i++) g.fillRect(WIDTH * (0.02 + i * 0.045), HEIGHT * 0.25, WIDTH * 0.03, HEIGHT * 0.1)
  for (let i = 0; i < 5; i++) g.fillRect(WIDTH * (0.03 + i * 0.05), HEIGHT * 0.39, WIDTH * 0.035, HEIGHT * 0.1)
  // Shoulders, neck, head.
  g.fillStyle = '#58616f'
  g.beginPath()
  g.ellipse(WIDTH * 0.5, HEIGHT * 0.78, WIDTH * 0.36, HEIGHT * 0.2, 0, Math.PI, 0)
  g.fill()
  g.fillRect(WIDTH * 0.14, HEIGHT * 0.78, WIDTH * 0.72, HEIGHT * 0.22)
  g.fillStyle = '#8b93a0'
  g.fillRect(WIDTH * 0.45, HEIGHT * 0.44, WIDTH * 0.1, HEIGHT * 0.08)
  g.beginPath()
  g.ellipse(WIDTH * 0.5, HEIGHT * 0.4, WIDTH * 0.12, HEIGHT * 0.085, 0, 0, Math.PI * 2)
  g.fill()
  // A desk edge.
  g.fillStyle = '#1b1f26'
  g.fillRect(0, HEIGHT * 0.9, WIDTH, HEIGHT * 0.1)
  return canvas
}

/** One frame of one of his own videos, a second in, to play the examples
 *  on instead of the stand-in. */
async function frameFrom(file: Blob): Promise<ImageBitmap> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('That file has no picture.')
    const duration = await input.computeDuration()
    const sample = await new VideoSampleSink(track).getSample(Math.min(1, duration / 2))
    if (!sample) throw new Error("Couldn't read a frame from that video.")
    const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
    sample.drawWithFit(canvas.getContext('2d')!, { fit: 'cover' })
    sample.close()
    return await createImageBitmap(canvas)
  } finally {
    input.dispose()
  }
}

export function EffectsSection({
  look,
  hasBrand,
  onChange,
}: {
  /** The angle as it stands, for the headline, the logo and its effects. */
  look: VideoLook
  hasBrand: boolean
  onChange: (effects: AngleEffects) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState<Example | null>(null)
  const [caption, setCaption] = useState<string>('Tap ▶ on an effect to watch it.')
  const [ownFrame, setOwnFrame] = useState<ImageBitmap | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  const plays = useRef(0)
  const frame = useRef<number>(0)
  const standIn = useRef<OffscreenCanvas | null>(null)
  const logoBitmap = useRef<ImageBitmap | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const effects = look.effects
  const hasLogo = look.logo.image !== null

  useEffect(() => {
    let cancelled = false
    if (look.logo.image) {
      void createImageBitmap(look.logo.image).then((b) => {
        if (cancelled) b.close()
        else logoBitmap.current = b
      })
    } else logoBitmap.current = null
    return () => {
      cancelled = true
    }
  }, [look.logo.image])

  const background = (): CanvasImageSource => {
    if (ownFrame) return ownFrame
    standIn.current ??= standInFrame()
    return standIn.current
  }

  /** Draws the example at `t` seconds. */
  const draw = (script: Script, plan: MotionPlan, t: number) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    let index = 0
    let start = 0
    while (index < script.segments.length - 1 && t >= start + script.segments[index]) {
      start += script.segments[index]
      index++
    }
    const framing = framingAt(plan, index, t, script.brandAt)
    const place = placeFrame(framing, WIDTH, HEIGHT)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.drawImage(background(), place.x, place.y, place.width, place.height)

    // The headline and logo, steady on top - exactly as in a video.
    if (look.headline.text.trim() && t < look.headline.seconds) {
      const headline = layoutHeadline(ctx, WIDTH, HEIGHT, look.headline)
      if (headline) drawHeadline(ctx, headline)
    }
    const logo = logoBitmap.current
    const logoAt = script.brandAt[0]
    if (logo && logoAt !== undefined && t >= logoAt && t < logoAt + look.logo.seconds) {
      const layout = layoutLogo(WIDTH, HEIGHT, logo, look.logo)
      if (script.effects.logoPop) drawPoppedLogo(ctx, logo, layout, logoPop(t - logoAt, look.logo.seconds - (t - logoAt)))
      else drawLogo(ctx, logo, layout)
    }

    // What is happening, in words - only in the example, never in a video.
    const label =
      script.segments.length > 1 && index > 0 && t - start < 0.35
        ? 'cut'
        : logoAt !== undefined && t >= logoAt && t < logoAt + 0.8
          ? `you say "${look.brandWords[0] ?? 'the brand'}"`
          : null
    if (label) {
      ctx.save()
      ctx.font = '600 26px "Helvetica Neue", Helvetica, Arial, sans-serif'
      const w = ctx.measureText(label).width + 28
      ctx.fillStyle = 'rgb(0 0 0 / 0.6)'
      ctx.beginPath()
      ctx.roundRect(WIDTH / 2 - w / 2, HEIGHT * 0.84, w, 44, 22)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.fillText(label, WIDTH / 2, HEIGHT * 0.84 + 30)
      ctx.restore()
    }
  }

  const play = (example: Example, next: AngleEffects = effects) => {
    cancelAnimationFrame(frame.current)
    const script = scriptFor(example, next)
    const plan = examplePlan(script, plays.current++)
    const duration = script.segments.reduce((a, b) => a + b, 0)
    const level =
      example === 'all' || example === 'logoPop'
        ? ''
        : ` - ${script.effects[example] === 'strong' ? 'Strong' : 'Subtle'}`
    setPlaying(example)
    setCaption(`${NAMES[example]}${level}`)
    const began = performance.now()
    const tick = () => {
      const t = (performance.now() - began) / 1000
      draw(script, plan, Math.min(t, duration))
      if (t < duration) frame.current = requestAnimationFrame(tick)
      else setPlaying(null)
    }
    tick()
  }

  // A still of the frame to start with, and again when it changes.
  useEffect(() => {
    if (playing) return
    draw({ segments: [1], brandAt: [], effects: NO_EFFECTS }, planMotion(NO_EFFECTS, [1], 'still'), 0)
  }, [ownFrame, look.headline])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const set = (fields: Partial<AngleEffects>, example: Example) => {
    const next = { ...effects, ...fields }
    onChange(next)
    const turnedOn = Object.values(fields).some((v) => v !== 'off' && v !== false)
    if (turnedOn) play(example, next)
  }

  const anyOn = effects.cutPunch !== 'off' || effects.hookPush !== 'off' || effects.brandHit !== 'off' || effects.logoPop

  return (
    <div className="effects">
      <div className="hint">
        All off until you turn one on - play its example first. Every video varies a little; the headline and logo
        stay steady.
      </div>

      <div className="preview">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="Effect example" />
        <div className="hint example-caption">{playing ? `Playing: ${caption}` : caption}</div>
        <input
          ref={picker}
          type="file"
          accept="video/*,.mov,.mp4,.m4v"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setFrameError(null)
            frameFrom(file)
              .then((bitmap) => {
                setOwnFrame((old) => {
                  old?.close()
                  return bitmap
                })
              })
              .catch((err: unknown) => setFrameError(err instanceof Error ? err.message : String(err)))
          }}
        />
        <button type="button" className="linkbtn" onClick={() => picker.current?.click()}>
          {ownFrame ? 'Use a different video' : 'Show the examples on one of my videos'}
        </button>
        {frameError ? <div className="error">{frameError}</div> : null}
      </div>

      <EffectRow
        name={NAMES.cutPunch}
        hint="Each time a pause is cut, the shot jumps a little closer, or back out."
        onExample={() => play('cutPunch')}
      >
        <Levels value={effects.cutPunch} onChange={(cutPunch) => set({ cutPunch }, 'cutPunch')} />
      </EffectRow>

      <EffectRow
        name={NAMES.hookPush}
        hint="A slow push toward you over the first seconds, under the headline."
        onExample={() => play('hookPush')}
      >
        <Levels value={effects.hookPush} onChange={(hookPush) => set({ hookPush }, 'hookPush')} />
      </EffectRow>

      <EffectRow
        name={NAMES.brandHit}
        hint={
          hasBrand
            ? `A quick punch-in when you say "${look.brandWords[0]}" - with the logo and its sound.`
            : 'Needs the brand name - type it in the campaign first.'
        }
        onExample={() => play('brandHit')}
      >
        <Levels value={effects.brandHit} disabled={!hasBrand} onChange={(brandHit) => set({ brandHit }, 'brandHit')} />
      </EffectRow>

      <EffectRow
        name={NAMES.logoPop}
        hint={
          hasLogo || look.pictures.length > 0
            ? 'The logo and pictures spring in and fade out, instead of just appearing.'
            : 'Needs a logo or a picture in this angle.'
        }
        onExample={() => play('logoPop')}
      >
        <div className="seg">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              type="button"
              disabled={!hasLogo && look.pictures.length === 0}
              className={effects.logoPop === on ? 'active' : ''}
              onClick={() => set({ logoPop: on }, 'logoPop')}
            >
              {on ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      </EffectRow>

      {anyOn ? (
        <div>
          <button type="button" className="btn" onClick={() => play('all')}>
            ▶ Watch them all together
          </button>
        </div>
      ) : null}
    </div>
  )
}

function EffectRow({
  name,
  hint,
  onExample,
  children,
}: {
  name: string
  hint: string
  onExample: () => void
  children: ReactNode
}) {
  return (
    <div className="effect">
      <div className="row">
        <span className="label">{name}</span>
        <button type="button" className="linkbtn" onClick={onExample}>
          ▶ Example
        </button>
      </div>
      <div className="hint">{hint}</div>
      {children}
    </div>
  )
}

function Levels({
  value,
  disabled = false,
  onChange,
}: {
  value: EffectLevel
  disabled?: boolean
  onChange: (value: EffectLevel) => void
}) {
  return (
    <div className="seg">
      {LEVELS.map((l) => (
        <button
          key={l.value}
          type="button"
          disabled={disabled && l.value !== 'off'}
          className={value === l.value ? 'active' : ''}
          onClick={() => onChange(l.value)}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
