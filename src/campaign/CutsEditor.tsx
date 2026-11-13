// Fixing a video before it is made, the way TikTok's editor works (his ask,
// 2026-11-10: "make it pretty similar to the TikTok one"): dark, the video big
// at the top, the time and play under it, then the timeline of what plays -
// the kept parts back to back as clips of small frames (filmstrip.ts), the
// cut bits hidden, his words written small under them - and a row of bars
// for the headline and each thing put on. A playhead fixed in the middle:
// slide the timeline to move through the video, pinch it to zoom.
//
// Tap a clip: a white frame with an arrow at each end. Drag an arrow inward
// to trim, outward to bring back what was cut there (never past the next
// clip's footage); the clip tools come up along the bottom (Split at the
// playhead, Delete). Tap a bar: its middle moves it along the video, its
// ends change when it comes up and how long it stays. Nothing tapped, the
// toolbar puts things on: Text, Overlay, and the captions and checks below.
// Edges snap to the gaps between words only within a few pixels. Play runs
// only the kept parts, exactly as the video will be. Nothing is made until he
// is done, and the recording itself is never changed - see cuts.ts.
//
// Over the video, as in TikTok's editor: the headline is where it will be -
// drag it to move it, pinch it to size it - and Text and Overlay put his own
// words, a picture or a video (from his phone or the banks) on at the
// playhead, each dragged and pinched the same way. Words and the headline
// are drawn by the render's own code (overlay.ts).
//
// Smooth on a phone because little moves while he scrolls: the timeline is
// laid out only around what is on screen and only again when the cuts, the
// zoom or that stretch change; the timer and buttons follow at most once a
// frame; and the video is asked for one frame at a time - always the latest
// place - instead of a new jump on every scroll event.

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
  rulerSteps,
  snapTo,
  clipsOf,
  sourceAt,
  splitAt,
  trimPart,
} from './cuts'
import { frameAt, THUMB, useFilmstrip, type Filmstrip } from './filmstrip'
import { headlineFontReady } from './headlineFont'
import { ChevronLeft, FullIcon, PauseIcon, PlayIcon, RedoIcon, UndoIcon } from './icons'
import { HeadlineLook } from './JobRow'
import { HEADLINE_SCALE, LIMITS, type BankPicture, type Headline, type HeadlinePlace, type HeadlineStyle } from './look'
import {
  PICTURE_SECONDS,
  PICTURE_WIDTH,
  TEXT_BASE_PCT,
  TEXT_START,
  centerOf,
  isSound,
  isText,
  isVideo,
  longestFor,
  SOUND_DB,
  newPictureId,
  previewBoxes,
  textHeadline,
  type ManualPicture,
} from './manualPictures'
import { drawHeadline, layoutHeadline, type HeadlineLayout } from './overlay'
import { effectFile, SoundPicker, type PickedSound } from './SoundPicker'
import type { MotionSound } from './motion/sfx'

/** How much timeline a second takes at first: room enough to read the words. */
const START_PX = 110
/** The zoom steps of - and +; pinching goes anywhere between the ends. */
const ZOOMS = [40, 110, 300, 800, 2000]
const MIN_PX = ZOOMS[0]
const MAX_PX = ZOOMS[ZOOMS.length - 1]
/** Lines the words are laid on under the frames, so fast speech doesn't
 *  pile them up. */
const WORD_LINES = 2
/** Roughly how wide a letter of the words is. */
const LETTER_PX = 6.5
/** How near a word's edge a trim has to come to land on it: right on it -
 *  at 10 px (a fingertip) a trim jumped to the next word when he meant
 *  between them (2026-11-02). */
const SNAP_PX = 4
/** The timeline from the top, as in TikTok: the time marks, the clips (its
 *  frames), his words under them, then a row for each thing put on. */
const CLIP_TOP = 24
const CLIP_H = THUMB.height
const WORD_TOP = CLIP_TOP + CLIP_H + 6
const ROWS_TOP = WORD_TOP + WORD_LINES * 16 + 8
const ROW_H = 34

const clampPx = (px: number) => Math.min(MAX_PX, Math.max(MIN_PX, px))

/** How things stood before a change, for Undo and Redo. */
interface Snapshot {
  keep: Range[]
  overlays: ManualPicture[]
}

/** How near the middle (a share of the frame) a thing has to come to snap
 *  onto it, its guide line showing - as in TikTok (2026-11-02). */
const CENTER_SNAP = 0.025
const NO_GUIDES = { x: false, y: false }

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
  /** Cuts this stretch of the recording out (a phrase said twice: the first try). */
  cut(range: Range): void
  /** Puts this stretch of the recording back in (an "um" that was a word). */
  putBack(range: Range): void
}

/** Which line each word goes on, from where it starts on the timeline: the
 *  first where it clears the word before it on that line, or the one that
 *  ends earliest when none does. */
function wordLines(words: readonly { x: number; text: string }[]): number[] {
  const ends = Array.from({ length: WORD_LINES }, () => -Infinity)
  return words.map((w) => {
    let line = ends.findIndex((end) => end + 6 <= w.x)
    if (line < 0) line = ends.indexOf(Math.min(...ends))
    ends[line] = w.x + w.text.length * LETTER_PX
    return line
  })
}

/** A trim of a clip's start being dragged: that clip and the ones after it
 *  stay where the finger has them until it lets go, so the arrow stays
 *  under the finger - then they close up, as in TikTok. */
export interface ClipShift {
  from: number
  px: number
}

/** The clips as TikTok shows them - what plays, back to back, the cut bits
 *  hidden - each a row of small frames with his words under it; the one
 *  he tapped framed in white with an arrow at each end to drag. Only the
 *  frames around what is on screen are laid out. */
const Track = memo(function Track({
  keep,
  px,
  selected,
  words,
  checks,
  strip,
  shift,
  from,
  to,
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
  strip: Filmstrip
  shift: ClipShift | null
  /** What is on screen, in seconds of the video. */
  from: number
  to: number
  focus: number | null
  onFlag: (i: number) => void
  onSelect: (i: number | null) => void
  onHandleDown: (i: number, edge: 'start' | 'end', down: ReactPointerEvent<HTMLSpanElement>) => void
}) {
  const clips = useMemo(() => clipsOf(keep), [keep])
  const left = (i: number) => clips[i].at * px + (shift && i >= shift.from ? shift.px : 0)
  const said = useMemo(() => {
    const kept = words.filter((w) => partAt(keep, (w.start + w.end) / 2) >= 0).map((w) => ({ text: w.text, x: outputTime(keep, w.start) * px }))
    const lines = wordLines(kept)
    return kept.map((w, i) => ({ ...w, line: lines[i] }))
  }, [words, keep, px])
  const tile = THUMB.width
  return (
    <>
      {keep.map((part, i) => {
        const clip = clips[i]
        const width = clip.length * px
        // The frames of this clip that are on screen.
        const first = Math.max(0, Math.floor(((from - clip.at) * px) / tile))
        const last = Math.min(Math.ceil(width / tile) - 1, Math.floor(((to - clip.at) * px) / tile))
        const tiles: { k: number; src: string | null }[] = []
        for (let k = first; k <= last; k++) tiles.push({ k, src: frameAt(strip, part.start + (k * tile + tile / 2) / px) })
        return (
          <div
            // By place, not by times: a clip being trimmed keeps its element,
            // and with it the finger on its arrow.
            key={i}
            className={`tl-clip${selected === i ? ' on' : ''}`}
            style={{ left: left(i), width, top: CLIP_TOP, height: CLIP_H }}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(selected === i ? null : i)
            }}
          >
            <div className="tl-frames">
              {tiles.map(({ k, src }) =>
                src ? <img key={k} alt="" src={src} draggable={false} style={{ left: k * tile }} /> : <span key={k} className="tl-frame-empty" style={{ left: k * tile }} />,
              )}
            </div>
            {selected === i ? (
              <>
                <span className="tl-handle start" role="slider" aria-label="Drag to trim the start" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => onHandleDown(i, 'start', e)}>
                  <svg viewBox="0 0 10 16" aria-hidden>
                    <path d="M7 2 2 8l5 6" />
                  </svg>
                </span>
                <span className="tl-handle end" role="slider" aria-label="Drag to trim the end" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => onHandleDown(i, 'end', e)}>
                  <svg viewBox="0 0 10 16" aria-hidden>
                    <path d="m3 2 5 6-5 6" />
                  </svg>
                </span>
              </>
            ) : null}
          </div>
        )
      })}
      {checks.map((c, i) => {
        // Only the ones in the video: a cut one is in the list under it.
        if (partAt(keep, (c.start + c.end) / 2) < 0 || c.kind === 'noise') return null
        return (
          <button
            key={`flag-${i}`}
            type="button"
            aria-label={`Check at ${formatPrecise(outputTime(keep, c.start))}`}
            className={`tl-flag${focus === i ? ' on' : ''}`}
            style={{ left: outputTime(keep, c.start) * px, width: Math.max(10, (c.end - c.start) * px), top: CLIP_TOP - 6 }}
            onClick={(e) => {
              e.stopPropagation()
              onFlag(i)
            }}
          />
        )
      })}
      {said.map((w, i) =>
        w.x < from * px - 200 || w.x > to * px + 200 ? null : (
          <span key={`${w.x}-${i}`} className="tl-word" style={{ left: w.x, top: WORD_TOP + w.line * 16 }}>
            {w.text}
          </span>
        ),
      )}
    </>
  )
})

/** One thing on the timeline's rows: words, a picture or a video he put on,
 *  or the headline - where it comes up in the video and for how long. */
export interface Bar {
  id: string
  at: number
  seconds: number
  kind: 'words' | 'picture' | 'video' | 'headline' | 'sound'
  label: string
  thumb?: string
}

/** What a finger on a bar does: moves it, or drags one of its ends. */
export type BarGrip = 'move' | 'start' | 'end'

/** How near a bar's end a finger has to land to stretch it, in px. */
const BAR_EDGE_PX = 16
/** How wide a picture he puts on starts, in % of the video's width. */
const NEW_PICTURE_PCT = 60

/** The rows under the clips, as in TikTok: one bar for each thing put on the
 *  video, in the first row free at its time. A finger on any bar moves it
 *  straight away - no tap first (his ask, 2026-11-12: "I don't have to click
 *  it to drag and drop the overlay") - and on its end, stretches it. The one
 *  he tapped has an arrow at each end. */
function Bars({
  bars,
  px,
  top,
  selected,
  onSelect,
  onGrip,
}: {
  bars: Bar[]
  px: number
  /** Where its first row is. */
  top: number
  selected: string | null
  onSelect: (id: string) => void
  onGrip: (id: string, grip: BarGrip, down: ReactPointerEvent<HTMLElement>) => void
}) {
  const { row } = overlayRows(bars)
  return (
    <>
      {bars.map((b) => {
        const on = b.id === selected
        const movable = b.kind !== 'headline'
        return (
          <div
            key={b.id}
            role="button"
            aria-label={`${b.label} at ${formatPrecise(b.at)}`}
            className={`tl-bar ${b.kind}${on ? ' on' : ''}${movable ? ' movable' : ''}`}
            style={{ left: b.at * px, width: Math.max(28, b.seconds * px), top: top + (row.get(b.id) ?? 0) * ROW_H }}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(b.id)
            }}
            onPointerDown={
              movable
                ? (e) => {
                    // Its ends stretch it, its middle moves it.
                    const box = e.currentTarget.getBoundingClientRect()
                    const edge = Math.min(BAR_EDGE_PX, box.width / 4)
                    onGrip(b.id, e.clientX - box.left < edge ? 'start' : box.right - e.clientX < edge ? 'end' : 'move', e)
                  }
                : undefined
            }
          >
            {b.thumb ? <img alt="" src={b.thumb} draggable={false} /> : null}
            <span className="tl-bar-label">{b.label}</span>
            {movable && on ? (
              <>
                <span className="tl-bar-end start" aria-label="Drag to change when it starts" onPointerDown={(e) => onGrip(b.id, 'start', e)}>
                  <svg viewBox="0 0 10 16" aria-hidden>
                    <path d="M7 2 2 8l5 6" />
                  </svg>
                </span>
                <span className="tl-bar-end end" aria-label="Drag to change how long it stays" onPointerDown={(e) => onGrip(b.id, 'end', e)}>
                  <svg viewBox="0 0 10 16" aria-hidden>
                    <path d="M3 2l5 6-5 6" />
                  </svg>
                </span>
              </>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

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
  um: 'An "um"',
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
function kindOf(o: ManualPicture): 'Words' | 'Video' | 'Picture' | 'Sound' {
  return isText(o) ? 'Words' : isSound(o) ? 'Sound' : isVideo(o) ? 'Video' : 'Picture'
}

/** A small look at a thing put on the video: a picture's image, a sign for
 *  a video, the first of the words. */
function Thumb({ o, url }: { o: ManualPicture; url?: string }) {
  if (o.source.kind === 'text') return <span className="pic-glyph words">{o.source.text.trim().slice(0, 12) || 'Aa'}</span>
  if (isVideo(o)) return <span className="pic-glyph">▶</span>
  if (isSound(o)) return <span className="pic-glyph">♪</span>
  return url ? <img alt="" src={url} /> : <span className="pic-missing">?</span>
}

/** A button of the toolbar along the bottom: an icon over its word, as in
 *  TikTok's editor. */
function ToolButton({ label, icon, onClick, disabled = false, active = false }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" className={`tl-tool${active ? ' on' : ''}`} aria-label={label} disabled={disabled} onClick={onClick}>
      <span className="tl-tool-icon">
        <svg viewBox="0 0 24 24" aria-hidden>
          {icon}
        </svg>
      </span>
      <span>{label}</span>
    </button>
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
  noiseNote,
  overlays: initialOverlays = [],
  bank = NO_PICTURES,
  defaults,
  loadImage,
  videoBank = NO_VIDEOS,
  loadVideo,
  loadSound,
  headline,
  onDone,
  onCaptions,
  onCancel,
  paintOver,
  below,
  onCaptionsTool,
  onState,
  control,
  headActions,
  typing = false,
  quick = false,
  muteOwn = false,
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
  /** The sound's loudness over the recording (the timeline shows frames now; kept for callers). */
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
  /** A sound's file, to hear it while playing: from the music bank, or kept
   *  with the video. */
  loadSound?: (sound: ManualPicture) => Promise<Blob | null>
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
  /** The toolbar's Captions: opens the captions' sheet (CaptionSheet.tsx).
   *  Absent: it scrolls down to what is below. */
  onCaptionsTool?: () => void
  /** Every change to the cuts and pictures, as it happens. */
  onState?: (keep: Range[], overlays: ManualPicture[], newFiles: Map<string, Blob>) => void
  control?: MutableRefObject<CutsControl | null>
  /** In place of Captions and Done, at the top. */
  headActions?: ReactNode
  /** He is typing below: the video is made smaller to leave room. */
  typing?: boolean
  /** The quick check (EditScreen): only the video, big - the timeline and
   *  its tools stay hidden until he asks for the timeline editor. */
  quick?: boolean
  /** A reaction (no talking): the finished video has only its music, so
   *  its own sound isn't played here either. */
  muteOwn?: boolean
}) {
  const [keep, setKeep] = useState(initial)
  // Undo and redo (the arrows at the top): the cuts and what is over the
  // video, as they were before each change.
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  /** A change is about to be made: how things were, for Undo. */
  const record = (before: Snapshot) => {
    setPast((h) => [...h.slice(-49), before])
    setFuture([])
  }
  const [t, setT] = useState(initial[0]?.start ?? 0)
  const [px, setPx] = useState(START_PX)
  const [selected, setSelected] = useState<number | null>(null)
  const [shift, setShift] = useState<ClipShift | null>(null)
  const [playing, setPlaying] = useState(false)
  const [aspect, setAspect] = useState(9 / 16)
  const [url, setUrl] = useState<string | null>(null)
  const [viewWidth, setViewWidth] = useState(400)
  const [focus, setFocus] = useState<number | null>(null)
  const [overlays, setOverlays] = useState<ManualPicture[]>(initialOverlays)
  const [picking, setPicking] = useState(false)
  /** Add sound's picker open. */
  const [soundPicking, setSoundPicking] = useState(false)
  const soundEls = useRef(new Map<string, HTMLAudioElement>())
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
    /** How things stood before it was picked up, for Undo. */
    before: Snapshot
  } | null>(null)
  /** The middle lines shown while something sits on them. */
  const [guides, setGuides] = useState(NO_GUIDES)
  const guidesRef = useRef(guides)
  guidesRef.current = guides
  /** The video filling the screen, as it will post. */
  const [full, setFull] = useState(false)
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
  const track = useRef<HTMLDivElement>(null)
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

  const repaintRef = useRef(repaint)
  repaintRef.current = repaint

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

  // Dark behind it too, like TikTok's editor, whatever the phone's setting.
  useEffect(() => {
    document.documentElement.classList.add('editor-dark')
    return () => document.documentElement.classList.remove('editor-dark')
  }, [])

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
  const film = useFilmstrip(file, duration)
  const inPart = partAt(keep, t)
  const total = totalDuration(keep)

  // --- The video: one frame asked for at a time, always the latest place.
  // While his finger moves the timeline, the nearest frame the phone can
  // show at once (fastSeek - Safari's key-frame seek); the exact frame once it
  // stops. Asking for exact frames all the way was what made it lag.
  const seeking = useRef({ busy: false, want: null as number | null, since: 0, fast: false })
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
    if (s.fast && typeof v.fastSeek === 'function') v.fastSeek(to)
    else v.currentTime = to
  }, [duration])
  const seek = useCallback(
    (to: number) => {
      seeking.current.want = to
      seeking.current.fast = false
      pumpSeek()
    },
    [pumpSeek],
  )
  /** A quick frame now, the exact one when he stops. */
  const settleSeek = useRef(0)
  const scrub = useCallback(
    (to: number) => {
      seeking.current.want = to
      seeking.current.fast = true
      pumpSeek()
      window.clearTimeout(settleSeek.current)
      settleSeek.current = window.setTimeout(() => seek(tRef.current), 140)
    },
    [pumpSeek, seek],
  )
  useEffect(() => () => window.clearTimeout(settleSeek.current), [])

  // --- The timer and buttons: at most once a frame while he scrolls.
  // While he scrolls, only the timer, what is drawn over the video and the
  // captions below follow each frame; the rest of the screen catches up when
  // he stops. Playing, everything follows (videos over him start and stop).
  const showTime = useRef(0)
  const idleTime = useRef(0)
  const timer = useRef<HTMLSpanElement>(null)
  const followTime = useCallback((to: number) => {
    tRef.current = to
    if (showTime.current) return
    showTime.current = requestAnimationFrame(() => {
      showTime.current = 0
      if (playingRef.current) {
        setT(tRef.current)
        return
      }
      const k = keepRef.current
      if (timer.current) timer.current.textContent = `${formatPrecise(outputTime(k, tRef.current))} / ${formatPrecise(totalDuration(k))}`
      repaintRef.current()
      for (const listener of listeners.current) listener(tRef.current, false)
      window.clearTimeout(idleTime.current)
      idleTime.current = window.setTimeout(() => setT(tRef.current), 120)
    })
  }, [])
  useEffect(
    () => () => {
      cancelAnimationFrame(showTime.current)
      window.clearTimeout(idleTime.current)
    },
    [],
  )

  // The captions over the video, and whoever follows the playhead.
  useEffect(() => {
    repaint()
    for (const listener of listeners.current) listener(t, playingRef.current)
  }, [t, playing, repaint, aspect, typing])

  useEffect(() => {
    onState?.(keep, withWords(overlays), newFiles.current)
  }, [keep, overlays]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Puts raw moment `to` under the playhead by scrolling the timeline
   *  there - the timeline shows only what plays, so where it is in the video. */
  const scrollTo = useCallback((to: number) => {
    const s = strip.current
    if (s) s.scrollLeft = outputTime(keepRef.current, to) * pxRef.current
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
    const k = keepRef.current
    let to = sourceAt(k, Math.max(0, s.scrollLeft / pxRef.current))
    // Past the last frame: on it.
    if (partAt(k, to) < 0 && k.length > 0) to = Math.max(k[k.length - 1].start, k[k.length - 1].end - 0.001)
    followTime(to)
    scrub(to)
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
        else if (source.kind === 'sound')
          blob = source.from === 'effect' ? effectFile(source.ref as MotionSound) : (newFiles.current.get(o.id) ?? (await loadSound?.(o).catch(() => null)))
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
  }, [overlays, bank, loadImage, loadVideo, loadSound, urls])
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
      // Big enough to see and to grab (his ask, 2026-11-12: "it's pretty
      // small and hard to click"), in the middle, where a finger finds it.
      position: 'middle',
      widthPct: Math.max(NEW_PICTURE_PCT, defaults?.widthPct ?? 0),
    }
    const placed = isVideo(picture)
      ? { ...picture, position: 'middle' as const, widthPct: 70, ...(length ? { length, seconds: Math.round(Math.min(length, longestFor({ ...picture, length })) * 10) / 10 } : {}) }
      : picture
    record(now())
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
    record(now())
    setOverlays((list) => [...list, words].sort((a, b) => a.at - b.at))
    setSelectedPic(id)
    setNewText(id)
    setPicking(false)
    setPicNote(null)
  }

  /** A sound at the playhead: an effect for its own length, a song or a file
   *  of his to the end of the video (or of itself). */
  const addSound = ({ source, length, file }: PickedSound) => {
    const id = newPictureId()
    if (file) newFiles.current.set(id, file)
    const left = Math.max(PICTURE_SECONDS.min, totalDuration(keepRef.current) - outputTime(keepRef.current, tRef.current))
    const own = length ?? 10
    const sound: ManualPicture = {
      id,
      source,
      at: Math.round(tRef.current * 100) / 100,
      seconds: Math.round(Math.max(PICTURE_SECONDS.min, source.from === 'effect' ? own : Math.min(own, left)) * 10) / 10,
      position: 'middle',
      widthPct: 0,
      ...(length ? { length } : {}),
    }
    record(now())
    setOverlays((list) => [...list, sound].sort((a, b) => a.at - b.at))
    setSelectedPic(id)
    setSoundPicking(false)
    setPicking(false)
  }

  const updatePicture = (id: string, patch: Partial<ManualPicture>) => {
    record(now())
    setOverlays((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)).sort((a, b) => a.at - b.at))
  }
  const setWords = (id: string, patch: { text?: string; style?: HeadlineStyle }) =>
    setOverlays((list) => list.map((o) => (o.id === id && o.source.kind === 'text' ? { ...o, source: { ...o.source, ...patch } } : o)))
  const removePicture = (id: string) => {
    record(now())
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
  /** A tap on a bar: it is picked, and the playhead stays where he left it
   *  (his ask, 2026-11-12: jumping to its start lost his place). */
  const pickPicture = (o: ManualPicture) => {
    setSelected(null)
    setSelectedPic(o.id)
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
  const shown = overlays.filter((o) => !isText(o) && !isSound(o) && (upAt(o) || o.id === selectedPic))
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

  // His sounds play along while the video plays, each from its moment, at
  // its volume; still, they are quiet.
  useEffect(() => {
    for (const o of overlays) {
      if (!isSound(o)) continue
      const el = soundEls.current.get(o.id)
      if (!el) continue
      el.volume = Math.min(1, 10 ** (o.source.volumeDb / 20))
      const local = outT - outputTime(keep, o.at)
      if (!playing || local < 0 || local >= o.seconds) {
        if (!el.paused) el.pause()
        continue
      }
      if (el.paused) {
        el.currentTime = local
        void el.play().catch(() => {})
      } else if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local
    }
  }, [outT, playing, overlays, keep])

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
    gesture.current = {
      id,
      pointers: points,
      from: { ...hold, mid, spread },
      moved: gesture.current?.id === id ? gesture.current.moved : false,
      before: gesture.current?.id === id ? gesture.current.before : now(),
    }
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
    // Near the middle, it sits exactly on it, and the line shows.
    const onX = Math.abs(center.x - 0.5) < CENTER_SNAP
    const onY = Math.abs(center.y - 0.5) < CENTER_SNAP
    if (onX) center.x = 0.5
    if (onY) center.y = 0.5
    if (onX !== guidesRef.current.x || onY !== guidesRef.current.y) setGuides({ x: onX, y: onY })
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
      setGuides(NO_GUIDES)
      if (g.id === HEADLINE && g.moved) headline?.onPlace(headlinePlaceRef.current)
      else if (g.moved) record(g.before)
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
    v.muted = muteOwn
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
    record({ keep, overlays: overlaysRef.current })
    setKeep(next)
    setSelected(null)
  }

  const now = (): Snapshot => ({ keep: keepRef.current, overlays: overlaysRef.current })
  const restore = (to: Snapshot) => {
    setKeep(to.keep)
    setOverlays(to.overlays)
    setSelected(null)
  }
  const undo = () => {
    const previous = past[past.length - 1]
    if (!previous) return
    setPast((h) => h.slice(0, -1))
    setFuture((f) => [...f, now()])
    restore(previous)
  }
  const redo = () => {
    const next = future[future.length - 1]
    if (!next) return
    setFuture((f) => f.slice(0, -1))
    setPast((h) => [...h, now()])
    restore(next)
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
    v.muted = muteOwn
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
      cut: (range: Range) => change(cutOut(keep, range)),
      putBack: (range: Range) => change(putBack(keep, range)),
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

  /** Drags one end of the selected clip - inward trims it, outward brings
   *  back what was cut there, never past the next clip's footage. */
  const handleDown = useRef<(i: number, edge: 'start' | 'end', down: ReactPointerEvent<HTMLSpanElement>) => void>(() => {})
  handleDown.current = (i, edge, down) => {
    down.preventDefault()
    down.stopPropagation()
    takeOver()
    const handle = down.currentTarget
    handle.setPointerCapture(down.pointerId)
    const before = keepRef.current
    const beforeOverlays = overlaysRef.current
    let last = before
    let drawn = 0
    const x0 = down.clientX
    const at0 = edge === 'start' ? before[i].start : before[i].end
    const move = (event: PointerEvent) => {
      const scale = pxRef.current
      const to = snapTo(at0 + (event.clientX - x0) / scale, edges, SNAP_PX / scale)
      last = trimPart(before, i, edge, to, duration)
      if (!drawn) {
        drawn = requestAnimationFrame(() => {
          drawn = 0
          keepRef.current = last
          setKeep(last)
          // The start's arrow stays under the finger until it lets go.
          setShift(edge === 'start' ? { from: i, px: (last[i].start - before[i].start) * pxRef.current } : null)
        })
      }
      scrub(edge === 'start' ? last[i].start : last[i].end - 0.001)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      cancelAnimationFrame(drawn)
      keepRef.current = last
      setKeep(last)
      setShift(null)
      if (last !== before) record({ keep: before, overlays: beforeOverlays })
      // The playhead on the end he moved, as TikTok leaves it.
      const at = edge === 'start' ? last[i].start : Math.max(last[i].start, last[i].end - 0.001)
      requestAnimationFrame(() => {
        scrollTo(at)
        followTime(at)
        seek(at)
      })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const onHandleDown = useCallback(
    (i: number, edge: 'start' | 'end', down: ReactPointerEvent<HTMLSpanElement>) => handleDown.current(i, edge, down),
    [],
  )

  /** A finger on a bar of the rows: its middle moves it along the video, its
   *  ends change when it comes up and how long it stays. */
  /** When a bar was last let go of after a drag: that letting go isn't a tap. */
  const gripped = useRef(0)
  const onGrip = (id: string, grip: BarGrip, down: ReactPointerEvent<HTMLElement>) => {
    const o = overlaysRef.current.find((x) => x.id === id)
    if (!o) return
    down.preventDefault()
    down.stopPropagation()
    takeOver()
    setSelected(null)
    setSelectedPic(id)
    const el = down.currentTarget
    el.setPointerCapture?.(down.pointerId)
    const k = keepRef.current
    const total = totalDuration(k)
    const before = now()
    const out0 = outputTime(k, o.at)
    const x0 = down.clientX
    let moved = false
    const move = (event: PointerEvent) => {
      const dx = (event.clientX - x0) / pxRef.current
      if (!moved && Math.abs(event.clientX - x0) < 4) return
      moved = true
      const longest = longestFor(o)
      let out = out0
      let seconds = o.seconds
      if (grip === 'move') out = Math.min(Math.max(0, out0 + dx), Math.max(0, total - 0.1))
      else if (grip === 'end') seconds = Math.min(longest, Math.max(PICTURE_SECONDS.min, o.seconds + dx))
      else {
        out = Math.min(Math.max(0, out0 + dx), out0 + o.seconds - PICTURE_SECONDS.min)
        seconds = Math.min(longest, o.seconds - (out - out0))
      }
      const at = Math.round(sourceAt(k, out) * 100) / 100
      const next = { ...o, at, seconds: Math.round(seconds * 10) / 10 }
      setOverlays((list) => list.map((x) => (x.id === id ? next : x)).sort((a, b) => a.at - b.at))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) {
        record(before)
        gripped.current = performance.now()
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // Pinching the timeline zooms it, around the playhead. Safari says how far
  // the fingers have spread. While the fingers move, the timeline is only
  // stretched (the phone's graphics do it, smooth); when they let go it is
  // laid out again at the new zoom. Laying all of it out on every move was
  // what made zooming lag (2026-11-02).
  useEffect(() => {
    const s = strip.current
    if (!s) return
    let from = pxRef.current
    let wanted = from
    let pinching = false
    const start = (e: Event) => {
      e.preventDefault()
      takeOverRef.current()
      from = pxRef.current
      wanted = from
      pinching = true
      const t = track.current
      if (t) t.style.transformOrigin = `${s.scrollLeft + s.clientWidth / 2}px 0`
    }
    const change = (e: Event) => {
      e.preventDefault()
      if (!pinching) return
      const scale = (e as Event & { scale?: number }).scale ?? 1
      wanted = clampPx(from * scale)
      const t = track.current
      if (t) t.style.transform = `scaleX(${wanted / from})`
    }
    const end = (e: Event) => {
      e.preventDefault()
      if (!pinching) return
      pinching = false
      const t = track.current
      if (t) t.style.transform = ''
      setPx(wanted)
    }
    s.addEventListener('gesturestart', start)
    s.addEventListener('gesturechange', change)
    s.addEventListener('gestureend', end)
    return () => {
      s.removeEventListener('gesturestart', start)
      s.removeEventListener('gesturechange', change)
      s.removeEventListener('gestureend', end)
    }
  }, [])

  // Anywhere else on the editor, a pinch does nothing: the whole page zoomed
  // in when one began off the timeline (iPhone Safari ignores the page's own
  // "no zooming"). Pictures and words on the video take their pinch from the
  // fingers themselves (pointer events), not from this.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', block)
    document.addEventListener('gesturechange', block)
    return () => {
      document.removeEventListener('gesturestart', block)
      document.removeEventListener('gesturechange', block)
    }
  }, [])


  // The marks and frames around what is on screen, in steps of half a
  // screen, so they are laid out again only as he moves on - not on every
  // scroll. In seconds of the video, as the timeline shows it.
  const chunk = Math.max(viewWidth / 2 / px, 0.01)
  const around = Math.floor(outT / chunk)
  const marksFrom = Math.max(0, (around - 2) * chunk)
  const marksTo = Math.min(total, (around + 3) * chunk)
  // The rows: the headline, then each thing he put on, where it comes up.
  const bars: Bar[] = [
    ...(headlineLayout && headline ? [{ id: HEADLINE, at: 0, seconds: Math.min(total, headline.seconds), kind: 'headline' as const, label: headline.look.text.trim() || 'Headline' }] : []),
    ...overlays
      .filter((o) => !isSound(o))
      .map((o): Bar => ({
        id: o.id,
        at: outputTime(keep, o.at),
        seconds: o.seconds,
        kind: isText(o) ? 'words' : isVideo(o) ? 'video' : 'picture',
        label: o.source.kind === 'text' ? o.source.text.trim() || 'Aa' : isVideo(o) ? 'Video' : 'Picture',
        ...(urls[o.id] && !isText(o) && !isVideo(o) ? { thumb: urls[o.id] } : {}),
      })),
  ]
  // The sounds in their own lane right under the clips, as TikTok has its
  // "Add sound" there.
  const soundBars = overlays.filter(isSound).map((o): Bar => ({ id: o.id, at: outputTime(keep, o.at), seconds: o.seconds, kind: 'sound', label: `♪ ${o.source.name}` }))
  const soundRows = overlayRows(soundBars).rows
  const rowCount = soundRows + overlayRows(bars).rows
  const openSounds = () => {
    stop()
    setSelected(null)
    setSelectedPic(null)
    setPicking(false)
    setSoundPicking((on) => !on)
  }
  // The toolbar along the bottom: what can be done to the clip he tapped, to
  // the thing he tapped, or - nothing tapped - what can be put on.
  const clipTapped = selected !== null && selected < keep.length ? selected : null
  const done = () => onDone(keep, withWords(overlays), newFiles.current)
  const belowRef = useRef<HTMLDivElement>(null)
  const checksRef = useRef<HTMLDivElement>(null)
  const toView = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const asking = checks.filter((c) => c.kind !== 'noise').length

  return (
    <section className={`screen cuts tiktok${typing ? ' typing' : ''}${quick ? ' quick' : ''}${full ? ' full' : ''}`} aria-label={`Cuts for ${name}`}>
      <div className="review-top" ref={top}>
        <div className="review-head">
          <button type="button" className="tl-round" aria-label="Back" onClick={onCancel}>
            <ChevronLeft />
          </button>
          <div className="cuts-head-actions">
            {quick ? (
              <button
                type="button"
                className="icon-btn"
                aria-label="Full screen"
                onClick={() => {
                  setFull(true)
                  if (!playingRef.current) play()
                }}
              >
                <FullIcon />
              </button>
            ) : null}
            {headActions !== undefined ? headActions : onCaptions ? (
              <button type="button" className="btn small" onClick={() => onCaptions(keep, withWords(overlays), newFiles.current)}>
                Captions
              </button>
            ) : null}
            {headActions !== undefined ? null : (
              <button type="button" className="tl-round tl-next" aria-label="Done" onClick={done}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
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
          {guides.x ? <span className="cuts-guide v" aria-hidden /> : null}
          {guides.y ? <span className="cuts-guide h" aria-hidden /> : null}
          {full ? (
            <button
              type="button"
              className="cuts-full-close"
              aria-label="Close full screen"
              onClick={(e) => {
                e.stopPropagation()
                stop()
                setFull(false)
              }}
            >
              ✕
            </button>
          ) : null}
          {inPart < 0 ? <span className="cuts-out">Cut out</span> : null}
          {url ? (
            <span className={`review-playing${playing ? ' is-playing' : ''}`} aria-hidden>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </span>
          ) : null}
        </div>
      </div>

      <div className="tl-bar-row">
        <span className="review-count cuts-timer" ref={timer}>
          {formatPrecise(outputTime(keep, t))} / {formatPrecise(total)}
        </span>
        <button type="button" className="tl-play" aria-label={playing ? 'Pause' : 'Play'} onClick={play}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span className="tl-bar-tools">
          <button type="button" className="icon-btn" aria-label="Undo" disabled={past.length === 0} onClick={undo}>
            <UndoIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="Redo" disabled={future.length === 0} onClick={redo}>
            <RedoIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Full screen"
            onClick={() => {
              setFull(true)
              if (!playingRef.current) play()
            }}
          >
            <FullIcon />
          </button>
        </span>
      </div>

      <div className="cuts-strip-wrap">
        <div className="cuts-strip" ref={strip} onScroll={onScroll} onTouchStart={takeOver} onWheel={takeOver}>
          <div className="cuts-track" ref={track}>
            <div
              className="cuts-ruler"
              ref={ruler}
              style={{ width: Math.max(1, total * px), height: ROWS_TOP + rowCount * ROW_H + 8 }}
              onClick={() => {
                setSelected(null)
                setSelectedPic(null)
              }}
            >
              <Marks px={px} from={marksFrom} to={marksTo} />
              <Track
                keep={keep}
                px={px}
                selected={clipTapped}
                words={words}
                checks={checks}
                strip={film}
                shift={shift}
                from={marksFrom}
                to={marksTo}
                focus={focus}
                onFlag={goTo}
                onSelect={(i) => {
                  setSelectedPic(null)
                  setSelected(i)
                }}
                onHandleDown={onHandleDown}
              />
              <Bars
                bars={soundBars}
                px={px}
                top={ROWS_TOP}
                selected={selectedPic}
                onSelect={(id) => {
                  if (performance.now() - gripped.current < 400) return
                  const o = overlays.find((x) => x.id === id)
                  if (o) pickPicture(o)
                }}
                onGrip={onGrip}
              />
              {soundBars.length === 0 ? (
                <button
                  type="button"
                  className="tl-add-sound"
                  style={{ top: ROWS_TOP }}
                  onClick={(e) => {
                    e.stopPropagation()
                    openSounds()
                  }}
                >
                  ♪ Add sound
                </button>
              ) : null}
              <Bars
                bars={bars}
                px={px}
                top={ROWS_TOP + soundRows * ROW_H}
                selected={selectedPic}
                onSelect={(id) => {
                  if (performance.now() - gripped.current < 400) return
                  const o = overlays.find((x) => x.id === id)
                  if (id === HEADLINE) {
                    setSelected(null)
                    setSelectedPic(HEADLINE)
                  } else if (o) pickPicture(o)
                }}
                onGrip={onGrip}
              />
            </div>
          </div>
        </div>
        <span className="cuts-playhead" aria-hidden />
      </div>

      <nav className="tl-tools" aria-label={clipTapped !== null ? 'This clip' : selectedPic ? 'What you tapped' : 'Add to the video'}>
        {clipTapped !== null ? (
          <>
            <ToolButton label="Back" onClick={() => setSelected(null)} icon={<path d="M15 5l-7 7 7 7" />} />
            <ToolButton
              label="Split"
              // At the playhead, which has to be on the clip he tapped.
              disabled={partAt(keep, t) !== clipTapped}
              onClick={() => change(splitAt(keep, tRef.current))}
              icon={
                <>
                  <circle cx="6" cy="18" r="2.5" />
                  <circle cx="6" cy="6" r="2.5" />
                  <path d="M8 7.5 20 17M8 16.5 20 7" />
                </>
              }
            />
            <ToolButton
              label="Delete"
              disabled={keep.length === 1}
              onClick={() => change(keep.filter((_, k) => k !== clipTapped))}
              icon={<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />}
            />
          </>
        ) : selectedPic ? (
          <>
            <ToolButton label="Done" onClick={() => setSelectedPic(null)} icon={<path d="M5 12l5 5 9-10" />} />
            {selectedPic !== HEADLINE ? (
              <ToolButton label="Delete" onClick={() => removePicture(selectedPic)} icon={<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />} />
            ) : null}
          </>
        ) : (
          <>
            <ToolButton label="Text" onClick={addText} icon={<text x="3" y="17" fontSize="14" fontWeight="600" fill="currentColor" stroke="none">Aa</text>} />
            <ToolButton
              label="Overlay"
              active={picking}
              onClick={togglePicker}
              icon={
                <>
                  <rect x="4" y="4" width="12" height="12" rx="2" />
                  <path d="M20 9v9a2 2 0 0 1-2 2H9" />
                </>
              }
            />
            <ToolButton
              label="Sound"
              active={soundPicking}
              onClick={openSounds}
              icon={
                <>
                  <path d="M9 18V6l10-2v12" />
                  <circle cx="6.5" cy="18" r="2.5" />
                  <circle cx="16.5" cy="16" r="2.5" />
                </>
              }
            />
            {below ? (
              <ToolButton
                label="Captions"
                onClick={() => (onCaptionsTool ? onCaptionsTool() : toView(belowRef.current))}
                icon={
                  <>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M7 12h4M13 12h4M7 15h10" />
                  </>
                }
              />
            ) : null}
            {headlineLayout ? <ToolButton label="Headline" onClick={goToHeadline} icon={<path d="M6 5v14M18 5v14M6 12h12" />} /> : null}
            {asking > 0 ? (
              <ToolButton
                label={`Check ${asking}`}
                onClick={() => toView(checksRef.current)}
                icon={
                  <>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v6M12 16.5v.5" />
                  </>
                }
              />
            ) : null}
          </>
        )}
      </nav>

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
              {kindOf(selectedPicture)} at {formatPrecise(outputTime(keep, selectedPicture.at))}
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
          {isSound(selectedPicture) ? (
            <>
              <label className="slider">
                <span>Volume</span>
                <input
                  type="range"
                  min={SOUND_DB.min}
                  max={SOUND_DB.max}
                  step={1}
                  value={selectedPicture.source.volumeDb}
                  aria-label="How loud the sound is"
                  onChange={(e) => {
                    const volumeDb = Number(e.target.value)
                    const source = selectedPicture.source
                    if (source.kind === 'sound') updatePicture(selectedPicture.id, { source: { ...source, volumeDb } })
                  }}
                />
                <output>{selectedPicture.source.volumeDb > 0 ? '+' : ''}{selectedPicture.source.volumeDb} dB</output>
              </label>
              <p className="hint">Plays over your voice from where its bar starts. Drag the bar to move it, its ends to make it shorter or longer.</p>
            </>
          ) : (
            <p className="hint">
              Drag its bar to move it, its arrows to make it longer or shorter. {isText(selectedPicture) ? 'Drag them' : 'Drag it'} on the
              video to move {isText(selectedPicture) ? 'them' : 'it'}, pinch to make {isText(selectedPicture) ? 'them' : 'it'} bigger or smaller.
              {isVideo(selectedPicture) ? ' Plays without its sound.' : ''}
            </p>
          )}
          <div className="actions-row">
            <button type="button" className="btn small danger" onClick={() => removePicture(selectedPicture.id)}>
              Delete {kindOf(selectedPicture).toLowerCase()}
            </button>
          </div>
        </div>
      ) : null}
      {soundPicking ? <SoundPicker at={formatPrecise(outT)} onPick={addSound} onClose={() => setSoundPicking(false)} /> : null}
      {overlays.filter(isSound).map((o) =>
        urls[o.id] ? (
          <audio
            key={o.id}
            ref={(el) => {
              if (el) soundEls.current.set(o.id, el)
              else soundEls.current.delete(o.id)
            }}
            src={urls[o.id]}
            preload="auto"
            hidden
          />
        ) : null,
      )}
      {picNote ? (
        <p className="hint warn-text" ref={notePanel}>
          {picNote}
        </p>
      ) : null}
      {picking ? (
        <div className="pic-picker" ref={picPanel}>
          <div className="group-title">Put on at {formatPrecise(outT)}</div>
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

      {below ? <div ref={belowRef}>{below}</div> : null}

      <p className="hint cuts-hint tip">
        Slide the timeline to move through the video, pinch it to zoom. Tap a clip, then drag its arrows: inward to trim, outward to bring back what was cut.
      </p>
      {noiseNote ? <p className="hint warn-text">{noiseNote}</p> : null}
      {checks.length > 0 ? (
        <div className="cuts-checks" ref={checksRef}>
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
