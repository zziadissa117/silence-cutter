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
  captionAt,
  drawCaption,
  phrasesOf,
  retimePhrase,
  type CaptionPosition,
  type CaptionSize,
  type CaptionWord,
} from './captions'
import { centsLabel, estimateRecheckCents, flaggedPhrases, type Span } from './captionFlags'
import { headlineFontReady } from './headlineFont'
import type { RecheckResult } from './posting'
import { ChevronLeft, PauseIcon, PlayIcon } from './icons'
import { LIMITS } from './look'

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
  onRecheck,
  vocabulary = [],
  riskSpans = [],
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
  /** Where the caption sits on the frame, and a way to move it. */
  position?: CaptionPosition
  onPosition?: (position: CaptionPosition) => void
  /** How big the caption is on the frame, and a way to change it. */
  size?: CaptionSize
  onSize?: (size: CaptionSize) => void
  /** Claude's second look at the captions (costs credits). Absent when posting is not set up. */
  onRecheck?: (phrases: string[]) => Promise<RecheckResult>
  /** The campaign's names, for spotting a name heard wrong. */
  vocabulary?: string[]
  /** Moments of sounds the cutter cut or was unsure about. */
  riskSpans?: Span[]
}) {
  // The phrases as heard: each keeps its moment however it is retyped.
  const [heard] = useState(() => phrasesOf(initial))
  const [asHeard] = useState(() => heard.map(textOf))
  const [texts, setTexts] = useState(asHeard)
  const phraseFor = (k: number, text: string) => (text === asHeard[k] ? heard[k] : retimePhrase(heard[k], text))
  const phrases = useMemo(() => heard.map((_, k) => phraseFor(k, texts[k])), [texts]) // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => phrases.flat(), [phrases])
  /** Which phrase each word is in. */
  const owner = useMemo(() => phrases.flatMap((p, k) => p.map(() => k)), [phrases])

  const [checking, setChecking] = useState(false)
  const [rechecked, setRechecked] = useState<{ changed: Set<number>; cents: number; before: string[]; error?: string } | null>(null)
  const [onlyFlagged, setOnlyFlagged] = useState(false)
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
    const word = wordsRef.current[shown]
    if (word) drawCaption(ctx, w, h, word.text, since, bare, positionRef.current, sizeRef.current)
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
  }, [current, playing, words, paint, position, size]) // eslint-disable-line react-hooks/exhaustive-deps

  // Painted again once TikTok Sans is here; later paints already have it.
  useEffect(() => {
    void headlineFontReady().then(() => paint(firstWordOf(0), 1))
  }, [paint]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const stop = () => {
    cancelAnimationFrame(frame.current)
    video.current?.pause()
    setPlaying(false)
  }

  /** Plays from just before phrase `k`, the captions popping in as they
   *  will in the video and the list following along; a tap stops it. */
  const playFrom = (k: number) => {
    const v = video.current
    if (!v) return
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
      const shown = captionAt(starts, wordsRef.current, t)
      paint(shown, shown >= 0 ? t + CAPTION_LEAD - starts[shown] : 0)
      const now = shown >= 0 ? ownerRef.current[shown] : following
      if (now !== following) {
        following = now
        setCurrent(now)
        list.current?.children[now]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
      const changed = new Set(out.changed)
      if (changed.size > 0) applyTexts(out.phrases)
      setRechecked({ changed, cents: out.costCents, before, error: out.error })
      if (changed.size > 0) setOnlyFlagged(true)
    } catch (e) {
      setRechecked({ changed: new Set(), cents: 0, before, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setChecking(false)
    }
  }

  const flagged = useMemo(
    () =>
      flaggedPhrases(
        phrases.map((p, k) => ({ text: texts[k] ?? '', start: p[0]?.start ?? 0, end: p[p.length - 1]?.end ?? 0 })),
        { vocabulary, changed: rechecked?.changed, risky: riskSpans },
      ),
    [phrases, texts, vocabulary, rechecked, riskSpans],
  )

  /** On to the next phrase's box, or done after the last. */
  const next = (k: number) => {
    const box = list.current?.children[k + 1]?.querySelector('textarea')
    if (box) box.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  if (words.length === 0) {
    return (
      <section className="screen review">
        <button type="button" className="back" onClick={() => onClose(words)}>
          <ChevronLeft /> Videos
        </button>
        <p className="lede">No words were heard in this video, so there are no captions to check.</p>
        {clips}
        <button type="button" className="btn primary wide" onClick={() => onApprove(words)}>
          {approveLabel}
        </button>
      </section>
    )
  }

  return (
    <section className={`screen review${typing ? ' typing' : ''}`} aria-label={`Captions for ${name}`}>
      <div className="review-top">
        <div className="review-head">
          <button type="button" className="back" onClick={() => onClose(words)}>
            <ChevronLeft /> Videos
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

      {onRecheck ? (
        <div className="recheck">
          <button type="button" className="btn wide recheck-btn" disabled={checking} onClick={() => void recheck()}>
            {checking ? 'Claude is checking…' : `Use Claude to re-check captions · costs credits · ${centsLabel(estimateRecheckCents(texts, vocabulary))}`}
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
                      applyTexts(rechecked.before)
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
