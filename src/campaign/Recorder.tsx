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

import { useCallback, useEffect, useRef, useState } from 'react'

import { report } from '../report'

type Facing = 'user' | 'environment'

/** Bitrate asked of the recorder by how many pixels the camera gives: the
 *  video is made again by the Cutter after, so this only has to keep all the
 *  detail there is (an iPhone's own 1080p is about 16 Mbps, 4K about 45). */
function bitrateFor(width: number, height: number): number {
  const pixels = width * height
  if (pixels >= 3840 * 2160 * 0.9) return 45_000_000
  if (pixels >= 2560 * 1440 * 0.9) return 28_000_000
  return 16_000_000
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

/** What the camera stream asks for: as big as the camera goes, portrait. */
export function cameraConstraints(facing: Facing): MediaStreamConstraints {
  return {
    video: {
      facingMode: { ideal: facing },
      // Asked for as 4K; the phone gives the most it can under that.
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30 },
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

export function Recorder({ onDone, onCancel }: { onDone: (files: File[]) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  /** The camera now - only its picture; switched on a flip. */
  const camera = useRef<MediaStream | null>(null)
  /** The microphone, open the whole time: a flip never touches the sound. */
  const mic = useRef<MediaStream | null>(null)
  /** What is recorded: the camera's picture drawn here, frame by frame, so
   *  the recording goes on while the camera behind it changes (his ask,
   *  2026-11-03: flipping paused it and made "mini cuts"). */
  const canvas = useRef<HTMLCanvasElement | null>(null)
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
  const lastTap = useRef(0)
  const wake = useRef<{ release: () => Promise<void> } | null>(null)
  const type = useRef(recordingType())
  /** A flip is opening the other camera: the recording holds the last picture. */
  const switching = useRef(false)

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
      switching.current = false
      const track = next.getVideoTracks()[0]
      const settings = track?.getSettings() ?? {}
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean }
      setTorch(Boolean(caps.torch))
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

  // The camera's picture into the recording, every frame the screen draws.
  // While a flip opens the other camera, the last picture stays - never a
  // black frame.
  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = RECORD_WIDTH
    c.height = RECORD_HEIGHT
    canvas.current = c
    const ctx = c.getContext('2d')
    let frame = 0
    const draw = () => {
      const v = video.current
      if (ctx && v && !switching.current && v.readyState >= 2 && v.videoWidth > 0) {
        const box = coverBox(v.videoWidth, v.videoHeight)
        ctx.drawImage(v, box.x, box.y, box.w, box.h)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(
    () => () => {
      recorder.current?.state === 'recording' && recorder.current.stop()
      stopAll()
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
    const picture = c.captureStream(30).getVideoTracks()[0]
    const s = new MediaStream([picture, ...(sound ? [sound] : [])])
    chunks.current = []
    let r: MediaRecorder
    try {
      r = new MediaRecorder(s, {
        ...(type.current ? { mimeType: type.current } : {}),
        videoBitsPerSecond: bitrateFor(RECORD_WIDTH, RECORD_HEIGHT),
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
      const kind = r.mimeType || type.current || 'video/mp4'
      const blob = new Blob(chunks.current, { type: kind.split(';')[0] })
      if (blob.size > 0) {
        takes.current.push(new File([blob], takeName(began, kind, takes.current.length), { type: blob.type, lastModified: began.getTime() }))
        lengths.current.push(Date.now() - began.getTime())
        setTakeCount(takes.current.length)
      }
    }
    r.start(1000)
    recorder.current = r
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
    if (takes.current.length > 0) onDone([...takes.current])
    else onCancel()
  }

  /** The last part recorded taken off - a stutter - and nothing else, so it
   *  can be recorded again (TikTok's delete-last-segment). */
  const deleteLast = () => {
    if (recording || takes.current.length === 0) return
    takes.current.pop()
    lengths.current.pop()
    setTakeCount(takes.current.length)
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
      <div className="recorder-view" onClick={onTap}>
        <video ref={video} playsInline muted autoPlay className={facing === 'user' ? 'mirror' : ''} />
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
          onClick={deleteLast}
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
          <span />
        </button>
        <button type="button" className="recorder-check" aria-label="Done - to the timeline editor" disabled={takeCount === 0 && !recording} onClick={() => void done()}>
          ✓
        </button>
      </div>
      <p className="recorder-hint">
        {takeCount > 0 && !recording ? 'Tap to record more · ⌫ takes off the last part' : 'Double tap to flip the camera'}
      </p>
    </section>
  )
}
