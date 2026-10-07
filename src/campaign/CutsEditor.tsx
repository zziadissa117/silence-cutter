// Fixing a video's cuts by hand before it is made: a timeline of the whole
// recording with the kept parts lit and the cut-out parts dimmed, the words
// he says written along it so the bad bit is easy to find, and a playhead
// fixed in the middle - scroll the timeline to move through the video, the
// way every phone editor works.
//
// Split, delete, bring a cut-out part back, and drag a part's edges to trim
// it. Pinch (or - and +) zooms from the whole take down to half a
// millisecond a pixel, with marks along the top to read the time by, and
// the timer shows milliseconds. Edges snap to the gaps between words only
// within a finger's width, so zoomed in a cut lands exactly where he puts
// it. Play runs only the kept parts, exactly as the video will be. Nothing
// is made until he is done, and the recording itself is never changed - see
// cuts.ts.
//
// Smooth on a phone because little moves while he scrolls: the timeline is
// drawn once and only redrawn when the cuts or the zoom change; the timer
// and buttons follow at most once a frame; and the video is asked for one
// frame at a time - always the latest place - instead of a new jump on every
// scroll event, which is what left the phone's decoder behind.

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { totalDuration, type Range } from '../media/silenceMath'
import { cutOut, putBack, type CutCheck } from './noiseCuts'
import type { CaptionWord } from './captions'
import {
  formatPrecise,
  markLabel,
  outputTime,
  partAt,
  playableFrom,
  removeAt,
  restoreAt,
  rulerSteps,
  snapTo,
  splitAt,
  trimPart,
} from './cuts'
import { ChevronLeft, PauseIcon, PlayIcon } from './icons'
import type { BankPicture } from './look'
import {
  DURATIONS,
  POSITIONS,
  SIZES,
  newPictureId,
  previewStyle,
  type ManualPicture,
} from './manualPictures'

/** How much timeline a second takes at first: room enough to read the words. */
const START_PX = 110
/** The zoom steps of - and +; pinching goes anywhere between the ends. */
const ZOOMS = [40, 110, 300, 800, 2000]
const MIN_PX = ZOOMS[0]
const MAX_PX = ZOOMS[ZOOMS.length - 1]
/** Lines the words are laid on, so fast speech doesn't pile them up. */
const WORD_LINES = 3
/** Roughly how wide a letter of the labels is. */
const LETTER_PX = 7.5
/** How near a word's edge a trim has to come to land on it: a fingertip. */
const SNAP_PX = 10
/** Where the parts start below the time marks, how tall they are, and where
 *  the words start under them. */
const PART_TOP = 22
const PART_H = 64
const WORD_TOP = PART_TOP + PART_H + 8

const clampPx = (px: number) => Math.min(MAX_PX, Math.max(MIN_PX, px))

/** Which line each word goes on: the first where it clears the word before
 *  it on that line, or the one that ends earliest when none does. */
function wordLines(words: readonly CaptionWord[], px: number): number[] {
  const ends = Array.from({ length: WORD_LINES }, () => -Infinity)
  return words.map((w) => {
    const left = w.start * px
    let line = ends.findIndex((end) => end + 6 <= left)
    if (line < 0) line = ends.indexOf(Math.min(...ends))
    ends[line] = left + w.text.length * LETTER_PX
    return line
  })
}

/** The kept parts and the words: redrawn only when the cuts, the zoom or
 *  the selected part change - never just because he scrolled. */
const Track = memo(function Track({
  keep,
  px,
  selected,
  words,
  checks,
  peaks,
  duration,
  focus,
  onFlag,
  onSelect,
  onHandleDown,
}: {
  keep: Range[]
  px: number
  selected: number | null
  words: CaptionWord[]
  checks: CutCheck[]
  peaks: number[] | undefined
  duration: number
  focus: number | null
  onFlag: (i: number) => void
  onSelect: (i: number | null) => void
  onHandleDown: (i: number, edge: 'start' | 'end', down: ReactPointerEvent<HTMLSpanElement>) => void
}) {
  const lines = useMemo(() => wordLines(words, px), [words, px])
  const wave = useMemo(() => {
    if (!peaks || peaks.length === 0) return null
    // One bar per tenth of a second, mirrored about the middle, as a single path.
    return peaks.map((v, i) => `M${i} ${50 - v * 48}h1v${Math.max(2, v * 96)}h-1z`).join('')
  }, [peaks])
  return (
    <>
      {wave ? (
        <svg
          className="cuts-wave"
          aria-hidden
          style={{ left: 0, top: PART_TOP, width: duration * px, height: PART_H }}
          viewBox={`0 0 ${peaks!.length} 100`}
          preserveAspectRatio="none"
        >
          <path d={wave} />
        </svg>
      ) : null}
      {keep.map((part, i) => (
        <div
          // By place, not by times: a part being trimmed keeps its element, and
          // with it the finger on its handle.
          key={i}
          className={`cuts-part${selected === i ? ' on' : ''}`}
          style={{ left: part.start * px, width: (part.end - part.start) * px }}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(i)
          }}
        >
          {selected === i ? (
            <>
              <span className="cuts-handle start" aria-label="Trim the start" onPointerDown={(e) => onHandleDown(i, 'start', e)} />
              <span className="cuts-handle end" aria-label="Trim the end" onPointerDown={(e) => onHandleDown(i, 'end', e)} />
            </>
          ) : null}
        </div>
      ))}
      {checks.map((c, i) => {
        const isCut = partAt(keep, (c.start + c.end) / 2) < 0
        return (
          <button
            key={`flag-${i}`}
            type="button"
            aria-label={`Check at ${formatPrecise(c.start)}`}
            className={`cuts-flag ${c.kind}${isCut ? ' cut' : ' back'}${focus === i ? ' on' : ''}`}
            style={{ left: c.start * px, width: Math.max(14, (c.end - c.start) * px), top: PART_TOP - 8, height: PART_H + 16 }}
            onClick={(e) => {
              e.stopPropagation()
              onFlag(i)
            }}
          >
            {c.kind === 'noise' ? '' : '?'}
          </button>
        )
      })}
      {words.map((w, i) => (
        <span
          key={`${w.start}-${i}`}
          className={`cuts-word${partAt(keep, w.start + 0.05) < 0 ? ' gone' : ''}`}
          style={{ left: w.start * px, top: WORD_TOP + lines[i] * 18 }}
        >
          {w.text}
        </span>
      ))}
    </>
  )
})

/** The time marks along the top, only around what is on screen: zoomed all
 *  the way in, the whole take would be tens of thousands of them. */
const Marks = memo(function Marks({ px, from, to }: { px: number; from: number; to: number }) {
  const { major, minor } = rulerSteps(px)
  const every = Math.round(major / minor)
  const marks: { n: number; major: boolean }[] = []
  for (let n = Math.max(0, Math.ceil(from / minor)); n <= Math.floor(to / minor); n++) marks.push({ n, major: n % every === 0 })
  return (
    <>
      {marks.map(({ n, major: isMajor }) => (
        <span key={n} className={`cuts-mark${isMajor ? ' major' : ''}`} style={{ left: n * minor * px }}>
          {isMajor ? <span className="cuts-mark-label">{markLabel(n * minor, major)}</span> : null}
        </span>
      ))}
    </>
  )
})

const KIND_TEXT: Record<CutCheck['kind'], string> = {
  noise: 'Short noise',
  'maybe-word': 'Might be a quiet word',
  'long-sound': 'Long sound, no words heard',
}

/** One sound to check: what it is, where, how long and loud, and what to do. */
function CheckRow({
  check,
  isCut,
  focused,
  onGo,
  onListen,
  onPutBack,
  onCutIt,
}: {
  check: CutCheck
  isCut: boolean
  focused: boolean
  onGo: () => void
  onListen: () => void
  onPutBack: () => void
  onCutIt: () => void
}) {
  const length = (check.end - check.start).toFixed(1)
  return (
    <div className={`cuts-check ${check.kind}${focused ? ' on' : ''}`}>
      <button type="button" className="cuts-check-main" onClick={onGo}>
        <span className="cuts-check-title">
          {KIND_TEXT[check.kind]} · {isCut ? 'cut' : 'in the video'}
        </span>
        <span className="hint">
          at {formatPrecise(check.start)} · {length}s{check.peakDb !== undefined ? ` · ${check.peakDb} dB` : ''}
        </span>
      </button>
      <button type="button" className="btn small" onClick={onListen}>
        Listen
      </button>
      {isCut ? (
        <button type="button" className="btn small primary" onClick={onPutBack}>
          Put it back
        </button>
      ) : (
        <button type="button" className="btn small" onClick={onCutIt}>
          Cut it
        </button>
      )}
    </div>
  )
}

export function CutsEditor({
  name,
  file,
  missing = false,
  duration,
  initial,
  words,
  checks = [],
  peaks,
  noiseNote,
  overlays: initialOverlays = [],
  bank = [],
  defaults,
  loadImage,
  onDone,
  onCaptions,
  onCancel,
}: {
  name: string
  /** The recording, or null while it is being fetched from storage. */
  file: Blob | null
  missing?: boolean
  /** The recording's length, in seconds. */
  duration: number
  initial: Range[]
  /** What he says, for finding the bad bit and for the edges to snap to. */
  words: CaptionWord[]
  /** Sounds that were cut (or left) that are worth a listen - see noiseCuts.ts. */
  checks?: CutCheck[]
  /** The sound's loudness over the recording, for drawing under the timeline. */
  peaks?: number[]
  noiseNote?: string
  /** Pictures already put on this video by hand. */
  overlays?: ManualPicture[]
  /** The picture bank, to pick from. */
  bank?: BankPicture[]
  /** Where and how big a new picture starts: the angle's bank placement. */
  defaults?: { position: ManualPicture['position']; widthPct: number; seconds: number }
  /** The image of a picture picked from the phone, from storage. */
  loadImage?: (picture: ManualPicture) => Promise<Blob | null>
  onDone: (keep: Range[], overlays: ManualPicture[], newFiles: Map<string, Blob>) => void
  /** Keeps the cuts as they are, like Done, and goes on to the captions.
   *  Absent when captions are off. */
  onCaptions?: (keep: Range[], overlays: ManualPicture[], newFiles: Map<string, Blob>) => void
  onCancel: () => void
}) {
  const [keep, setKeep] = useState(initial)
  const [history, setHistory] = useState<Range[][]>([])
  const [t, setT] = useState(initial[0]?.start ?? 0)
  const [px, setPx] = useState(START_PX)
  const [selected, setSelected] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [aspect, setAspect] = useState(9 / 16)
  const [url, setUrl] = useState<string | null>(null)
  const [viewWidth, setViewWidth] = useState(400)
  const [focus, setFocus] = useState<number | null>(null)
  const [overlays, setOverlays] = useState<ManualPicture[]>(initialOverlays)
  const [picking, setPicking] = useState(false)
  const [selectedPic, setSelectedPic] = useState<string | null>(null)
  const [picNote, setPicNote] = useState<string | null>(null)
  // Pictures picked from the phone in this visit, kept until he is done.
  const newFiles = useRef(new Map<string, Blob>())
  // Object URLs for showing pictures: the bank's and the video's own.
  const [urls, setUrls] = useState<Record<string, string>>({})
  const made = useRef<string[]>([])
  const video = useRef<HTMLVideoElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const phonePicker = useRef<HTMLInputElement>(null)
  const notePanel = useRef<HTMLParagraphElement>(null)
  const picPanel = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const keepRef = useRef(keep)
  keepRef.current = keep
  const pxRef = useRef(px)
  pxRef.current = px
  const tRef = useRef(t)
  const playingRef = useRef(false)

  useEffect(() => {
    if (!file) return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // Opened from a row lower down the list, the page would still be scrolled
  // there - the top of the timeline tucked under the video. From the top.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    const s = strip.current
    if (!s) return
    const measure = () => setViewWidth(s.clientWidth || 400)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const edges = useMemo(() => words.flatMap((w) => [w.start, w.end]), [words])
  const inPart = partAt(keep, t)
  const total = totalDuration(keep)

  // --- The video: one frame asked for at a time, always the latest place.
  const seeking = useRef({ busy: false, want: null as number | null, since: 0 })
  const pumpSeek = useCallback(() => {
    const v = video.current
    const s = seeking.current
    // A seek the player never finished answering is given up on.
    if (s.busy && performance.now() - s.since > 1000) s.busy = false
    if (!v || v.readyState < 1 || s.busy || s.want === null) return
    const to = Math.min(Math.max(0, s.want), Math.max(0, (v.duration || duration) - 0.001))
    s.want = null
    if (Math.abs(v.currentTime - to) < 0.0005) return
    s.busy = true
    s.since = performance.now()
    v.currentTime = to
  }, [duration])
  const seek = useCallback(
    (to: number) => {
      seeking.current.want = to
      pumpSeek()
    },
    [pumpSeek],
  )

  // --- The timer and buttons: at most once a frame while he scrolls.
  const showTime = useRef(0)
  const followTime = useCallback((to: number) => {
    tRef.current = to
    if (showTime.current) return
    showTime.current = requestAnimationFrame(() => {
      showTime.current = 0
      setT(tRef.current)
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(showTime.current), [])

  /** Puts `to` under the playhead by scrolling the timeline there. */
  const scrollTo = useCallback((to: number) => {
    const s = strip.current
    if (s) s.scrollLeft = to * pxRef.current
  }, [])

  // Where the timeline starts: the first kept part under the playhead.
  useEffect(() => {
    scrollTo(initial[0]?.start ?? 0)
  }, [scrollTo, initial])

  // Zooming keeps the moment under the playhead where it is.
  useLayoutEffect(() => {
    scrollTo(tRef.current)
  }, [px, scrollTo])

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current)
    video.current?.pause()
    playingRef.current = false
    setPlaying(false)
    setT(tRef.current)
  }, [])

  const onScroll = () => {
    // Following playback: the page moved it, not his finger.
    if (playingRef.current) return
    const s = strip.current
    if (!s) return
    const to = Math.min(duration, Math.max(0, s.scrollLeft / pxRef.current))
    followTime(to)
    seek(to)
  }

  // Images to show: bank pictures from the bank, the video's own from storage.
  useEffect(() => {
    let alive = true
    const want = overlays.filter((o) => !urls[o.id])
    if (want.length === 0) return
    void (async () => {
      const next: Record<string, string> = {}
      for (const o of want) {
        let blob: Blob | null | undefined = null
        if (o.source.kind === 'bank') {
          const id = o.source.pictureId
          blob = bank.find((b) => b.id === id)?.image
        } else blob = newFiles.current.get(o.id) ?? (await loadImage?.(o).catch(() => null))
        if (blob) {
          const url = URL.createObjectURL(blob)
          made.current.push(url)
          next[o.id] = url
        }
      }
      if (alive && Object.keys(next).length > 0) setUrls((u) => ({ ...u, ...next }))
    })()
    return () => {
      alive = false
    }
  }, [overlays, bank, loadImage, urls])
  useEffect(
    () => () => {
      for (const url of made.current) URL.revokeObjectURL(url)
    },
    [],
  )

  /** The bank's pictures as thumbnails, while choosing. */
  const [bankUrls, setBankUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!picking) return
    const next: Record<string, string> = {}
    for (const b of bank) next[b.id] = URL.createObjectURL(b.image)
    setBankUrls(next)
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url)
    }
  }, [picking, bank])

  const onCutPart = 'Move the playhead onto a part of the video that is kept - a picture can only come up there.'

  /** Opens the picture picker - or, with the playhead on a part that is cut
   *  out, says so at once, not after a picture has been chosen. */
  const togglePicker = () => {
    if (picking) {
      setPicking(false)
      return
    }
    if (partAt(keepRef.current, tRef.current) < 0) {
      setPicNote(onCutPart)
      return
    }
    setPicNote(null)
    setPicking(true)
  }

  // The picker (or the note) opens under the buttons, which on a phone is
  // below the bottom of the screen: + Picture looked as if it did nothing.
  // Brought up to just under the video held at the top.
  useEffect(() => {
    const panel = notePanel.current ?? picPanel.current
    if (!panel) return
    const held = top.current?.getBoundingClientRect().bottom ?? 0
    const box = panel.getBoundingClientRect()
    if (box.top >= held && box.bottom <= window.innerHeight) return
    window.scrollBy({ top: box.top - held - 12, behavior: 'smooth' })
  }, [picking, picNote])

  /** Puts a picture on the video at the playhead: it comes up there, so the
   *  playhead has to be on a part of the video that is kept. */
  const addPicture = (source: ManualPicture['source'], file?: Blob) => {
    if (partAt(keepRef.current, tRef.current) < 0) {
      setPicNote(onCutPart)
      return
    }
    const id = newPictureId()
    if (file) newFiles.current.set(id, file)
    const picture: ManualPicture = {
      id,
      source,
      at: Math.round(tRef.current * 100) / 100,
      seconds: defaults?.seconds ?? 3,
      position: defaults?.position ?? 'top-right',
      widthPct: defaults?.widthPct ?? 40,
    }
    setOverlays((list) => [...list, picture].sort((a, b) => a.at - b.at))
    setSelectedPic(id)
    setPicking(false)
    setPicNote(null)
  }
  const updatePicture = (id: string, patch: Partial<ManualPicture>) =>
    setOverlays((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)).sort((a, b) => a.at - b.at))
  const removePicture = (id: string) => {
    newFiles.current.delete(id)
    setOverlays((list) => list.filter((o) => o.id !== id))
    setSelectedPic((s) => (s === id ? null : s))
  }
  const goToPicture = (o: ManualPicture) => {
    stop()
    setSelectedPic(o.id)
    scrollTo(o.at)
    followTime(o.at)
    seek(o.at)
  }
  const showing = overlays.find((o) => t >= o.at && t < o.at + o.seconds)

  /** Plays just this stretch, with sound, a moment either side - the way to
   *  hear whether a cut sound was a word. */
  const listenTo = (range: Range) => {
    const v = video.current
    if (!v) return
    stop()
    seeking.current.want = null
    const from = Math.max(0, range.start - 0.4)
    const until = range.end + 0.4
    v.currentTime = from
    v.muted = false
    playingRef.current = true
    setPlaying(true)
    void v.play().catch(() => stop())
    const tick = () => {
      const now = v.currentTime
      scrollTo(now)
      followTime(now)
      if (now >= until || v.paused || v.ended) {
        v.pause()
        stop()
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  /** Takes the timeline to a check, so the playhead sits on it. */
  const goTo = (i: number) => {
    const c = checks[i]
    if (!c) return
    stop()
    setFocus(i)
    scrollTo(c.start)
    followTime(c.start)
    seek(c.start)
  }

  const change = (next: Range[]) => {
    setHistory((h) => [...h, keep])
    setKeep(next)
    setSelected(null)
  }

  const undo = () => {
    const previous = history[history.length - 1]
    if (!previous) return
    setHistory((h) => h.slice(0, -1))
    setKeep(previous)
    setSelected(null)
  }

  /** Plays the kept parts from the playhead, jumping every gap, the
   *  timeline following along. */
  const play = () => {
    const v = video.current
    if (!v) return
    if (playingRef.current) {
      stop()
      return
    }
    const from = playableFrom(keepRef.current, tRef.current) ?? keepRef.current[0]?.start ?? 0
    seeking.current.want = null
    v.currentTime = from
    v.muted = false
    playingRef.current = true
    setPlaying(true)
    void v.play().catch(() => stop())
    const tick = () => {
      const now = v.currentTime
      const next = playableFrom(keepRef.current, now)
      if (next === null) {
        stop()
        return
      }
      if (next > now + 0.02) v.currentTime = next
      scrollTo(next)
      followTime(next)
      if (v.paused || v.ended) {
        stop()
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  // A finger on the timeline takes over from playback.
  const takeOver = () => {
    if (playingRef.current) stop()
  }
  const takeOverRef = useRef(takeOver)
  takeOverRef.current = takeOver

  /** Drags one edge of the selected part. */
  const handleDown = useRef<(i: number, edge: 'start' | 'end', down: ReactPointerEvent<HTMLSpanElement>) => void>(() => {})
  handleDown.current = (i, edge, down) => {
    down.preventDefault()
    down.stopPropagation()
    takeOver()
    const handle = down.currentTarget
    handle.setPointerCapture(down.pointerId)
    const before = keepRef.current
    let last = before
    let drawn = 0
    const move = (event: PointerEvent) => {
      const box = ruler.current?.getBoundingClientRect()
      if (!box) return
      const scale = pxRef.current
      const to = snapTo((event.clientX - box.left) / scale, edges, SNAP_PX / scale)
      last = trimPart(before, i, edge, to, duration)
      if (!drawn) {
        drawn = requestAnimationFrame(() => {
          drawn = 0
          setKeep(last)
        })
      }
      seek(edge === 'start' ? last[i].start : last[i].end - 0.001)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      cancelAnimationFrame(drawn)
      setKeep(last)
      if (last !== before) setHistory((h) => [...h, before])
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const onHandleDown = useCallback(
    (i: number, edge: 'start' | 'end', down: ReactPointerEvent<HTMLSpanElement>) => handleDown.current(i, edge, down),
    [],
  )

  // Pinching the timeline zooms it, around the playhead. Safari says how far
  // the fingers have spread; the page itself is kept from zooming.
  useEffect(() => {
    const s = strip.current
    if (!s) return
    let from = pxRef.current
    let drawn = 0
    let wanted = from
    const start = (e: Event) => {
      e.preventDefault()
      takeOverRef.current()
      from = pxRef.current
    }
    const change = (e: Event) => {
      e.preventDefault()
      const scale = (e as Event & { scale?: number }).scale ?? 1
      wanted = clampPx(from * scale)
      if (!drawn) {
        drawn = requestAnimationFrame(() => {
          drawn = 0
          setPx(wanted)
        })
      }
    }
    s.addEventListener('gesturestart', start)
    s.addEventListener('gesturechange', change)
    s.addEventListener('gestureend', change)
    return () => {
      cancelAnimationFrame(drawn)
      s.removeEventListener('gesturestart', start)
      s.removeEventListener('gesturechange', change)
      s.removeEventListener('gestureend', change)
    }
  }, [])

  const zoom = (direction: 1 | -1) => {
    const next = direction > 0 ? ZOOMS.find((z) => z > px * 1.01) : [...ZOOMS].reverse().find((z) => z < px * 0.99)
    if (next) setPx(next)
  }

  // The marks around what is on screen, in steps of half a screen, so they
  // are redrawn only as he moves on - not on every scroll.
  const chunk = Math.max(viewWidth / 2 / px, 0.01)
  const around = Math.floor(t / chunk)
  const marksFrom = Math.max(0, (around - 2) * chunk)
  const marksTo = Math.min(duration, (around + 3) * chunk)

  return (
    <section className="screen cuts" aria-label={`Cuts for ${name}`}>
      <div className="review-top" ref={top}>
        <div className="review-head">
          <button type="button" className="back" onClick={onCancel}>
            <ChevronLeft /> Back
          </button>
          <div className="cuts-head-actions">
            {onCaptions ? (
              <button type="button" className="btn small" onClick={() => onCaptions(keep, overlays, newFiles.current)}>
                Captions
              </button>
            ) : null}
            <button type="button" className="btn small primary" onClick={() => onDone(keep, overlays, newFiles.current)}>
              Done
            </button>
          </div>
        </div>
        <div className="review-frame" style={{ aspectRatio: String(aspect) }} onClick={play}>
          {url ? (
            <video
              ref={video}
              src={url}
              playsInline
              muted
              preload="auto"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
                seek(tRef.current)
              }}
              onSeeked={() => {
                seeking.current.busy = false
                pumpSeek()
              }}
            />
          ) : (
            <div className="review-loading hint">
              {missing ? "This video isn't on the phone any more, so there's nothing to cut." : 'Opening the video…'}
            </div>
          )}
          {showing && urls[showing.id] ? (
            <img className="cuts-pic-preview" alt="" src={urls[showing.id]} style={previewStyle(showing.position, showing.widthPct)} />
          ) : null}
          {inPart < 0 ? <span className="cuts-out">Cut out</span> : null}
          {url ? (
            <span className="review-playing" aria-hidden>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </span>
          ) : null}
        </div>
      </div>

      <div className="cuts-strip-wrap">
        <div className="cuts-strip" ref={strip} onScroll={onScroll} onTouchStart={takeOver} onWheel={takeOver}>
          <div className="cuts-track">
            <div className="cuts-ruler" ref={ruler} style={{ width: duration * px }} onClick={() => setSelected(null)}>
              <Marks px={px} from={marksFrom} to={marksTo} />
              <Track
                keep={keep}
                px={px}
                selected={selected}
                words={words}
                checks={checks}
                peaks={peaks}
                duration={duration}
                focus={focus}
                onFlag={goTo}
                onSelect={setSelected}
                onHandleDown={onHandleDown}
              />
              {overlays.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-label={`Picture at ${formatPrecise(o.at)}`}
                  className={`cuts-pic${selectedPic === o.id ? ' on' : ''}`}
                  style={{ left: o.at * px, width: Math.max(24, o.seconds * px) }}
                  onClick={(e) => {
                    e.stopPropagation()
                    goToPicture(o)
                  }}
                >
                  {urls[o.id] ? <img alt="" src={urls[o.id]} /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        <span className="cuts-playhead" aria-hidden />
      </div>

      <div className="cuts-zoom">
        <span className="review-count cuts-timer">
          {formatPrecise(outputTime(keep, t))} / {formatPrecise(total)}
        </span>
        <div className="cuts-zoom-buttons">
          <button type="button" className="btn small" aria-label="Zoom out" disabled={px <= MIN_PX * 1.01} onClick={() => zoom(-1)}>
            −
          </button>
          <button type="button" className="btn small" aria-label="Zoom in" disabled={px >= MAX_PX * 0.99} onClick={() => zoom(1)}>
            +
          </button>
        </div>
      </div>

      <div className="cuts-controls">
        {inPart >= 0 ? (
          <>
            <button type="button" className="btn" onClick={() => change(splitAt(keep, tRef.current))}>
              Split
            </button>
            <button type="button" className="btn" disabled={keep.length === 1} onClick={() => change(removeAt(keep, tRef.current))}>
              Delete
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => change(restoreAt(keep, tRef.current, duration))}>
            Keep this part
          </button>
        )}
        <button type="button" className="btn" disabled={history.length === 0} onClick={undo}>
          Undo
        </button>
        <button type="button" className={`btn${picking ? ' primary' : ''}`} aria-expanded={picking} onClick={togglePicker}>
          + Picture
        </button>
      </div>

      {picNote ? (
        <p className="hint warn-text" ref={notePanel}>
          {picNote}
        </p>
      ) : null}
      {picking ? (
        <div className="pic-picker" ref={picPanel}>
          <div className="group-title">Put a picture on at {formatPrecise(t)}</div>
          <button type="button" className="btn wide pic-phone" onClick={() => phonePicker.current?.click()}>
            From my phone
          </button>
          <input
            ref={phonePicker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) addPicture({ kind: 'phone', name: file.name, type: file.type || 'image/png' }, file)
            }}
          />
          {bank.length > 0 ? (
            <>
              <span className="hint">Or from the picture bank:</span>
              <div className="pic-grid">
                {bank.map((b) => (
                  <button key={b.id} type="button" className="pic-cell" onClick={() => addPicture({ kind: 'bank', pictureId: b.id })}>
                    {bankUrls[b.id] ? <img alt="" src={bankUrls[b.id]} /> : null}
                    <span>{b.words[0] ?? ''}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">The picture bank is empty. Add pictures in the Pictures tab to pick from them here.</p>
          )}
          <button type="button" className="linkbtn" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      <div className="cuts-legend" aria-hidden>
        <span><i className="swatch kept" /> kept</span>
        <span><i className="swatch gone" /> cut out</span>
        {checks.length > 0 ? <span><i className="swatch check" /> check this</span> : null}
      </div>
      <p className="hint cuts-hint">Scroll to move through the video and pinch to zoom. Tap a part, then drag its edges to trim it.</p>
      {overlays.length > 0 ? (
        <div className="pic-list">
          <div className="group-title">
            Pictures on this video <span className="bank-count">{overlays.length}</span>
          </div>
          {overlays.map((o) => (
            <div key={o.id} className={`pic-row${selectedPic === o.id ? ' on' : ''}`}>
              <button type="button" className="pic-row-main" onClick={() => goToPicture(o)}>
                {urls[o.id] ? <img alt="" src={urls[o.id]} /> : <span className="pic-missing">?</span>}
                <span>
                  <span className="pic-row-title">At {formatPrecise(o.at)}</span>
                  <span className="hint" style={{ display: 'block' }}>
                    {o.source.kind === 'bank' ? 'From the bank' : o.source.name}
                  </span>
                </span>
              </button>
              <div className="pic-row-controls">
                <select aria-label="How long" value={o.seconds} onChange={(e) => updatePicture(o.id, { seconds: Number(e.target.value) })}>
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </select>
                <select aria-label="Where" value={o.position} onChange={(e) => updatePicture(o.id, { position: e.target.value as ManualPicture['position'] })}>
                  {POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select aria-label="How big" value={SIZES.find((s) => s.widthPct === o.widthPct)?.widthPct ?? o.widthPct} onChange={(e) => updatePicture(o.id, { widthPct: Number(e.target.value) })}>
                  {SIZES.map((s) => (
                    <option key={s.widthPct} value={s.widthPct}>
                      {s.label}
                    </option>
                  ))}
                  {SIZES.some((s) => s.widthPct === o.widthPct) ? null : <option value={o.widthPct}>{o.widthPct}%</option>}
                </select>
                <button type="button" className="btn small" onClick={() => removePicture(o.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {noiseNote ? <p className="hint warn-text">{noiseNote}</p> : null}
      {checks.length > 0 ? (
        <div className="cuts-checks">
          <div className="group-title">
            Check these <span className="bank-count">{checks.filter((c) => c.kind !== 'noise').length}</span>
          </div>
          <p className="hint">
            Sounds with no words in them that the cutter took out, or left in. Tap one to go there, listen, and put it back if it was you talking.
          </p>
          {checks.map((c, i) => ({ c, i }))
            .filter(({ c }) => c.kind !== 'noise')
            .map(({ c, i }) => (
              <CheckRow
                key={i}
                check={c}
                isCut={partAt(keep, (c.start + c.end) / 2) < 0}
                focused={focus === i}
                onGo={() => goTo(i)}
                onListen={() => listenTo(c)}
                onPutBack={() => change(putBack(keep, { start: c.start, end: c.end }))}
                onCutIt={() => change(cutOut(keep, { start: c.start, end: c.end }))}
              />
            ))}
          {checks.some((c) => c.kind === 'noise') ? (
            <details className="cuts-noises">
              <summary className="linkbtn">Short noises cut ({checks.filter((c) => c.kind === 'noise').length})</summary>
              {checks.map((c, i) => ({ c, i }))
                .filter(({ c }) => c.kind === 'noise')
                .map(({ c, i }) => (
                  <CheckRow
                    key={i}
                    check={c}
                    isCut={partAt(keep, (c.start + c.end) / 2) < 0}
                    focused={focus === i}
                    onGo={() => goTo(i)}
                    onListen={() => listenTo(c)}
                    onPutBack={() => change(putBack(keep, { start: c.start, end: c.end }))}
                    onCutIt={() => change(cutOut(keep, { start: c.start, end: c.end }))}
                  />
                ))}
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
