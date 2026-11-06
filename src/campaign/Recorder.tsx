// Recording in the Cutter, like TikTok's camera: the phone's camera full
// screen, tap the big button to record and again to stop, double tap
// anywhere to flip between the front and back camera - mid-recording too,
// without a break: the camera's picture is drawn into what is recorded, so
// only the picture changes, the sound runs on - a light for selfie videos. As in TikTok (his ask, 2026-11-03): the button records and pauses,
// again and again, each part a segment on the bar along the top; ⌫ takes the
// last part off (a stutter) and nothing else; ✓ finishes - the parts joined
// into one video, which opens in the timeline editor once it is cut. His ask
// (2026-11-03): iPhone's own "Take Video" in the picker records small and
// pixelated; this asks the camera for the most it gives a web page - 4K, or
// 1080p - at a high bitrate, and says what it got.
//
// The light: on the back camera, the phone's flashlight where Safari allows
// it (torch); on the front, the screen around the picture goes white, the
// way TikTok's selfie light works (a page can't turn the brightness up - his
// own brightness all the way up makes it brightest).
//
// What he records goes on exactly as a picked video does: one take is one
// video, sorted into its campaign; several are joined first (addJoined).

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'

import { report } from '../report'
import { describeClip } from './clipCheck'

type Facing = 'user' | 'environment'

/** Bitrate asked of the recorder by how many pixels the camera gives: the
 *  video is made again by the Cutter after, so this only has to keep all the
 *  detail there is (an iPhone's own 1080p is about 16 Mbps, 4K about 45). */
export function bitrateFor(width: number, height: number, fps = 30): number {
  const pixels = width * height
  const base = pixels >= 3840 * 2160 * 0.9 ? 45_000_000 : pixels >= 2560 * 1440 * 0.9 ? 28_000_000 : 20_000_000
  // Twice the frames: more bits, so none is spent thinner (he pays for the
  // space gladly - 2026-11-06: "Don't lower the quality").
  return fps > 40 ? Math.round(base * 1.6) : base
}

/** The best kind of file this phone records: an iPhone's MP4 first. */
function recordingType(): string {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
  if (typeof MediaRecorder === 'undefined') return ''
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
}

/** "REC 2026-11-03 14-22-05.mp4" - a name that sorts by when it was filmed. */
export function takeName(at: Date, type: string, n = 0): string {
  const pad = (x: number) => String(x).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
  return `REC ${stamp}${n > 0 ? ` (${n + 1})` : ''}.${type.includes('webm') ? 'webm' : 'mp4'}`
}

/** Safari's and Chrome's per-frame callback on a video element. */
interface FrameCallbacks {
  requestVideoFrameCallback(callback: () => void): number
  cancelVideoFrameCallback(handle: number): void
}

/** What the camera stream asks for: as big as the camera goes, portrait. */
export function cameraConstraints(facing: Facing): MediaStreamConstraints {
  return {
    video: {
      facingMode: { ideal: facing },
      // Full HD: exactly the size the recording is made at. Asked for as 4K,
      // the phone shrank four times the pixels onto the recording every
      // frame, and long takes went "super laggy" (his words, 2026-11-04) -
      // for no sharper a picture, the video being 1080x1920 either way.
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // 60 frames a second where the camera has it (his ask, 2026-11-06:
      // "It needs to be 60 FPS. Why is it 30 FPS?"); the video made from it
      // keeps the same rate (quality.frameRateOf), which every platform takes.
      frameRate: { ideal: 60 },
    },
    // His voice as the mic hears it: the Cutter does its own clean-up.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  }
}

/** The size every recording is made at: portrait 1080p - the size every
 *  finished video is made at too, so nothing is lost. */
export const RECORD_WIDTH = 1080
export const RECORD_HEIGHT = 1920

/** Where a camera frame `w` x `h` is drawn to fill the recording (cropped to fit). */
export function coverBox(w: number, h: number, width = RECORD_WIDTH, height = RECORD_HEIGHT): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(width / w, height / h)
  return { x: (width - w * scale) / 2, y: (height - h * scale) / 2, w: w * scale, h: h * scale }
}

/** Where a new clip starts in the finished recording, in seconds: each flip
 *  of the camera while recording and each part after a pause - for a
 *  reaction's texts, one per clip (his ask, 2026-11-06). Marks closer than
 *  half a second to the start, the end or each other are one. */
export function clipStarts(marksMs: readonly number[], totalMs: number): number[] {
  const out: number[] = []
  for (const ms of [...marksMs].sort((a, b) => a - b)) {
    if (ms < 500 || ms > totalMs - 500) continue
    if (out.length > 0 && ms - out[out.length - 1] * 1000 < 500) continue
    out.push(Math.round(ms) / 1000)
  }
  return out
}

/** The red ring around the record button: a minute around, like a clock -
 *  and round again after a minute (nothing stops at a minute). */
export function ringFraction(totalMs: number): number {
  return totalMs <= 0 ? 0 : (totalMs % 60_000) / 60_000 || 1
}

/** How far the camera can be zoomed by pinching: the camera's own zoom when
 *  it has one, else the picture itself, up to 4 times. */
const MAX_DIGITAL_ZOOM = 4

export function Recorder({ onDone, onCancel }: { onDone: (files: File[], clipStarts: number[]) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  /** The camera now - only its picture; switched on a flip. */
  const camera = useRef<MediaStream | null>(null)
  /** The microphone, open the whole time: a flip never touches the sound. */
  const mic = useRef<MediaStream | null>(null)
  /** What is recorded: the camera's picture drawn here, frame by frame, so
   *  the recording goes on while the camera behind it changes (his ask,
   *  2026-11-03: flipping paused it and made "mini cuts"). */
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const takes = useRef<File[]>([])
  const [facing, setFacing] = useState<Facing>('user')
  const [problem, setProblem] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  /** Each take's length (ms), in order: the bar along the top, and Delete
   *  taking the last one off. */
  const lengths = useRef<number[]>([])
  const [takeCount, setTakeCount] = useState(0)
  const [light, setLight] = useState(false)
  const [torch, setTorch] = useState(false)
  const [quality, setQuality] = useState<string | null>(null)
  /** Where each new clip starts, in ms of the finished recording. */
  const marks = useRef<number[]>([])
  const recordingRef = useRef(false)
  const startedRef = useRef(0)
  /** Delete pressed: asked first (his ask, 2026-11-06). */
  const [askDelete, setAskDelete] = useState(false)
  /** Pinch zoom: the camera's own (hardware) when it has it, else the picture. */
  const zoom = useRef(1)
  const [zoomShown, setZoomShown] = useState<number | null>(null)
  const hardZoom = useRef<{ min: number; max: number } | null>(null)
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)
  const lastTap = useRef(0)
  const wake = useRef<{ release: () => Promise<void> } | null>(null)
  const type = useRef(recordingType())
  /** A flip is opening the other camera: the recording holds the last picture. */
  const switching = useRef(false)
  /** The camera now in the picture faces him: the recording is mirrored,
   *  as he sees himself on screen and as TikTok keeps it (his ask,
   *  2026-11-03). Set only once that camera's picture is showing. */
  const mirrored = useRef(false)

  const stopCamera = () => {
    for (const track of camera.current?.getTracks() ?? []) track.stop()
    camera.current = null
  }
  const stopAll = () => {
    stopCamera()
    for (const track of mic.current?.getTracks() ?? []) track.stop()
    mic.current = null
  }

  /** Opens the camera that faces `which`, at the most it gives - and the
   *  microphone, once. */
  const open = useCallback(async (which: Facing) => {
    setProblem(null)
    try {
      const { video: wanted, audio } = cameraConstraints(which)
      // An iPhone runs one camera at a time: the old one goes first.
      switching.current = true
      stopCamera()
      const next = await navigator.mediaDevices.getUserMedia({ video: wanted })
      camera.current = next
      if (!mic.current) mic.current = await navigator.mediaDevices.getUserMedia({ audio })
      const v = video.current
      if (v) {
        v.srcObject = next
        await v.play().catch(() => {})
      }
      arm()
      mirrored.current = which === 'user'
      switching.current = false
      // A flip while recording starts a new clip here.
      if (recordingRef.current) marks.current.push(lengths.current.reduce((a, b) => a + b, 0) + (Date.now() - startedRef.current))
      // A new camera starts unzoomed.
      zoom.current = 1
      applyZoom()
      const track = next.getVideoTracks()[0]
      const settings = track?.getSettings() ?? {}
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number } }
      setTorch(Boolean(caps.torch))
      hardZoom.current = caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null
      const w = settings.width ?? 0
      const h = settings.height ?? 0
      const fps = Math.round(settings.frameRate ?? 30)
      setQuality(`${Math.min(w, h)}×${Math.max(w, h)} · ${fps} fps`)
      report({ kind: 'check', phase: 'record', message: `camera ${which}: ${w}x${h} @ ${fps} fps, recording ${type.current || 'none'} at ${RECORD_WIDTH}x${RECORD_HEIGHT}, max ${caps.width?.max ?? '?'}x${caps.height?.max ?? '?'}` })
    } catch (error) {
      switching.current = false
      const name = error instanceof DOMException ? error.name : ''
      setProblem(
        name === 'NotAllowedError'
          ? 'The Cutter may not use the camera. Allow it: iPhone Settings, Safari (or the Cutter), Camera, Allow - then try again.'
          : `The camera could not be opened (${error instanceof Error ? error.message : String(error)}).`,
      )
    }
  }, [])

  useEffect(() => {
    void open(facing)
    // Only when he flips; open() itself never changes.
  }, [facing]) // eslint-disable-line react-hooks/exhaustive-deps

  // The camera's picture into the recording: each new camera frame drawn
  // once, as it arrives (requestVideoFrameCallback), and the recording takes
  // a frame each time one is drawn. It used to draw at the screen's rate and
  // take frames on a clock of its own: the two drifted against each other,
  // frames came out twice or not at all, and the take looked laggy. While a
  // flip opens the other camera, the last picture stays - never a black frame.
  const drawn = useRef({ frames: 0, slow: 0, since: 0 })
  const drawFrame = useCallback(() => {
    const ctx = context.current
    const v = video.current
    if (!ctx || !v || switching.current || v.readyState < 2 || v.videoWidth === 0) return
    const began = performance.now()
    const cover = coverBox(v.videoWidth, v.videoHeight)
    // Zoomed with the picture itself (no camera zoom): drawn bigger around the middle.
    const z = hardZoom.current ? 1 : zoom.current
    const box = { w: cover.w * z, h: cover.h * z, x: (RECORD_WIDTH - cover.w * z) / 2, y: (RECORD_HEIGHT - cover.h * z) / 2 }
    if (mirrored.current) ctx.setTransform(-1, 0, 0, 1, RECORD_WIDTH, 0)
    ctx.drawImage(v, box.x, box.y, box.w, box.h)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    drawn.current.frames++
    if (performance.now() - began > 25) drawn.current.slow++
  }, [])
  /** The video element's own frame callback, re-armed after every frame and
   *  after each camera opens. */
  const armed = useRef<number | null>(null)
  const arm = useCallback(() => {
    const v = video.current as (HTMLVideoElement & FrameCallbacks) | null
    if (!v || typeof v.requestVideoFrameCallback !== 'function') return
    if (armed.current !== null) v.cancelVideoFrameCallback(armed.current)
    const onFrame = () => {
      drawFrame()
      armed.current = v.requestVideoFrameCallback(onFrame)
    }
    armed.current = v.requestVideoFrameCallback(onFrame)
  }, [drawFrame])

  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = RECORD_WIDTH
    c.height = RECORD_HEIGHT
    canvas.current = c
    context.current = c.getContext('2d')
    const v = video.current as (HTMLVideoElement & FrameCallbacks) | null
    if (v && typeof v.requestVideoFrameCallback === 'function') {
      arm()
      return () => {
        if (armed.current !== null) v.cancelVideoFrameCallback(armed.current)
        armed.current = null
      }
    }
    // An older phone without frame callbacks: drawn with the screen, as before.
    let frame = 0
    const loop = () => {
      drawFrame()
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [arm, drawFrame])

  useEffect(
    () => () => {
      recorder.current?.state === 'recording' && recorder.current.stop()
      stopAll()
      // Its memory back at once: the drawing canvas, and the camera's picture.
      if (canvas.current) {
        canvas.current.width = 0
        canvas.current.height = 0
      }
      context.current = null
      if (video.current) video.current.srcObject = null
      void wake.current?.release().catch(() => {})
    },
    [],
  )

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 250)
    return () => window.clearInterval(timer)
  }, [recording, startedAt])

  // The flashlight, on the back camera, when the light is on.
  useEffect(() => {
    const track = camera.current?.getVideoTracks()[0]
    if (!track || !torch) return
    void track.applyConstraints({ advanced: [{ torch: light && facing === 'environment' } as MediaTrackConstraintSet] }).catch(() => {})
  }, [light, torch, facing, quality])

  /** One part begins: the drawn picture and the microphone, recorded. */
  const start = () => {
    const c = canvas.current
    const sound = mic.current?.getAudioTracks()[0]
    if (!c || typeof MediaRecorder === 'undefined' || typeof c.captureStream !== 'function') {
      setProblem("This phone can't record in the page.")
      return
    }
    // A frame for each one drawn - one per camera frame - where frame
    // callbacks exist; else 30 a second.
    const byFrame = typeof (video.current as (HTMLVideoElement & Partial<FrameCallbacks>) | null)?.requestVideoFrameCallback === 'function'
    const picture = (byFrame ? c.captureStream() : c.captureStream(30)).getVideoTracks()[0]
    drawn.current = { frames: 0, slow: 0, since: performance.now() }
    const s = new MediaStream([picture, ...(sound ? [sound] : [])])
    chunks.current = []
    let r: MediaRecorder
    try {
      r = new MediaRecorder(s, {
        ...(type.current ? { mimeType: type.current } : {}),
        videoBitsPerSecond: bitrateFor(RECORD_WIDTH, RECORD_HEIGHT, camera.current?.getVideoTracks()[0]?.getSettings().frameRate ?? 30),
        audioBitsPerSecond: 192_000,
      })
    } catch (error) {
      picture.stop()
      setProblem(`Recording could not start (${error instanceof Error ? error.message : String(error)}).`)
      return
    }
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    const began = new Date()
    r.onstop = () => {
      picture.stop()
      // How smoothly it went, for when a take looks laggy.
      const secs = (performance.now() - drawn.current.since) / 1000
      if (secs > 3) {
        const settings = camera.current?.getVideoTracks()[0]?.getSettings() ?? {}
        report({
          kind: 'check',
          phase: 'record',
          message: `part ${secs.toFixed(1)} s: ${drawn.current.frames} frames drawn (${(drawn.current.frames / secs).toFixed(1)} a second, ${drawn.current.slow} slow), ${byFrame ? 'by camera frame' : 'by the clock'}, camera ${settings.width ?? '?'}x${settings.height ?? '?'}`,
        })
      }
      const kind = r.mimeType || type.current || 'video/mp4'
      const blob = new Blob(chunks.current, { type: kind.split(';')[0] })
      if (blob.size > 0) {
        // How evenly its frames came out, for when a take looks laggy.
        void describeClip('recording', blob)
          .then((line) => report({ kind: 'check', phase: 'record file', message: line }))
          .catch(() => {})
        takes.current.push(new File([blob], takeName(began, kind, takes.current.length), { type: blob.type, lastModified: began.getTime() }))
        lengths.current.push(Date.now() - began.getTime())
        setTakeCount(takes.current.length)
      }
    }
    r.start(1000)
    recorder.current = r
    // A part after a pause is a new clip.
    const before = lengths.current.reduce((a, b) => a + b, 0)
    if (before > 0) marks.current.push(before)
    recordingRef.current = true
    startedRef.current = Date.now()
    setStartedAt(Date.now())
    setElapsed(0)
    setRecording(true)
    void (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((lock) => {
        wake.current = lock
      })
      .catch(() => {})
  }

  /** The part ends; resolves once its file is kept. */
  const stop = () =>
    new Promise<void>((resolve) => {
      const r = recorder.current
      setRecording(false)
      recordingRef.current = false
      void wake.current?.release().catch(() => {})
      wake.current = null
      if (!r || r.state === 'inactive') {
        resolve()
        return
      }
      const kept = r.onstop
      r.onstop = (e) => {
        kept?.call(r, e)
        resolve()
      }
      r.stop()
    })

  /** Double tap: the other camera - while recording too, without a break:
   *  the recording goes on, only the picture changes. */
  const flip = () => setFacing((f) => (f === 'user' ? 'environment' : 'user'))

  const onTap = () => {
    const now = performance.now()
    if (now - lastTap.current < 300) {
      lastTap.current = 0
      flip()
    } else lastTap.current = now
  }

  const done = async () => {
    if (recording) await stop()
    stopAll()
    const total = lengths.current.reduce((a, b) => a + b, 0)
    if (takes.current.length > 0) onDone([...takes.current], clipStarts(marks.current, total))
    else onCancel()
  }

  /** The last part recorded taken off - a stutter - and nothing else, so it
   *  can be recorded again (TikTok's delete-last-segment). */
  const deleteLast = () => {
    setAskDelete(false)
    if (recording || takes.current.length === 0) return
    takes.current.pop()
    lengths.current.pop()
    // Its clips go with it.
    const left = lengths.current.reduce((a, b) => a + b, 0)
    marks.current = marks.current.filter((ms) => ms < left)
    setTakeCount(takes.current.length)
  }

  /** The zoom as it is now: the camera's own, or the picture's (drawn bigger
   *  in the recording, and the same on screen). */
  const applyZoom = () => {
    const hard = hardZoom.current
    const track = camera.current?.getVideoTracks()[0]
    if (hard && track) {
      const value = Math.min(hard.max, Math.max(hard.min, hard.min * zoom.current))
      void track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }).catch(() => {})
    }
    const v = video.current
    if (v) v.style.transform = `${mirrored.current ? 'scaleX(-1) ' : ''}${hard ? '' : `scale(${zoom.current})`}`.trim()
  }
  const zoomMax = () => (hardZoom.current ? Math.min(10, hardZoom.current.max / hardZoom.current.min) : MAX_DIGITAL_ZOOM)
  const between = (t: ReactTouchEvent['touches']) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const onTouchStart = (e: ReactTouchEvent) => {
    if (e.touches.length === 2) pinch.current = { distance: between(e.touches), zoom: zoom.current }
  }
  const onTouchMove = (e: ReactTouchEvent) => {
    const p = pinch.current
    if (!p || e.touches.length !== 2) return
    zoom.current = Math.min(zoomMax(), Math.max(1, p.zoom * (between(e.touches) / p.distance)))
    applyZoom()
    setZoomShown(zoom.current)
  }
  const onTouchEnd = (e: ReactTouchEvent) => {
    if (e.touches.length < 2 && pinch.current) {
      pinch.current = null
      // A pinch is not a tap: no flip from it.
      lastTap.current = 0
      window.setTimeout(() => setZoomShown(null), 900)
    }
  }

  const recorded = lengths.current.reduce((a, b) => a + b, 0)
  const seconds = Math.floor(((recording ? elapsed : 0) + recorded) / 1000)
  // The bar along the top: each part, the one recording growing; a minute
  // across, longer once the video is longer.
  const span = Math.max(60_000, recorded + (recording ? elapsed : 0))
  const parts = [...lengths.current, ...(recording ? [elapsed] : [])]
  const selfieLight = light && facing === 'user'

  return (
    <section className={`recorder${selfieLight ? ' lit' : ''}`} aria-label="Record a video">
      <div className="recorder-view" onClick={onTap} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <video ref={video} playsInline muted autoPlay className={facing === 'user' ? 'mirror' : ''} />
        {zoomShown !== null ? <span className="recorder-zoom">{zoomShown.toFixed(1)}×</span> : null}
        {problem ? <p className="recorder-problem">{problem}</p> : null}
      </div>

      <div className="recorder-segments" aria-hidden>
        {parts.map((ms, i) => (
          <span key={i} className={`recorder-segment${recording && i === parts.length - 1 ? ' live' : ''}`} style={{ width: `${(ms / span) * 100}%` }} />
        ))}
      </div>
      <div className="recorder-top">
        <button
          type="button"
          className="recorder-round"
          aria-label="Close"
          onClick={() => {
            if (takes.current.length > 0 && !window.confirm('Throw away what you recorded?')) return
            void stop().then(() => {
              stopAll()
              onCancel()
            })
          }}
        >
          ✕
        </button>
        <span className="recorder-info">
          {recording || takeCount > 0 ? (
            <span className={`recorder-time${recording ? '' : ' paused'}`}>
              <span className="recorder-dot" aria-hidden /> {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
          ) : (
            (quality ?? '')
          )}
        </span>
        <button
          type="button"
          className={`recorder-round${light ? ' on' : ''}`}
          aria-label={light ? 'Light off' : 'Light on'}
          aria-pressed={light}
          onClick={() => setLight((l) => !l)}
          disabled={facing === 'environment' && !torch}
        >
          ⚡︎
        </button>
      </div>
      <div className="recorder-side">
        <button type="button" className="recorder-round" aria-label="Flip camera" onClick={flip}>
          ⟲
        </button>
      </div>

      <div className="recorder-bottom">
        <button
          type="button"
          className="recorder-round recorder-delete"
          aria-label="Delete the last part"
          onClick={() => setAskDelete(true)}
          disabled={recording || takeCount === 0}
        >
          ⌫
        </button>
        <button
          type="button"
          className={`recorder-shutter${recording ? ' on' : ''}`}
          aria-label={recording ? 'Pause' : takeCount > 0 ? 'Record more' : 'Record'}
          onClick={() => (recording ? void stop() : start())}
          disabled={problem !== null && !recording}
        >
          {/* A minute around, like a clock, in red (TikTok's) - and round
              again after a minute: nothing stops at a minute. */}
          <svg className="recorder-ring" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="46" className="recorder-ring-track" />
            <circle
              cx="50"
              cy="50"
              r="46"
              className="recorder-ring-done"
              pathLength={1}
              strokeDasharray={`${ringFraction(recorded + (recording ? elapsed : 0))} 1`}
            />
          </svg>
          <span />
        </button>
        <button type="button" className="recorder-check" aria-label="Done - to the timeline editor" disabled={takeCount === 0 && !recording} onClick={() => void done()}>
          ✓
        </button>
      </div>
      {askDelete ? (
        <div className="recorder-ask" role="dialog" aria-label="Delete the last clip?">
          <p>Delete the last clip?</p>
          <div className="recorder-ask-buttons">
            <button type="button" className="btn" onClick={() => setAskDelete(false)}>
              Cancel
            </button>
            <button type="button" className="btn danger" onClick={deleteLast}>
              Delete
            </button>
          </div>
        </div>
      ) : null}
      <p className="recorder-hint">
        {takeCount > 0 && !recording ? 'Tap to record more · ⌫ takes off the last clip' : 'Double tap to flip · pinch to zoom'}
      </p>
    </section>
  )
}
