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
// Over the video, as in TikTok's editor: the headline is where it will be -
// drag it to move it, pinch it to size it - and + Text and + Overlay put his
// own words, a picture or a video (from his phone or the banks) on at the
// playhead, each dragged and pinched the same way, for as long as he sets.
// Words and the headline are drawn by the render's own code (overlay.ts).
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
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
import { headlineFontReady } from './headlineFont'
import { ChevronLeft, PauseIcon, PlayIcon } from './icons'
import { HeadlineLook } from './JobRow'
import { HEADLINE_SCALE, LIMITS, type BankPicture, type Headline, type HeadlinePlace, type HeadlineStyle } from './look'
import {
  PICTURE_SECONDS,
  PICTURE_WIDTH,
  TEXT_BASE_PCT,
  TEXT_START,
  centerOf,
  isText,
  isVideo,
  longestFor,
  newPictureId,
  previewBoxes,
  textHeadline,
  type ManualPicture,
} from './manualPictures'
import { drawHeadline, layoutHeadline, type HeadlineLayout } from './overlay'

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

/** The same empty banks every time, so effects that follow them don't run
 *  again on every render. */
const NO_PICTURES: BankPicture[] = []
const NO_VIDEOS: { id: string; name: string; seconds: number; loadStill: () => Promise<Blob | null> }[] = []

/** The headline's id among the things on the video he can move. */
const HEADLINE = 'headline'
/** How small and big words can be pinched: a headline's range. */
const TEXT_WIDTH = { min: TEXT_BASE_PCT * HEADLINE_SCALE.min, max: TEXT_BASE_PCT * HEADLINE_SCALE.max } as const

/** The box a headline (or words of his) covers, as fractions of the frame -
 *  where a finger can take hold of it. */
function boxOfText(layout: HeadlineLayout, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const pad = layout.style === 'box' ? layout.fontPx * 0.3 : layout.fontPx * 0.1
  const half = Math.max(...layout.lines.map((l) => l.width)) / 2 + pad
  const tall = layout.lines.length * layout.lineHeight
  const band = layout.style === 'snap'
  return {
    left: band ? 0 : (layout.centerX - half) / width,
    top: (layout.top - (band ? layout.fontPx * 0.42 : 0)) / height,
    width: band ? 1 : (half * 2) / width,
    height: (tall + (band ? layout.fontPx * 0.84 : 0)) / height,
  }
}

/** A box at least a fingertip big (44 x 88 px on a frame `width` x
 *  `height`), grown about its middle. */
function fingerSized(box: { left: number; top: number; width: number; height: number }, width: number, height: number) {
  const w = Math.max(box.width, 88 / width)
  const h = Math.max(box.height, 44 / height)
  return { left: box.left - (w - box.width) / 2, top: box.top - (h - box.height) / 2, width: w, height: h }
}

/** Which row of the timeline each thing put on goes in: the first row free
 *  by the time it comes up, so things up together don't cover each other. */
export function overlayRows(items: readonly Pick<ManualPicture, 'id' | 'at' | 'seconds'>[]): { row: Map<string, number>; rows: number } {
  const ends: number[] = []
  const row = new Map<string, number>()
  for (const o of [...items].sort((a, b) => a.at - b.at)) {
    let r = ends.findIndex((end) => end <= o.at + 1e-6)
    if (r < 0) r = ends.push(0) - 1
    ends[r] = o.at + o.seconds
    row.set(o.id, r)
  }
  return { row, rows: Math.max(1, ends.length) }
}

/** How long a video file plays, from the phone's own player; null when it
 *  can't tell within a few seconds. */
function lengthOf(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (seconds: number | null) => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      v.removeAttribute('src')
      resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null)
    }
    const timer = window.setTimeout(() => done(null), 5000)
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => done(v.duration)
    v.onerror = () => done(null)
    v.src = url
  })
}

/** What the page around the editor can do to it, when the captions are on
 *  the same page (EditScreen). */
export interface CutsControl {
  /** Puts the playhead on this moment of the recording. */
  seek(t: number): void
  /** Plays the kept parts from this moment. */
  playFrom(t: number): void
  /** Draws what is over the video again (the captions changed). */
  repaint(): void
  /** Listens to where the playhead is, and whether it plays. */
  subscribe(listener: (t: number, playing: boolean) => void): () => void
}

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

/** What is kept of the things put on: words with nothing typed are not. */
const withWords = (list: ManualPicture[]) => list.filter((o) => o.source.kind !== 'text' || o.source.text.trim())

/** What a thing put on the video is, in a word. */
function kindOf(o: ManualPicture): 'Words' | 'Video' | 'Picture' {
  return isText(o) ? 'Words' : isVideo(o) ? 'Video' : 'Picture'
}

/** A small look at a thing put on the video: a picture's image, a sign for
 *  a video, the first of the words. */
function Thumb({ o, url }: { o: ManualPicture; url?: string }) {
  if (o.source.kind === 'text') return <span className="pic-glyph words">{o.source.text.trim().slice(0, 12) || 'Aa'}</span>
  if (isVideo(o)) return <span className="pic-glyph">▶</span>
  return url ? <img alt="" src={url} /> : <span className="pic-missing">?</span>
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
  bank = NO_PICTURES,
  defaults,
  loadImage,
  videoBank = NO_VIDEOS,
  loadVideo,
  headline,
  onDone,
  onCaptions,
  onCancel,
  paintOver,
  below,
  onState,
  control,
  headActions,
  typing = false,
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
  /** The file of a picture or video picked from the phone, from storage. */
  loadImage?: (picture: ManualPicture) => Promise<Blob | null>
  /** The video bank, to put a video on from: each with its still. */
  videoBank?: { id: string; name: string; seconds: number; loadStill: () => Promise<Blob | null> }[]
  /** A bank video's file, to show it on the video once it is put on. */
  loadVideo?: (videoId: string) => Promise<Blob | null>
  /** The headline as it will be made, drawn on the video where it will be,
   *  to drag and pinch. Absent when there is none to move. */
  headline?: {
    look: Pick<Headline, 'text' | 'position' | 'style' | 'size' | 'outlineColor' | 'outlineWidth'>
    /** How long it is up, from his first kept moment. */
    seconds: number
    place: HeadlinePlace | null
    /** Moved or sized (null: back to its spot) - once a finger lets go. */
    onPlace: (place: HeadlinePlace | null) => void
  }
  onDone: (keep: Range[], overlays: ManualPicture[], newFiles: Map<string, Blob>) => void
  /** Keeps the cuts as they are, like Done, and goes on to the captions.
   *  Absent when captions are off. */
  onCaptions?: (keep: Range[], overlays: ManualPicture[], newFiles: Map<string, Blob>) => void
  onCancel: () => void
  /** Draws over the video for moment `t` of the recording - the captions,
   *  when they are on the same page. */
  paintOver?: (ctx: CanvasRenderingContext2D, width: number, height: number, t: number, playing: boolean) => void
  /** Shown under the cuts' buttons: the captions, on the same page. */
  below?: ReactNode
  /** Every change to the cuts and pictures, as it happens. */
  onState?: (keep: Range[], overlays: ManualPicture[], newFiles: Map<string, Blob>) => void
  control?: MutableRefObject<CutsControl | null>
  /** In place of Captions and Done, at the top. */
  headActions?: ReactNode
  /** He is typing below: the video is made smaller to leave room. */
  typing?: boolean
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
  /** Each picture's and video's width over height, once it has loaded - for
   *  the preview to lay it out as the render will. */
  const [picAspect, setPicAspect] = useState<Record<string, number>>({})
  /** The fingers on the thing being moved or pinched (a picture, a video,
   *  words, the headline), where it was and how big when they came down. */
  const gesture = useRef<{
    id: string
    pointers: Map<number, { x: number; y: number }>
    from: { center: { x: number; y: number }; size: number; mid: { x: number; y: number }; spread: number }
    moved: boolean
  } | null>(null)
  /** When fingers last let go of something: the tap that ends a pinch
   *  doesn't play the video. */
  const lastGesture = useRef(0)
  /** Where the headline is - kept (onPlace) once a finger lets go. */
  const [headlinePlace, setHeadlinePlace] = useState<HeadlinePlace | null>(headline?.place ?? null)
  const headlinePlaceRef = useRef(headlinePlace)
  headlinePlaceRef.current = headlinePlace
  /** The frame's size on screen, the words are laid out at; and the
   *  headline's font, once it is here. */
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  const [fontReady, setFontReady] = useState(false)
  /** Words just put on: their box takes the keyboard. */
  const [newText, setNewText] = useState<string | null>(null)
  /** What the overlay canvas draws of its own, under the captions: his words
   *  and the headline, laid out at the frame's size. */
  const drawn = useRef<{ layouts: HeadlineLayout[]; width: number }>({ layouts: [], width: 0 })
  const videoEls = useRef(new Map<string, HTMLVideoElement>())
  const overlaysRef = useRef(overlays)
  overlaysRef.current = overlays
  const frameBox = useRef<HTMLDivElement>(null)
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
  const overCanvas = useRef<HTMLCanvasElement>(null)
  const paintRef = useRef(paintOver)
  paintRef.current = paintOver
  const listeners = useRef(new Set<(t: number, playing: boolean) => void>())

  /** What is over the video, for the moment under the playhead. */
  const repaint = useCallback(() => {
    const c = overCanvas.current
    const paint = paintRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    const w = Math.round(rect.width * scale)
    const h = Math.round(rect.height * scale)
    if (w === 0 || h === 0) return
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    // His words and the headline first: the captions go over them, as in
    // the render.
    const own = drawn.current
    if (own.layouts.length > 0 && own.width > 0) {
      ctx.save()
      const k = w / own.width
      ctx.setTransform(k, 0, 0, k, 0, 0)
      for (const layout of own.layouts) drawHeadline(ctx, layout)
      ctx.restore()
    }
    paint?.(ctx, w, h, tRef.current, playingRef.current)
  }, [])

  // The frame's size, to lay the words out at; the headline font.
  useEffect(() => {
    const el = frameBox.current
    if (!el) return
    const measure = () =>
      setFrameSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  useEffect(() => {
    let alive = true
    void headlineFontReady().then(() => alive && setFontReady(true))
    return () => {
      alive = false
    }
  }, [])

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

  // The captions over the video, and whoever follows the playhead.
  useEffect(() => {
    repaint()
    for (const listener of listeners.current) listener(t, playingRef.current)
  }, [t, playing, repaint, aspect, typing])

  useEffect(() => {
    onState?.(keep, withWords(overlays), newFiles.current)
  }, [keep, overlays]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // What is shown on the video: bank pictures from the bank, bank videos from
  // the video bank, the video's own from storage. Each looked for once.
  const looked = useRef(new Set<string>())
  useEffect(() => {
    let alive = true
    const want = overlays.filter((o) => !isText(o) && !urls[o.id] && !looked.current.has(o.id))
    if (want.length === 0) return
    for (const o of want) looked.current.add(o.id)
    void (async () => {
      const next: Record<string, string> = {}
      for (const o of want) {
        let blob: Blob | null | undefined = null
        const source = o.source
        if (source.kind === 'bank') blob = bank.find((b) => b.id === source.pictureId)?.image
        else if (source.kind === 'video') blob = newFiles.current.get(o.id) ?? (await loadVideo?.(source.videoId).catch(() => null))
        else blob = newFiles.current.get(o.id) ?? (await loadImage?.(o).catch(() => null))
        if (blob) {
          const url = URL.createObjectURL(blob)
          made.current.push(url)
          next[o.id] = url
        } else looked.current.delete(o.id)
      }
      if (alive && Object.keys(next).length > 0) setUrls((u) => ({ ...u, ...next }))
    })()
    return () => {
      alive = false
    }
  }, [overlays, bank, loadImage, loadVideo, urls])
  useEffect(
    () => () => {
      for (const url of made.current) URL.revokeObjectURL(url)
    },
    [],
  )

  /** The banks' pictures and videos as thumbnails, while choosing. */
  const [bankUrls, setBankUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!picking) return
    let alive = true
    const next: Record<string, string> = {}
    for (const b of bank) next[b.id] = URL.createObjectURL(b.image)
    setBankUrls({ ...next })
    void (async () => {
      for (const v of videoBank) {
        const still = await v.loadStill().catch(() => null)
        if (!alive) return
        if (still) {
          next[`video:${v.id}`] = URL.createObjectURL(still)
          setBankUrls({ ...next })
        }
      }
    })()
    return () => {
      alive = false
      for (const url of Object.values(next)) URL.revokeObjectURL(url)
    }
    // The video bank's list is read when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, bank])

  const onCutPart = 'Move the playhead onto a part of the video that is kept - what you put on comes up there.'

  /** Opens the overlay picker - or, with the playhead on a part that is cut
   *  out, says so at once, not after something has been chosen. */
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
    setSelectedPic(null)
    setPicking(true)
  }

  // The picker (or the note) opens under the buttons, which on a phone is
  // below the bottom of the screen: + Overlay looked as if it did nothing.
  // Brought up to just under the video held at the top.
  useEffect(() => {
    const panel = notePanel.current ?? picPanel.current
    if (!panel) return
    const held = top.current?.getBoundingClientRect().bottom ?? 0
    const box = panel.getBoundingClientRect()
    if (box.top >= held && box.bottom <= window.innerHeight) return
    window.scrollBy({ top: box.top - held - 12, behavior: 'smooth' })
  }, [picking, picNote])

  /** Puts a picture or a video on the video at the playhead: it comes up
   *  there, so the playhead has to be on a part of the video that is kept.
   *  A video stays up for its own length, at most a minute. */
  const addOverlay = (source: ManualPicture['source'], file?: Blob, length?: number | null) => {
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
    const placed = isVideo(picture)
      ? { ...picture, position: 'middle' as const, widthPct: 70, ...(length ? { length, seconds: Math.round(Math.min(length, longestFor({ ...picture, length })) * 10) / 10 } : {}) }
      : picture
    setOverlays((list) => [...list, placed].sort((a, b) => a.at - b.at))
    setSelectedPic(id)
    setPicking(false)
    setPicNote(null)
  }

  /** Words at the playhead, in the middle, in the headline's look: their box
   *  opens to type in. */
  const addText = () => {
    if (partAt(keepRef.current, tRef.current) < 0) {
      setPicNote(onCutPart)
      return
    }
    const id = newPictureId()
    const words: ManualPicture = {
      id,
      source: { kind: 'text', text: '', style: headline?.look.style ?? 'box' },
      at: Math.round(tRef.current * 100) / 100,
      seconds: defaults?.seconds ?? 3,
      position: 'middle',
      widthPct: TEXT_BASE_PCT,
      center: { ...TEXT_START },
    }
    setOverlays((list) => [...list, words].sort((a, b) => a.at - b.at))
    setSelectedPic(id)
    setNewText(id)
    setPicking(false)
    setPicNote(null)
  }

  const updatePicture = (id: string, patch: Partial<ManualPicture>) =>
    setOverlays((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)).sort((a, b) => a.at - b.at))
  const setWords = (id: string, patch: { text?: string; style?: HeadlineStyle }) =>
    setOverlays((list) => list.map((o) => (o.id === id && o.source.kind === 'text' ? { ...o, source: { ...o.source, ...patch } } : o)))
  const removePicture = (id: string) => {
    newFiles.current.delete(id)
    setOverlays((list) => list.filter((o) => o.id !== id))
    setSelectedPic((s) => (s === id ? null : s))
  }
  // Words left with nothing typed in them go once he moves on from them.
  useEffect(() => {
    setOverlays((list) => {
      const kept = list.filter((o) => o.id === selectedPic || o.source.kind !== 'text' || o.source.text.trim())
      return kept.length === list.length ? list : kept
    })
  }, [selectedPic])
  const goToPicture = (o: ManualPicture) => {
    stop()
    setSelectedPic(o.id)
    scrollTo(o.at)
    followTime(o.at)
    seek(o.at)
  }
  const goToHeadline = () => {
    stop()
    setSelectedPic(HEADLINE)
    const from = keepRef.current[0]?.start ?? 0
    scrollTo(from)
    followTime(from)
    seek(from)
  }

  // What is up at the playhead - and the one being edited, wherever the
  // playhead is - on the finished video's own clock, as the render times it.
  const outT = outputTime(keep, t)
  const upAt = (o: ManualPicture) => {
    const from = outputTime(keep, o.at)
    return outT >= from && outT < from + o.seconds
  }
  const shown = overlays.filter((o) => !isText(o) && (upAt(o) || o.id === selectedPic))
  // Pictures laid out as the render lays them out (side by side when they
  // come up together); each video in its own box.
  const boxes: Record<string, { left: number; top: number; width: number; height: number }> = {
    ...previewBoxes(
      shown.filter((o) => !isVideo(o)).map((o) => ({ ...o, aspect: picAspect[o.id] })),
      aspect,
    ),
  }
  for (const o of shown.filter(isVideo)) Object.assign(boxes, previewBoxes([{ ...o, aspect: picAspect[o.id] ?? 16 / 9 }], aspect))
  const selectedPicture = overlays.find((o) => o.id === selectedPic) ?? null

  // His words and the headline, laid out by the render's own code at the
  // frame's size - only again when they or the frame change.
  const measure = useMemo(() => (typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')), [])
  const lookKey = headline ? JSON.stringify(headline.look) : ''
  const headlineLayout = useMemo(
    () =>
      headline && headline.look.text.trim() && measure && frameSize.width > 0
        ? layoutHeadline(measure, frameSize.width, frameSize.height, { ...headline.look, place: headlinePlace })
        : null,
    // The look is compared by what it says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookKey, headlinePlace, frameSize, fontReady, measure],
  )
  const textKey = JSON.stringify(overlays.filter(isText).map((o) => [o.id, o.source, o.center, o.widthPct]))
  const textLayouts = useMemo(() => {
    const out = new Map<string, HeadlineLayout>()
    if (!measure || frameSize.width === 0) return out
    for (const o of overlays) {
      const words = textHeadline(o)
      const layout = words ? layoutHeadline(measure, frameSize.width, frameSize.height, words) : null
      if (layout) out.set(o.id, layout)
    }
    return out
    // Only the words' own fields change their layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textKey, frameSize, fontReady, measure])
  const headlineOn = headlineLayout !== null && (outT < (headline?.seconds ?? 0) || selectedPic === HEADLINE)
  const shownTexts = overlays.filter((o) => textLayouts.has(o.id) && (upAt(o) || o.id === selectedPic))
  drawn.current = {
    layouts: [...shownTexts.map((o) => textLayouts.get(o.id)!), ...(headlineOn && headlineLayout ? [headlineLayout] : [])],
    width: frameSize.width,
  }
  const drawnKey = `${headlineOn}|${shownTexts.map((o) => o.id).join(',')}|${textKey}|${JSON.stringify(headlinePlace)}|${frameSize.width}x${frameSize.height}|${fontReady}|${lookKey}`
  useEffect(() => {
    repaint()
  }, [drawnKey, repaint])
  // Where a finger can take hold of the words and the headline.
  const holds = frameSize.width > 0
    ? [
        ...shownTexts.map((o) => ({ id: o.id, layout: textLayouts.get(o.id)! })),
        ...(headlineOn && headlineLayout ? [{ id: HEADLINE, layout: headlineLayout }] : []),
      ].map(({ id, layout }) => ({ id, box: fingerSized(boxOfText(layout, frameSize.width, frameSize.height), frameSize.width, frameSize.height) }))
    : []
  const rows = useMemo(() => overlayRows(overlays), [overlays])

  // The videos he put on play along with the video, on its clock, and sit
  // on their frame while he scrolls.
  useEffect(() => {
    for (const o of overlays) {
      if (!isVideo(o)) continue
      const el = videoEls.current.get(o.id)
      if (!el || el.readyState < 1) continue
      const local = outT - outputTime(keep, o.at)
      if (local < 0 || local >= o.seconds) {
        if (!el.paused) el.pause()
        if (o.id === selectedPic && Math.abs(el.currentTime - Math.max(0, local < 0 ? 0 : o.seconds - 0.05)) > 0.05) el.currentTime = local < 0 ? 0 : Math.max(0, o.seconds - 0.05)
        continue
      }
      if (playing) {
        if (el.paused) {
          el.currentTime = local
          void el.play().catch(() => {})
        } else if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local
      } else {
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - local) > 0.04) el.currentTime = local
      }
    }
  }, [outT, playing, overlays, keep, selectedPic])

  /** Two fingers' middle and spread, in the frame's pixels. */
  const fingers = (points: Map<number, { x: number; y: number }>) => {
    const list = [...points.values()]
    const mid = { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length }
    const spread = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0
    return { mid, spread }
  }
  /** Where a thing on the video is and how big, to move it from. */
  const holdOf = (id: string): { center: { x: number; y: number }; size: number } | null => {
    if (id === HEADLINE) {
      if (!headlineLayout || frameSize.width === 0) return null
      const place = headlinePlaceRef.current
      const middle = {
        x: headlineLayout.centerX / frameSize.width,
        y: (headlineLayout.top + (headlineLayout.lines.length * headlineLayout.lineHeight) / 2) / frameSize.height,
      }
      return { center: place ? { x: place.x, y: place.y } : middle, size: place?.scale ?? 1 }
    }
    const o = overlaysRef.current.find((x) => x.id === id)
    if (!o) return null
    const box = boxes[id]
    return { center: o.center ?? (isText(o) ? TEXT_START : box ? centerOf(box) : { x: 0.5, y: 0.42 }), size: o.widthPct }
  }
  const limitsOf = (id: string): { min: number; max: number } => {
    if (id === HEADLINE) return HEADLINE_SCALE
    const o = overlaysRef.current.find((x) => x.id === id)
    return o && isText(o) ? TEXT_WIDTH : PICTURE_WIDTH
  }
  const moveTo = (id: string, center: { x: number; y: number }, size: number) => {
    if (id === HEADLINE) {
      const next = { x: center.x, y: center.y, scale: Math.round(size * 100) / 100 }
      headlinePlaceRef.current = next
      setHeadlinePlace(next)
      return
    }
    setOverlays((list) => list.map((x) => (x.id === id ? { ...x, center, widthPct: Math.round(size) } : x)))
  }
  /** A finger down on something on the video: it is picked, one finger
   *  moves it, two pinch it bigger or smaller. */
  const onItemDown = (id: string, e: ReactPointerEvent) => {
    e.stopPropagation()
    if (id !== selectedPic) setSelectedPic(id)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    const points = gesture.current?.id === id ? gesture.current.pointers : new Map<number, { x: number; y: number }>()
    points.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const hold = holdOf(id)
    if (!hold) return
    const { mid, spread } = fingers(points)
    gesture.current = { id, pointers: points, from: { ...hold, mid, spread }, moved: gesture.current?.id === id ? gesture.current.moved : false }
  }
  /** A second finger anywhere on the video pinches what the first holds. */
  const onFrameDown = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.pointers.has(e.pointerId)) return
    onItemDown(g.id, e)
  }
  const onItemMove = (e: ReactPointerEvent) => {
    const g = gesture.current
    const frameEl = frameBox.current
    if (!g || !g.pointers.has(e.pointerId) || !frameEl) return
    e.stopPropagation()
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const rect = frameEl.getBoundingClientRect()
    const { mid, spread } = fingers(g.pointers)
    if (!g.moved && Math.hypot(mid.x - g.from.mid.x, mid.y - g.from.mid.y) < 3 && Math.abs(spread - g.from.spread) < 3) return
    g.moved = true
    const center = {
      x: Math.min(1, Math.max(0, g.from.center.x + (mid.x - g.from.mid.x) / rect.width)),
      y: Math.min(1, Math.max(0, g.from.center.y + (mid.y - g.from.mid.y) / rect.height)),
    }
    const limits = limitsOf(g.id)
    const size = g.pointers.size > 1 && g.from.spread > 0 ? Math.min(limits.max, Math.max(limits.min, (g.from.size * spread) / g.from.spread)) : g.from.size
    moveTo(g.id, center, size)
  }
  const onItemUp = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || !g.pointers.has(e.pointerId)) return
    e.stopPropagation()
    g.pointers.delete(e.pointerId)
    lastGesture.current = performance.now()
    if (g.pointers.size === 0) {
      gesture.current = null
      if (g.id === HEADLINE && g.moved) headline?.onPlace(headlinePlaceRef.current)
      return
    }
    // One finger left after a pinch: it moves on from here.
    const hold = holdOf(g.id)
    const { mid, spread } = fingers(g.pointers)
    if (hold) g.from = { ...hold, mid, spread }
  }
  /** The headline back in its angle's spot, its own size. */
  const headlineBack = () => {
    headlinePlaceRef.current = null
    setHeadlinePlace(null)
    headline?.onPlace(null)
  }

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

  if (control) {
    control.current = {
      seek: (to: number) => {
        stop()
        scrollTo(to)
        followTime(to)
        seek(to)
      },
      playFrom: (from: number) => {
        stop()
        tRef.current = from
        play()
      },
      repaint,
      subscribe: (listener) => {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
      },
    }
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
    <section className={`screen cuts${typing ? ' typing' : ''}`} aria-label={`Cuts for ${name}`}>
      <div className="review-top" ref={top}>
        <div className="review-head">
          <button type="button" className="back" onClick={onCancel}>
            <ChevronLeft /> Back
          </button>
          <div className="cuts-head-actions">
            {headActions !== undefined ? headActions : onCaptions ? (
              <button type="button" className="btn small" onClick={() => onCaptions(keep, withWords(overlays), newFiles.current)}>
                Captions
              </button>
            ) : null}
            {headActions !== undefined ? null : (
              <button type="button" className="btn small primary" onClick={() => onDone(keep, withWords(overlays), newFiles.current)}>
                Done
              </button>
            )}
          </div>
        </div>
        <div
          className="review-frame"
          ref={frameBox}
          style={{ aspectRatio: String(aspect) }}
          onClick={() => {
            // The finger that let go of a pinch isn't a tap to play.
            if (performance.now() - lastGesture.current > 400) play()
          }}
          onPointerDown={onFrameDown}
          onPointerMove={onItemMove}
          onPointerUp={onItemUp}
          onPointerCancel={onItemUp}
        >
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
          {shown.map((o) => {
            const box = boxes[o.id]
            if (!urls[o.id] || !box) return null
            const style = { left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }
            const className = `cuts-pic-preview${o.id === selectedPic ? ' editing' : ''}`
            const hold = {
              onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
              onPointerDown: (e: ReactPointerEvent) => onItemDown(o.id, e),
              onPointerMove: onItemMove,
              onPointerUp: onItemUp,
              onPointerCancel: onItemUp,
            }
            return isVideo(o) ? (
              <video
                key={o.id}
                ref={(el) => {
                  if (el) videoEls.current.set(o.id, el)
                  else videoEls.current.delete(o.id)
                }}
                className={`${className} cuts-video-preview`}
                src={urls[o.id]}
                playsInline
                muted
                preload="auto"
                style={style}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  if (v.videoWidth && v.videoHeight) {
                    const ratio = v.videoWidth / v.videoHeight
                    setPicAspect((a) => (a[o.id] === ratio ? a : { ...a, [o.id]: ratio }))
                  }
                }}
                {...hold}
              />
            ) : (
              <img
                key={o.id}
                className={className}
                alt=""
                src={urls[o.id]}
                draggable={false}
                style={style}
                onLoad={(e) => {
                  const img = e.currentTarget
                  if (img.naturalWidth && img.naturalHeight) {
                    const ratio = img.naturalWidth / img.naturalHeight
                    setPicAspect((a) => (a[o.id] === ratio ? a : { ...a, [o.id]: ratio }))
                  }
                }}
                {...hold}
              />
            )
          })}
          <canvas ref={overCanvas} aria-hidden />
          {holds.map(({ id, box }) => (
            <div
              key={id}
              role="button"
              aria-label={id === HEADLINE ? 'The headline: drag to move it' : 'Your words: drag to move them'}
              className={`cuts-text-hold${id === selectedPic ? ' editing' : ''}`}
              style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => onItemDown(id, e)}
              onPointerMove={onItemMove}
              onPointerUp={onItemUp}
              onPointerCancel={onItemUp}
            />
          ))}
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
            <div className="cuts-ruler" ref={ruler} style={{ width: duration * px, height: 164 + rows.rows * 24 }} onClick={() => setSelected(null)}>
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
                  aria-label={`${kindOf(o)} at ${formatPrecise(o.at)}`}
                  className={`cuts-pic${selectedPic === o.id ? ' on' : ''}${isText(o) ? ' words' : ''}`}
                  style={{ left: o.at * px, width: Math.max(24, o.seconds * px), top: 162 + (rows.row.get(o.id) ?? 0) * 24 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    goToPicture(o)
                  }}
                >
                  <Thumb o={o} url={urls[o.id]} />
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
      </div>
      <div className="cuts-add">
        <button type="button" className="btn" onClick={addText}>
          + Text
        </button>
        <button type="button" className={`btn${picking ? ' primary' : ''}`} aria-expanded={picking} onClick={togglePicker}>
          + Overlay
        </button>
      </div>

      {selectedPic === HEADLINE && headline ? (
        <div className="pic-edit" aria-label="The headline">
          <div className="pic-edit-head">
            <span className="pic-row-title">Headline</span>
            <button type="button" className="linkbtn" onClick={() => setSelectedPic(null)}>
              Done
            </button>
          </div>
          <label className="slider">
            <span>Size</span>
            <input
              type="range"
              min={Math.round(HEADLINE_SCALE.min * 100)}
              max={Math.round(HEADLINE_SCALE.max * 100)}
              step={5}
              value={Math.round((headlinePlace?.scale ?? 1) * 100)}
              aria-label="How big the headline is"
              onChange={(e) => {
                const hold = holdOf(HEADLINE)
                if (hold) moveTo(HEADLINE, hold.center, Number(e.target.value) / 100)
              }}
              onPointerUp={() => headline.onPlace(headlinePlaceRef.current)}
              onBlur={() => headline.onPlace(headlinePlaceRef.current)}
            />
            <output>{Math.round((headlinePlace?.scale ?? 1) * 100)}%</output>
          </label>
          <p className="hint">Drag it on the video to move it, pinch it to make it bigger or smaller. The next videos of this angle start with it here too.</p>
          {headlinePlace ? (
            <div className="actions-row">
              <button type="button" className="btn small" onClick={headlineBack}>
                Put back
              </button>
            </div>
          ) : null}
        </div>
      ) : selectedPicture ? (
        <div className="pic-edit" aria-label={`The ${kindOf(selectedPicture).toLowerCase()} you picked`}>
          <div className="pic-edit-head">
            {isText(selectedPicture) ? null : <Thumb o={selectedPicture} url={urls[selectedPicture.id]} />}
            <span className="pic-row-title">
              {kindOf(selectedPicture)} at {formatPrecise(selectedPicture.at)}
            </span>
            <button type="button" className="linkbtn" onClick={() => setSelectedPic(null)}>
              Done
            </button>
          </div>
          {selectedPicture.source.kind === 'text' ? (
            <>
              <input
                type="text"
                className="words-input"
                value={selectedPicture.source.text}
                maxLength={LIMITS.headlineChars}
                placeholder="Type your words"
                aria-label="Your words"
                autoFocus={newText === selectedPicture.id}
                onFocus={() => setNewText(null)}
                onChange={(e) => setWords(selectedPicture.id, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
              <HeadlineLook value={selectedPicture.source.style} onPick={(style) => setWords(selectedPicture.id, { style })} />
            </>
          ) : null}
          <div className="pic-edit-row">
            <span className="label">On screen for</span>
            <div className="stepper">
              <button
                type="button"
                className="btn small icon-btn"
                aria-label="Shorter"
                disabled={selectedPicture.seconds <= PICTURE_SECONDS.min}
                onClick={() => updatePicture(selectedPicture.id, { seconds: Math.max(PICTURE_SECONDS.min, selectedPicture.seconds - PICTURE_SECONDS.step) })}
              >
                −
              </button>
              <span className="stepper-value pic-seconds" aria-label="Seconds on screen">
                {selectedPicture.seconds.toFixed(1)} s
              </span>
              <button
                type="button"
                className="btn small icon-btn"
                aria-label="Longer"
                disabled={selectedPicture.seconds >= longestFor(selectedPicture)}
                onClick={() => updatePicture(selectedPicture.id, { seconds: Math.min(longestFor(selectedPicture), selectedPicture.seconds + PICTURE_SECONDS.step) })}
              >
                +
              </button>
            </div>
          </div>
          <label className="slider">
            <span>Size</span>
            <input
              type="range"
              min={isText(selectedPicture) ? TEXT_WIDTH.min : PICTURE_WIDTH.min}
              max={isText(selectedPicture) ? TEXT_WIDTH.max : PICTURE_WIDTH.max}
              step={1}
              value={selectedPicture.widthPct}
              aria-label={`How big the ${kindOf(selectedPicture).toLowerCase()} is`}
              onChange={(e) => updatePicture(selectedPicture.id, { widthPct: Number(e.target.value) })}
            />
            <output>{isText(selectedPicture) ? Math.round((selectedPicture.widthPct / TEXT_BASE_PCT) * 100) : selectedPicture.widthPct}%</output>
          </label>
          <p className="hint">
            {isText(selectedPicture) ? 'Drag them' : 'Drag it'} on the video to move {isText(selectedPicture) ? 'them' : 'it'}, pinch to make{' '}
            {isText(selectedPicture) ? 'them' : 'it'} bigger or smaller.{isVideo(selectedPicture) ? ' Plays without its sound.' : ''}
          </p>
          <div className="actions-row">
            <button
              type="button"
              className="btn small"
              disabled={Math.abs(selectedPicture.at - t) < 0.05}
              onClick={() => {
                if (partAt(keepRef.current, tRef.current) < 0) return setPicNote(onCutPart)
                updatePicture(selectedPicture.id, { at: Math.round(tRef.current * 100) / 100 })
              }}
            >
              Start it here
            </button>
            {selectedPicture.center && !isText(selectedPicture) ? (
              <button type="button" className="btn small" onClick={() => updatePicture(selectedPicture.id, { center: undefined })}>
                Put back
              </button>
            ) : null}
            <button type="button" className="btn small danger" onClick={() => removePicture(selectedPicture.id)}>
              Delete {kindOf(selectedPicture).toLowerCase()}
            </button>
          </div>
        </div>
      ) : null}
      {overlays.length > 0 || headlineLayout ? (
        <div className="pic-chips" aria-label="On this video">
          {headlineLayout ? (
            <button type="button" aria-label="Headline" className={`pic-chip${selectedPic === HEADLINE ? ' on' : ''}`} onClick={goToHeadline}>
              <span className="pic-glyph">H</span>
              <span>Headline</span>
            </button>
          ) : null}
          {overlays.map((o) => (
            <button key={o.id} type="button" className={`pic-chip${selectedPic === o.id ? ' on' : ''}`} onClick={() => goToPicture(o)}>
              <Thumb o={o} url={urls[o.id]} />
              <span>{formatPrecise(o.at)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {picNote ? (
        <p className="hint warn-text" ref={notePanel}>
          {picNote}
        </p>
      ) : null}
      {picking ? (
        <div className="pic-picker" ref={picPanel}>
          <div className="group-title">Put on at {formatPrecise(t)}</div>
          <button type="button" className="btn wide pic-phone" onClick={() => phonePicker.current?.click()}>
            A photo or video from my phone
          </button>
          <input
            ref={phonePicker}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const type = file.type || (/\.(mov|mp4|m4v)$/i.test(file.name) ? 'video/mp4' : 'image/png')
              if (type.startsWith('video/')) void lengthOf(file).then((length) => addOverlay({ kind: 'phone', name: file.name, type }, file, length))
              else addOverlay({ kind: 'phone', name: file.name, type }, file)
            }}
          />
          {bank.length > 0 ? (
            <>
              <span className="hint">Or from the picture bank:</span>
              <div className="pic-grid">
                {bank.map((b) => (
                  <button key={b.id} type="button" className="pic-cell" onClick={() => addOverlay({ kind: 'bank', pictureId: b.id })}>
                    {bankUrls[b.id] ? <img alt="" src={bankUrls[b.id]} /> : null}
                    <span>{b.words[0] ?? ''}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {videoBank.length > 0 ? (
            <>
              <span className="hint">Or from the video bank:</span>
              <div className="pic-grid">
                {videoBank.map((v) => (
                  <button key={v.id} type="button" className="pic-cell" onClick={() => addOverlay({ kind: 'video', videoId: v.id }, undefined, v.seconds)}>
                    {bankUrls[`video:${v.id}`] ? <img alt="" src={bankUrls[`video:${v.id}`]} /> : <span className="pic-glyph">▶</span>}
                    <span>{v.name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {bank.length === 0 && videoBank.length === 0 ? (
            <p className="hint">The banks are empty. Pictures and videos kept in the Bank tab can be picked here too.</p>
          ) : null}
          <button type="button" className="linkbtn" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {below}

      <div className="cuts-legend" aria-hidden>
        <span><i className="swatch kept" /> kept</span>
        <span><i className="swatch gone" /> cut out</span>
        {checks.length > 0 ? <span><i className="swatch check" /> check this</span> : null}
      </div>
      <p className="hint cuts-hint tip">Scroll to move through the video and pinch to zoom. Tap a part, then drag its edges to trim it.</p>
      {noiseNote ? <p className="hint warn-text">{noiseNote}</p> : null}
      {checks.length > 0 ? (
        <div className="cuts-checks">
          <div className="group-title">
            Check these <span className="bank-count">{checks.filter((c) => c.kind !== 'noise').length}</span>
          </div>
          <p className="hint tip">
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
