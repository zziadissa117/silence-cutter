// Checking a video's captions before it is made, the way TikTok's own
// caption editor shows them: the video up top with the caption drawn on it
// exactly as it will be burned in, and every phrase in a list under it, each
// one a box to type straight into. Tapping a phrase shows its frame; its
// play button runs the video from there with the captions popping in.
// Approving sends it to be made; if the captions are no good it can be made
// without them.
//
// Only the video is held at the top. Where the captions sit, how big they
// are, the headline and what is joined on come after the phrases: held at
// the top with the video they filled a phone's screen, and the phrases
// scrolled by out of sight behind them.
//
// The frame is the phone's own video player, not the page's decoder, and
// nothing is made while this is open - see CampaignApp - so the two never
// compete for the phone's video hardware.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  CAPTION_LEAD,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  CAPTION_STYLES,
  captionAt,
  drawStyledCaption,
  captionRanges,
  phrasesOf,
  retimePhrase,
  type CaptionPosition,
  type CaptionSize,
  type CaptionSpot,
  type CaptionStyle,
  type CaptionWord,
  PHRASE_HOLD_SEC,
} from './captions'
import { centsLabel, estimateRecheckCents, flaggedPhrases, type Span } from './captionFlags'
import { headlineFontReady } from './headlineFont'
import type { RecheckResult } from './posting'
import { ChevronLeft, PauseIcon, PlayIcon } from './icons'
import { LIMITS, type LogoPosition } from './look'
import { TOGETHER_SEC, drawLogo, drawPoppedLogo, layoutLogo, sideBySide } from './overlay'
import { logoPop } from './effects'
import { formatTime } from './jobs'
import { findRepeats, type Repeat } from './repeats'
import { POP_POSITIONS, POP_SIZE, drawPop, popLayout, type PopPosition } from './popVideo'
import { CaptionSheet, useSheetPref } from './CaptionSheet'

/** The bank videos said in a take, for the caption check: each with when
 *  it comes up (on the raw take) and its still, and how they all look. */
export interface PopReview {
  items: { id: string; name: string; at: number[]; seconds: number; width: number; height: number; loadStill: () => Promise<Blob | null> }[]
  size: number
  position: PopPosition
  skipped: string[]
  onSize: (size: number) => void
  onPosition: (position: PopPosition) => void
  onSkip: (id: string, skip: boolean) => void
}

/** The pictures and the logo a take will show - each with when it comes up
 *  (on the raw take), how long, and where - so the check looks like the
 *  finished video (his ask, 2026-11-05: "the images that are being put in
 *  when I say a word pop up while I'm looking at the captions too"). */
export interface PictureReview {
  items: {
    key: string
    image: Blob
    at: number[]
    seconds: number
    place: { position: LogoPosition; widthPct: number; center?: { x: number; y: number } }
    /** The bank's pictures share one spot: only the newest shows. */
    bank?: boolean
  }[]
  /** They pop in, as the angle's effects say. */
  pop: boolean
}

/** Each picture as an image to draw, once loaded. */
export function usePictureStills(pictures: PictureReview | undefined): { images: Map<string, ImageBitmap>; ready: number } {
  const images = useRef(new Map<string, ImageBitmap>())
  const [ready, setReady] = useState(0)
  const latest = useRef(pictures)
  latest.current = pictures
  const keys = pictures?.items.map((i) => i.key).join(',') ?? ''
  useEffect(() => {
    let alive = true
    void (async () => {
      for (const item of latest.current?.items ?? []) {
        if (images.current.has(item.key) || typeof createImageBitmap !== 'function') continue
        const bitmap = await createImageBitmap(item.image).catch(() => null)
        if (!alive) {
          bitmap?.close()
          return
        }
        if (bitmap) images.current.set(item.key, bitmap)
      }
      if (alive) setReady((n) => n + 1)
    })()
    return () => {
      alive = false
    }
  }, [keys])
  useEffect(() => () => images.current.forEach((b) => b.close()), [])
  return { images: images.current, ready }
}

/** The pictures up at moment `t`, drawn where the finished video has them:
 *  several up at once side by side, the bank's newest only. */
export function paintPictures(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, p: PictureReview | undefined, images: Map<string, ImageBitmap>): void {
  if (!p) return
  const up: { item: PictureReview['items'][number]; since: number; image: ImageBitmap }[] = []
  for (const item of p.items) {
    const image = images.get(item.key)
    const start = Math.max(-Infinity, ...item.at.filter((a) => a <= t && t < a + item.seconds))
    if (image && Number.isFinite(start)) up.push({ item, since: t - start, image })
  }
  const newestBank = Math.min(Infinity, ...up.filter((u) => u.item.bank).map((u) => u.since))
  const shown = up.filter((u) => !u.item.bank || u.since - newestBank < TOGETHER_SEC)
  if (shown.length === 0) return
  const placed = sideBySide(shown.map((u) => layoutLogo(w, h, u.image, u.item.place)), w, h)
  shown.forEach((u, k) => {
    if (p.pop) drawPoppedLogo(ctx, u.image, placed[k], logoPop(u.since, u.item.seconds - u.since))
    else drawLogo(ctx, u.image, placed[k])
  })
}

/** When the captions are on the same page as the cuts (EditScreen): the cuts'
 *  video is the one shown, so the phrases move and play it instead. */
export interface EmbeddedVideo {
  seek(t: number): void
  playFrom(t: number): void
  subscribe(listener: (t: number, playing: boolean) => void): () => void
  /** He is typing in a phrase: the video above is made smaller. */
  onTyping(typing: boolean): void
  /** Cuts a stretch out (the first try of a phrase said twice). */
  cut?(range: { start: number; end: number }): void
  /** Puts a stretch that was cut back in (an "um" that wasn't one). */
  putBack?(range: { start: number; end: number }): void
}

/** Each pop-up's still, to show its box at its size on the frame. */
export function usePopStills(pops: PopReview | undefined): { stills: Map<string, ImageBitmap>; ready: number } {
  const stills = useRef(new Map<string, ImageBitmap>())
  const [ready, setReady] = useState(0)
  const popsRef = useRef(pops)
  popsRef.current = pops
  const popIds = pops?.items.map((i) => i.id).join(',') ?? ''
  useEffect(() => {
    let alive = true
    void (async () => {
      for (const item of popsRef.current?.items ?? []) {
        if (stills.current.has(item.id)) continue
        const blob = await item.loadStill().catch(() => null)
        if (!alive || !blob || typeof createImageBitmap !== 'function') continue
        const bitmap = await createImageBitmap(blob).catch(() => null)
        if (bitmap) stills.current.set(item.id, bitmap)
      }
      if (alive) setReady((n) => n + 1)
    })()
    return () => {
      alive = false
    }
  }, [popIds])
  useEffect(() => () => stills.current.forEach((b) => b.close()), [])
  return { stills: stills.current, ready }
}

/** The pop-up video on at moment `t` (or, while he sizes it, the first one),
 *  as its still, in the box it will have. */
export function paintPopBox(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  p: PopReview | undefined,
  stills: Map<string, ImageBitmap>,
  showBox: boolean,
): void {
  if (!p) return
  const on = p.items.filter((i) => !p.skipped.includes(i.id))
  const now = on.find((i) => i.at.some((at) => at <= t && t < at + i.seconds)) ?? (showBox ? on[0] : undefined)
  if (!now) return
  const still = stills.get(now.id)
  const box = popLayout(w, h, now, p.size, p.position)
  if (still) drawPop(ctx, still, box, { scale: 1, alpha: 1 })
  else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(box.x, box.y, box.width, box.height)
  }
}

const textOf = (phrase: CaptionWord[]) =>
  phrase
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(' ')

/** A box as tall as what is typed in it. */
function fit(box: HTMLTextAreaElement | null) {
  if (!box) return
  box.style.height = 'auto'
  box.style.height = `${box.scrollHeight}px`
}


const CHECKED_KEY = 'cutter.captions.checked'

/** The videos whose captions Claude has already checked on this phone. */
function checkedKeys(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(CHECKED_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export function wasChecked(key: string): boolean {
  return checkedKeys().includes(key)
}

export function markChecked(key: string): void {
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify([...checkedKeys().filter((k) => k !== key), key].slice(-500)))
  } catch {
    // A private window: it may be checked again next time, nothing worse.
  }
}


export function CaptionReview({
  name,
  file,
  missing = false,
  initial,
  approveLabel,
  onChange,
  onApprove,
  onSkip,
  onClose,
  onCuts,
  clips,
  headline = '',
  onHeadline,
  onHeadlineDone,
  bare = false,
  position = 'usual',
  onPosition,
  size = 'normal',
  onSize,
  captionStyle = 'word',
  onCaptionStyle,
  onRecheck,
  recheckKey,
  vocabulary = [],
  riskSpans = [],
  ums = [],
  pops,
  pictures,
  embedded,
  quick = false,
  onTimeline,
  top,
  backLabel = 'Videos',
  sheet,
}: {
  name: string
  /** The video itself, or null while it is being fetched from storage. */
  file: Blob | null
  /** The video is no longer on the phone: the words can still be fixed. */
  missing?: boolean
  initial: CaptionWord[]
  approveLabel: string
  onChange: (words: CaptionWord[]) => void
  onApprove: (words: CaptionWord[]) => void
  /** Made without captions. */
  onSkip: (words: CaptionWord[]) => void
  onClose: (words: CaptionWord[]) => void
  /** Leaves for the video's cuts, keeping the captions as they are. */
  onCuts?: (words: CaptionWord[]) => void
  /** What is joined onto the video - its Add list - with the look, after the phrases. */
  clips?: ReactNode
  /** The headline over the video, and a way to change it. `onHeadlineDone`
   *  runs when he leaves the box, so it is saved with the rest. */
  headline?: string
  onHeadline?: (text: string) => void
  onHeadlineDone?: () => void
  /** Captions with no punctuation: the preview shows them as they'll be. */
  bare?: boolean
  /** Where the caption sits on the frame (one of the places, or a height a
   *  batch format was dragged to), and a way to move it. */
  position?: CaptionSpot
  onPosition?: (position: CaptionPosition) => void
  /** How big the caption is on the frame, and a way to change it. */
  size?: CaptionSize
  onSize?: (size: CaptionSize) => void
  /** One word at a time or Highlight, and a way to change it. */
  captionStyle?: CaptionStyle
  onCaptionStyle?: (style: CaptionStyle) => void
  /** Claude's second look at the captions (costs credits). Absent when posting is not set up. */
  onRecheck?: (phrases: string[]) => Promise<RecheckResult>
  /** The video's own key: Claude checks its captions by itself the first
   *  time they are opened, once (wasChecked/markChecked). */
  recheckKey?: string
  /** The campaign's names, for spotting a name heard wrong. */
  vocabulary?: string[]
  /** Moments of sounds the cutter cut or was unsure about. */
  riskSpans?: Span[]
  /** The "um"s cut by their sound (umFind.ts), on the recording's timeline. */
  ums?: Span[]
  /** Bank videos said in this take, and how they pop up - absent when none
   *  is said. */
  pops?: PopReview
  /** The pictures and logo it will show, drawn on the frame as they will be. */
  pictures?: PictureReview
  /** On the same page as the cuts: no video of its own. */
  embedded?: EmbeddedVideo
  /** The quick check (with `embedded`): only the phrases Claude changed or
   *  that may be wrong, one card at a time - Good, Undo, Fix - and Approve or
   *  the timeline editor. His words (2026-11-02): "Okay, good, good, good,
   *  next" instead of scrolling every phrase with the keyboard up. */
  quick?: boolean
  /** Leaves the quick check for the full timeline editor, same video. */
  onTimeline?: () => void
  /** Shown with the video, above it - a batch clip's step (DropCheck.tsx). */
  top?: ReactNode
  /** What the back button goes back to. */
  backLabel?: string
  /** The phrases' sheet open or closed, when the page around keeps it (the
   *  edit screen's Captions tool opens it). Absent: kept here. */
  sheet?: { open: boolean; onOpen: (open: boolean) => void }
}) {
  // The phrases as heard: each keeps its moment however it is retyped.
  const [heard] = useState(() => phrasesOf(initial))
  const [asHeard] = useState(() => heard.map(textOf))
  const [texts, setTexts] = useState(asHeard)
  const textsRef = useRef(texts)
  textsRef.current = texts
  const phraseFor = (k: number, text: string) => (text === asHeard[k] ? heard[k] : retimePhrase(heard[k], text))
  const phrases = useMemo(() => heard.map((_, k) => phraseFor(k, texts[k])), [texts]) // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => phrases.flat(), [phrases])
  // Phrases said twice (a retake), to watch and cut the first of.
  const repeats = useMemo(() => findRepeats(words), [words])
  /** Which phrase each word is in. */
  const owner = useMemo(() => phrases.flatMap((p, k) => p.map(() => k)), [phrases])
  const phrasesRef = useRef(phrases)
  phrasesRef.current = phrases

  const [checking, setChecking] = useState(false)
  const [rechecked, setRechecked] = useState<{ changed: Set<number>; unsure?: Set<number>; cents: number; before: string[]; error?: string } | null>(null)
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  // The phrases in a sheet over the screen (CaptionSheet.tsx) - open on a
  // caption check to start with, and as he left it after.
  const [ownSheet, setOwnSheet] = useSheetPref('captions.sheet', true)
  const sheetOpen = sheet ? sheet.open : ownSheet
  const setSheet = sheet ? sheet.onOpen : setOwnSheet
  const sheetOpenRef = useRef(sheetOpen)
  sheetOpenRef.current = sheetOpen
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [typing, setTyping] = useState(false)
  const [aspect, setAspect] = useState(9 / 16)
  const [url, setUrl] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const frame = useRef(0)
  const wordsRef = useRef(words)
  wordsRef.current = words
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const positionRef = useRef(position)
  positionRef.current = position
  const sizeRef = useRef(size)
  sizeRef.current = size
  const styleRef = useRef(captionStyle)
  styleRef.current = captionStyle
  const popsRef = useRef(pops)
  popsRef.current = pops
  // Each pop-up's still, to show the box at its size on the frame - loaded
  // by the page around it when it shows the video.
  const own = usePopStills(embedded ? undefined : pops)
  const stills = useRef(own.stills)
  stills.current = own.stills
  const stillsReady = own.ready
  const ownPictures = usePictureStills(embedded ? undefined : pictures)
  const picturesRef = useRef(pictures)
  picturesRef.current = pictures
  const pictureImages = useRef(ownPictures.images)
  pictureImages.current = ownPictures.images
  /** Set while he is sizing or moving the box: shown whatever the moment. */
  const showBox = useRef(false)

  useEffect(() => {
    if (!file) return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  /** The caption on the frame: fully popped when still, mid-pop when
   *  playing. */
  const paint = useCallback((shown: number, since: number) => {
    const c = canvas.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    const w = Math.round(rect.width * scale)
    const h = Math.round(rect.height * scale)
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    paintPictures(ctx, w, h, video.current?.currentTime ?? 0, picturesRef.current, pictureImages.current)
    paintPopBox(ctx, w, h, video.current?.currentTime ?? 0, popsRef.current, stills.current, showBox.current)
    const all = wordsRef.current
    if (!all[shown]) return
    drawStyledCaption(ctx, w, h, all, captionRanges(all, styleRef.current), shown, since, bare, positionRef.current, sizeRef.current, styleRef.current)
  }, [bare])

  /** The first word of phrase `k` that has anything to show. */
  const firstWordOf = (k: number) => {
    const at = owner.indexOf(k)
    if (at < 0) return -1
    for (let i = at; i < words.length && owner[i] === k; i++) if (words[i].text.trim()) return i
    return at
  }

  // Still: the frame the phrase starts on, with its first word up.
  useLayoutEffect(() => {
    if (playing) return
    const first = firstWordOf(current)
    const v = video.current
    if (first >= 0 && v && v.readyState >= 1) v.currentTime = words[first].start + 0.02
    paint(first, 1)
  }, [current, playing, words, paint, position, size, captionStyle, pops?.size, pops?.position, pops?.skipped, stillsReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Painted again once TikTok Sans is here; later paints already have it.
  useEffect(() => {
    void headlineFontReady().then(() => paint(firstWordOf(0), 1))
  }, [paint]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // On the same page as the cuts: the phrase under the playhead is the one lit,
  // and while it plays the list follows along.
  const currentRef = useRef(current)
  currentRef.current = current
  /** The list follows the phrase playing only while its sheet is open:
   *  closed, playing leaves everything where it is (his ask, 2026-11-10: "I
   *  don't always want to follow the captions"). */
  const follow = (k: number) => {
    const el = list.current
    // In the sheet: only while it is open (closed, the screen is his).
    if (!el || !sheetOpenRef.current) return
    el.children[k]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const typingRef = useRef(typing)
  typingRef.current = typing
  useEffect(() => {
    if (!embedded) return
    return embedded.subscribe((t, isPlaying) => {
      setPlaying(isPlaying)
      if (typingRef.current) return
      const starts = phrasesRef.current.map((p) => p.find((w) => w.text.trim())?.start ?? p[0]?.start ?? Infinity)
      let k = -1
      for (let i = 0; i < starts.length; i++) if (starts[i] <= t + CAPTION_LEAD) k = i
      if (k < 0 || k === currentRef.current) return
      setCurrent(k)
      if (isPlaying) follow(k)
    })
  }, [embedded])
  useEffect(() => embedded?.onTyping(typing), [embedded, typing])

  const stop = () => {
    cancelAnimationFrame(frame.current)
    video.current?.pause()
    setPlaying(false)
  }

  /** Plays from just before phrase `k`, the captions popping in as they
   *  will in the video and the list following along; a tap stops it. */
  const playFrom = (k: number) => {
    if (embedded) {
      const first = firstWordOf(k)
      if (first < 0) return
      setCurrent(k)
      if (playing && k === current) embedded.seek(words[first].start + 0.02)
      else embedded.playFrom(Math.max(0, words[first].start - 0.3))
      return
    }
    const v = video.current
    if (!v) return
    showBox.current = false
    if (playing) {
      stop()
      if (k === current) return
    }
    const first = firstWordOf(k)
    if (first < 0) return
    setCurrent(k)
    const starts = wordsRef.current.map((w) => w.start)
    v.muted = false
    v.currentTime = Math.max(0, wordsRef.current[first].start - 0.3)
    setPlaying(true)
    void v.play().catch(() => setPlaying(false))
    let following = k
    const tick = () => {
      const t = v.currentTime
      const shown = captionAt(starts, wordsRef.current, t, styleRef.current === 'word' ? undefined : PHRASE_HOLD_SEC)
      paint(shown, shown >= 0 ? t + CAPTION_LEAD - starts[shown] : 0)
      const now = shown >= 0 ? ownerRef.current[shown] : following
      if (now !== following) {
        following = now
        setCurrent(now)
        follow(now)
      }
      if (v.paused || v.ended) {
        setPlaying(false)
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const type = (k: number, text: string) => {
    setTexts(texts.map((t, i) => (i === k ? text : t)))
    onChange(heard.flatMap((_, i) => (i === k ? phraseFor(i, text) : phrases[i])))
  }

  /** Sets every phrase at once (Claude's fixes, or putting them back). */
  const applyTexts = (next: string[]) => {
    setTexts(next)
    onChange(heard.flatMap((_, i) => phraseFor(i, next[i])))
  }

  const recheck = async () => {
    if (!onRecheck || checking) return
    setChecking(true)
    const before = texts
    try {
      const out = await onRecheck(texts)
      // A phrase he typed into meanwhile stays his.
      const now = textsRef.current
      const changed = new Set(out.changed.filter((k) => now[k] === before[k]))
      if (changed.size > 0) applyTexts(now.map((t, k) => (changed.has(k) ? out.phrases[k] : t)))
      setRechecked({ changed, unsure: out.unsure ? new Set(out.unsure) : undefined, cents: out.costCents, before, error: out.error })
      if (changed.size > 0) setOnlyFlagged(true)
    } catch (e) {
      setRechecked({ changed: new Set(), cents: 0, before, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setChecking(false)
    }
  }

  // Checked by itself as the captions open - his words (2026-10-29): the
  // captions transcribed, "and then an AI looking at the actual logic". Once
  // a video: reopened, his own edits stay as he left them.
  useEffect(() => {
    if (!onRecheck || !recheckKey || wasChecked(recheckKey)) return
    markChecked(recheckKey)
    void recheck()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const flagged = useMemo(
    () =>
      flaggedPhrases(
        phrases.map((p, k) => ({ text: texts[k] ?? '', start: p[0]?.start ?? 0, end: p[p.length - 1]?.end ?? 0 })),
        { vocabulary, changed: rechecked?.changed, risky: riskSpans },
      ),
    [phrases, texts, vocabulary, rechecked, riskSpans],
  )

  /** What the quick check shows: once Claude has read them, only what it
   *  changed, what it couldn't be sure of, and a campaign name heard nearly
   *  right - the cutter's own unsure moments are Claude's to judge then.
   *  Before (or without) Claude, everything flagged. */
  const toLookAt = useMemo(() => {
    if (!rechecked || rechecked.error || !rechecked.unsure) return flagged
    const vocabOnly = flaggedPhrases(
      phrases.map((p, k) => ({ text: texts[k] ?? '', start: p[0]?.start ?? 0, end: p[p.length - 1]?.end ?? 0 })),
      { vocabulary, changed: rechecked.changed },
    )
    return new Set([...vocabOnly, ...rechecked.unsure])
  }, [flagged, rechecked, phrases, texts, vocabulary])

  /** On to the next phrase's box, or done after the last. */
  const next = (k: number) => {
    const box = list.current?.children[k + 1]?.querySelector('textarea')
    if (box) box.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  if (words.length === 0) {
    return (
      <section className={embedded ? 'review review-embedded' : 'screen review'}>
        {embedded ? null : (
          <button type="button" className="back" onClick={() => onClose(words)}>
            <ChevronLeft /> {backLabel}
          </button>
        )}
        {top}
        {/* Still to be seen when it has words over it - where it goes, on a
            batch's check (DropCheck.tsx). */}
        {top && url ? (
          <div className="review-frame">
            <video src={url} playsInline controls preload="auto" />
          </div>
        ) : null}
        <p className="lede">No words were heard in this video, so there are no captions to check.</p>
        {clips}
        <button type="button" className="btn primary wide" onClick={() => onApprove(words)}>
          {approveLabel}
        </button>
      </section>
    )
  }

  const umsCut = (
    <UmFlags
      ums={ums}
      onListen={(u) => {
        if (embedded) embedded.playFrom(Math.max(0, u.start - 1.2))
        else if (video.current) {
          video.current.currentTime = Math.max(0, u.start - 1.2)
          void video.current.play().catch(() => {})
        }
      }}
      onPutBack={embedded?.putBack ? (u) => embedded.putBack?.(u) : undefined}
    />
  )

  const saidTwice = (
    <RepeatFlags
      repeats={repeats}
      onWatch={(r) => {
        if (embedded) embedded.playFrom(Math.max(0, r.first - 0.3))
        else if (video.current) {
          video.current.currentTime = Math.max(0, r.first - 0.3)
          void video.current.play().catch(() => {})
        }
      }}
      onCut={embedded?.cut ? (r) => embedded.cut?.(r.cut) : undefined}
    />
  )

  if (embedded && quick) {
    return (
      <>
      {saidTwice}
      {umsCut}
      <QuickCheck
        texts={texts}
        heard={asHeard}
        flagged={toLookAt}
        changed={rechecked?.changed ?? new Set()}
        before={rechecked?.before}
        checking={checking}
        error={rechecked?.error}
        approveLabel={approveLabel}
        onShow={(k) => {
          const first = firstWordOf(k)
          if (first >= 0) embedded.seek(words[first].start + 0.02)
          setCurrent(k)
        }}
        onPlay={(k) => {
          const first = firstWordOf(k)
          if (first >= 0) embedded.playFrom(Math.max(0, words[first].start - 0.3))
        }}
        onPlayAll={() => embedded.playFrom(words[0]?.start ?? 0)}
        onText={type}
        onTyping={setTyping}
        onApprove={() => onApprove(words)}
        onSkip={() => onSkip(words)}
        onTimeline={onTimeline}
      />
      </>
    )
  }

  return (
    <section
      className={embedded ? 'review review-embedded' : `screen review${typing ? ' typing' : ''}`}
      aria-label={`Captions for ${name}`}
    >
      {embedded ? <div className="group-title review-embedded-title">Captions</div> : null}
      {embedded ? saidTwice : null}
      {umsCut}
      {embedded ? null : (
      <div className="review-top">
        <div className="review-head">
          <button type="button" className="back" onClick={() => onClose(words)}>
            <ChevronLeft /> {backLabel}
          </button>
          <span className="review-count">
            {current + 1} / {phrases.length}
          </span>
          {onCuts ? (
            <button type="button" className="btn small" onClick={() => onCuts(words)}>
              Cuts
            </button>
          ) : null}
        </div>
        {top}
        <div className="review-frame" style={{ aspectRatio: String(aspect) }} onClick={() => playFrom(current)}>
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
                const first = firstWordOf(current)
                if (first >= 0) v.currentTime = words[first].start + 0.02
              }}
            />
          ) : (
            <div className="review-loading hint">
              {missing ? "This video isn't on the phone any more - the words can still be fixed." : 'Opening the video…'}
            </div>
          )}
          <canvas ref={canvas} aria-hidden />
          {url ? (
            <span className="review-playing" aria-hidden>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </span>
          ) : null}
        </div>
      </div>
      )}

      {/* The phrases: in a sheet over the screen, see-through, opened and
          closed here or with the edit screen's Captions tool (his ask,
          2026-11-13). */}
      <button type="button" className="caption-sheet-open" aria-expanded={sheetOpen} onClick={() => setSheet(!sheetOpen)}>
        <span className="row-name">Captions</span>
        <span className="hint">
          {phrases.length} phrase{phrases.length === 1 ? '' : 's'}
          {rechecked && rechecked.changed.size > 0 ? ` · Claude fixed ${rechecked.changed.size}` : ''}
          {flagged.size > 0 ? ` · ${flagged.size} to check` : ''}
        </span>
        <span className="caption-sheet-open-act">{sheetOpen ? 'Close' : 'Open'}</span>
      </button>
      <CaptionSheet
        open={sheetOpen}
        onClose={() => setSheet(false)}
        title={
          <>
            <span className="row-name">Captions</span>
            <span className="hint">
              {current + 1} / {phrases.length}
              {checking ? ' · Claude is checking…' : ''}
            </span>
          </>
        }
        extra={
          <>
          {onRecheck ? (
            <div className="recheck">
              <button type="button" className="btn wide recheck-btn" disabled={checking} onClick={() => void recheck()}>
                {checking ? (
                  'Claude is checking…'
                ) : (
                  <>
                    {recheckKey && wasChecked(recheckKey) ? 'Check again with Claude' : 'Check captions with Claude'} <span style={{ whiteSpace: 'nowrap', fontWeight: 400 }}>· about {centsLabel(estimateRecheckCents(texts, vocabulary))} of credits</span>
                  </>
                )}
              </button>
              {rechecked ? (
                <p className={`hint${rechecked.error ? ' warn-text' : ''}`}>
                  {rechecked.error
                    ? rechecked.error
                    : rechecked.changed.size === 0
                      ? 'Claude found nothing to fix.'
                      : `Claude fixed ${rechecked.changed.size} phrase${rechecked.changed.size === 1 ? '' : 's'} - they are highlighted below.`}
                  {rechecked.cents > 0 ? ` It cost ${centsLabel(rechecked.cents)}.` : ''}
                  {rechecked.changed.size > 0 ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={() => {
                          applyTexts(texts.map((t, k) => (rechecked.changed.has(k) ? rechecked.before[k] : t)))
                          setRechecked({ ...rechecked, changed: new Set() })
                        }}
                      >
                        Undo
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}
          {flagged.size > 0 && flagged.size < phrases.length ? (
            <button type="button" className="linkbtn only-flagged" onClick={() => setOnlyFlagged((v) => !v)}>
              {onlyFlagged ? `Show all ${phrases.length} phrases` : `Only show the ${flagged.size} to check`}
            </button>
          ) : null}
          </>
        }
      >
        <ol className="phrases" ref={list}>
          {phrases.map((phrase, k) => (
            <li
              key={k}
              hidden={onlyFlagged && flagged.size > 0 && !flagged.has(k)}
              className={`phrase${k === current ? ' on' : ''}${phrase.length > 0 && !textOf(phrase) ? ' gone' : ''}${rechecked?.changed.has(k) ? ' fixed' : flagged.has(k) ? ' flag' : ''}`}
            >
              <button
                type="button"
                className="phrase-play"
                aria-label={playing && k === current ? 'Pause' : `Play from phrase ${k + 1}`}
                onClick={() => playFrom(k)}
              >
                {playing && k === current ? <PauseIcon /> : <PlayIcon />}
              </button>
              <textarea
                ref={fit}
                rows={1}
                value={texts[k]}
                aria-label={`Phrase ${k + 1}`}
                placeholder="No caption here"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint={k === phrases.length - 1 ? 'done' : 'next'}
                onFocus={() => {
                  setTyping(true)
                  if (playing) stop()
                  setCurrent(k)
                  const first = firstWordOf(k)
                  if (embedded && first >= 0) embedded.seek(words[first].start + 0.02)
                }}
                onBlur={() => setTyping(false)}
                onChange={(e) => {
                  fit(e.currentTarget)
                  type(k, e.target.value.replace(/\n/g, ' '))
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  next(k)
                }}
              />
            </li>
          ))}
        </ol>
      </CaptionSheet>

      <div className="review-look">
        {clips}
        {onHeadline ? (
          <label className="field review-headline">
            <span className="label">Headline</span>
            <input
              type="text"
              value={headline}
              maxLength={LIMITS.headlineChars}
              placeholder="No headline"
              onChange={(e) => onHeadline(e.target.value)}
              onBlur={onHeadlineDone}
            />
          </label>
        ) : null}
        {onPosition ? (
          <div className="seg full caption-position" role="radiogroup" aria-label="Where the captions sit">
            {CAPTION_POSITIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={position === p.id}
                className={position === p.id ? 'active' : ''}
                onClick={() => onPosition(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        {onCaptionStyle ? (
          <div className="seg full caption-style" role="radiogroup" aria-label="Caption style">
            {CAPTION_STYLES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={captionStyle === c.id}
                className={captionStyle === c.id ? 'active' : ''}
                onClick={() => onCaptionStyle(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
        {pops && pops.items.length > 0 ? (
          <div className="pop-review">
            <div className="group-title">Pop-up videos</div>
            {pops.items.map((item) => (
              <label key={item.id} className="pop-row">
                <input
                  type="checkbox"
                  checked={!pops.skipped.includes(item.id)}
                  onChange={(e) => pops.onSkip(item.id, !e.target.checked)}
                />
                <span>{item.name}</span>
                <span className="hint">at {item.at.map((at) => formatTime(at)).join(', ')}</span>
              </label>
            ))}
            <label className="slider">
              <span>Size</span>
              <input
                type="range"
                min={POP_SIZE.min}
                max={POP_SIZE.max}
                step={1}
                value={pops.size}
                aria-label="How big the pop-up videos are"
                onChange={(e) => {
                  showBox.current = true
                  pops.onSize(Number(e.target.value))
                }}
              />
              <output>{pops.size}%</output>
            </label>
            <div className="seg full" role="radiogroup" aria-label="Where the pop-up videos sit">
              {POP_POSITIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={pops.position === p.id}
                  className={pops.position === p.id ? 'active' : ''}
                  onClick={() => {
                    showBox.current = true
                    pops.onPosition(p.id)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="hint tip">Muted. Each plays to its end over you when you say its words - shown on the frame above as it will sit.</p>
          </div>
        ) : null}
        {onSize ? (
          <div className="seg full caption-size" role="radiogroup" aria-label="How big the captions are">
            {CAPTION_SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={size === s.id}
                className={size === s.id ? 'active' : ''}
                onClick={() => onSize(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="editor-foot sticky">
        <button type="button" className="btn primary wide" onClick={() => onApprove(words)}>
          {approveLabel}
        </button>
        <button type="button" className="linkbtn review-skip" onClick={() => onSkip(words)}>
          Make it without captions
        </button>
      </div>
    </section>
  )
}

/** The "um"s the cutter cut by their sound (his ask, 2026-11-11: "try to fix
 *  it ... and point it out to me in the captions"): each to listen to, and -
 *  on the same page as the cuts - to put back if it was a real word. */
function UmFlags({ ums, onListen, onPutBack }: { ums: Span[]; onListen: (u: Span) => void; onPutBack?: (u: Span) => void }) {
  const [back, setBack] = useState<Set<number>>(new Set())
  if (ums.length === 0) return null
  return (
    <div className="repeat-flags um-flags">
      <div className="label">"Um"s cut · {ums.length - back.size}</div>
      {ums.map((u) => (
        <div className="repeat-row" key={u.start}>
          <button type="button" className="repeat-text" onClick={() => onListen(u)}>
            <span>{back.has(u.start) ? 'Put back' : '"um" cut'}</span>
            <span className="hint"> · {formatTime(u.start)} · listen</span>
          </button>
          {onPutBack && !back.has(u.start) ? (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                onPutBack(u)
                setBack((b) => new Set(b).add(u.start))
              }}
            >
              Put back
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** Phrases he said twice (repeats.ts): each to watch, and - on the same page
 *  as the cuts - to cut the first try of. */
function RepeatFlags({ repeats, onWatch, onCut }: { repeats: Repeat[]; onWatch: (r: Repeat) => void; onCut?: (r: Repeat) => void }) {
  if (repeats.length === 0) return null
  return (
    <div className="repeat-flags">
      <div className="label">Said twice</div>
      {repeats.map((r) => (
        <div className="repeat-row" key={r.first}>
          <button type="button" className="repeat-text" onClick={() => onWatch(r)}>
            <span>"{r.text.split(' ').length > 8 ? `${r.text.split(' ').slice(0, 8).join(' ')}…` : r.text}"</span>
            <span className="hint"> · {formatTime(r.first)} · watch</span>
          </button>
          {onCut ? (
            <button type="button" className="btn small" onClick={() => onCut(r)}>
              Cut the first
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** The quick check's cards: each phrase to look at, one at a time, its moment
 *  shown on the video above. Good goes on (and plays the next one); Undo puts
 *  back what was heard before Claude changed it; Fix opens a box for that
 *  phrase only. Then Approve, or the timeline editor. */
function QuickCheck({
  texts,
  heard,
  flagged,
  changed,
  before,
  checking,
  error,
  approveLabel,
  onShow,
  onPlay,
  onPlayAll,
  onText,
  onTyping,
  onApprove,
  onSkip,
  onTimeline,
}: {
  texts: string[]
  /** Each phrase as first heard. */
  heard: string[]
  flagged: Set<number>
  /** The phrases Claude changed, and what they said before. */
  changed: Set<number>
  before?: string[]
  checking: boolean
  error?: string
  approveLabel: string
  onShow: (k: number) => void
  onPlay: (k: number) => void
  onPlayAll: () => void
  onText: (k: number, text: string) => void
  onTyping: (typing: boolean) => void
  onApprove: () => void
  onSkip: () => void
  onTimeline?: () => void
}) {
  // Fixed once Claude has read them: fixing a phrase mustn't take it out of
  // the cards under his finger and skip the next one.
  const [queue, setQueue] = useState<number[]>(() => [...flagged].sort((a, b) => a - b))
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (checking) return
    setQueue([...flagged].sort((a, b) => a - b))
    setAt(0)
  }, [checking]) // eslint-disable-line react-hooks/exhaustive-deps
  const [fixing, setFixing] = useState(false)
  const k = queue[at]
  const done = at >= queue.length

  useEffect(() => {
    if (k !== undefined) onShow(k)
  }, [k]) // eslint-disable-line react-hooks/exhaustive-deps

  /** On to the next card - playing it, since this is his tap. */
  const next = () => {
    setFixing(false)
    onTyping(false)
    const n = at + 1
    setAt(n)
    if (queue[n] !== undefined) onPlay(queue[n])
  }

  const was = k !== undefined && changed.has(k) ? (before?.[k] ?? heard[k]) : null

  return (
    <section className="review review-embedded quick-check" aria-label="Quick caption check">
      {checking ? (
        <div className="quick-card quick-wait">
          <span className="spinner" aria-hidden />
          <span>Claude is reading the captions…</span>
        </div>
      ) : queue.length === 0 ? (
        <div className="quick-card quick-done">
          <div className="quick-title">{error ? 'Captions ready to look at' : 'Every caption looks right'}</div>
          <p className="hint">{error ?? 'Claude read them all and found nothing to fix.'}</p>
          <button type="button" className="linkbtn" onClick={onPlayAll}>
            Watch it once
          </button>
        </div>
      ) : done ? (
        <div className="quick-card quick-done">
          <div className="quick-title">All {queue.length} checked</div>
          <button type="button" className="linkbtn" onClick={() => setAt(0)}>
            Go through them again
          </button>
          <button type="button" className="linkbtn" onClick={onPlayAll}>
            Watch it once
          </button>
        </div>
      ) : (
        <div className="quick-card">
          <div className="quick-progress">
            <span>
              {at + 1} of {queue.length} to look at
            </span>
            <button type="button" className="linkbtn" onClick={() => onPlay(k)}>
              ▶ Play it
            </button>
          </div>
          {fixing ? (
            <input
              className="quick-fix"
              type="text"
              autoFocus
              value={texts[k]}
              aria-label="This caption"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              onFocus={() => onTyping(true)}
              onChange={(e) => onText(k, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') next()
              }}
            />
          ) : (
            <div className="quick-text">{texts[k] || <span className="hint">No caption here</span>}</div>
          )}
          {was !== null && was !== texts[k] ? (
            <div className="quick-was">
              Claude changed it from <s>{was}</s>
            </div>
          ) : changed.has(k) ? null : (
            <div className="quick-was">May be misheard - check it against what you said.</div>
          )}
          <div className="quick-actions">
            <button type="button" className="btn primary" onClick={next}>
              {fixing ? 'Done' : 'Good'}
            </button>
            {was !== null && was !== texts[k] && !fixing ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onText(k, was)
                  next()
                }}
              >
                Undo change
              </button>
            ) : null}
            {fixing ? null : (
              <button type="button" className="btn" onClick={() => setFixing(true)}>
                Fix
              </button>
            )}
          </div>
        </div>
      )}

      <div className="editor-foot sticky quick-foot">
        <button type="button" className="btn primary wide" onClick={onApprove}>
          {approveLabel}
        </button>
        {onTimeline ? (
          <button type="button" className="btn wide" onClick={onTimeline}>
            Timeline editor
          </button>
        ) : null}
        <button type="button" className="linkbtn review-skip" onClick={onSkip}>
          Make it without captions
        </button>
      </div>
    </section>
  )
}
