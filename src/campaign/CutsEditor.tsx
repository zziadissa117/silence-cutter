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
/** Where the parts start below the time marks. */
const MARKS_PX = 18

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
  onSelect,
  onHandleDown,
}: {
  keep: Range[]
  px: number
  selected: number | null
  words: CaptionWord[]
  onSelect: (i: number | null) => void
  onHandleDown: (i: number, edge: 'start' | 'end', down: ReactPointerEvent<HTMLSpanElement>) => void
}) {
  const lines = useMemo(() => wordLines(words, px), [words, px])
  return (
    <>
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
      {words.map((w, i) => (
        <span
          key={`${w.start}-${i}`}
          className={`cuts-word${partAt(keep, w.start + 0.05) < 0 ? ' gone' : ''}`}
          style={{ left: w.start * px, top: MARKS_PX + 62 + lines[i] * 18 }}
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

export function CutsEditor({
  name,
  file,
  missing = false,
  duration,
  initial,
  words,
  onDone,
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
  onDone: (keep: Range[]) => void
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
  const video = useRef<HTMLVideoElement>(null)
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
      <div className="review-top">
        <div className="review-head">
          <button type="button" className="back" onClick={onCancel}>
            <ChevronLeft /> Back
          </button>
          <span className="review-count cuts-timer">
            {formatPrecise(outputTime(keep, t))} / {formatPrecise(total)}
          </span>
          <button type="button" className="btn small primary" onClick={() => onDone(keep)}>
            Done
          </button>
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
              <Track keep={keep} px={px} selected={selected} words={words} onSelect={setSelected} onHandleDown={onHandleDown} />
            </div>
          </div>
        </div>
        <span className="cuts-playhead" aria-hidden />
      </div>

      <div className="cuts-zoom">
        <span className="hint">Pinch the timeline to zoom</span>
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
      </div>
      <p className="hint cuts-hint">Scroll to move through the video. Tap a part, then drag its edges to trim it.</p>
    </section>
  )
}
