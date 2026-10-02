// Checking a video's captions before it is made, the way TikTok's own
// caption editor shows them: the video up top with the caption drawn on it
// exactly as it will be burned in, and every phrase in a list under it, each
// one a box to type straight into. Tapping a phrase shows its frame; its
// play button runs the video from there with the captions popping in.
// Approving sends it to be made; if the captions are no good it can be made
// without them.
//
// The frame is the phone's own video player, not the page's decoder, and
// nothing is made while this is open - see CampaignApp - so the two never
// compete for the phone's video hardware.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { CAPTION_LEAD, captionAt, drawCaption, phrasesOf, retimePhrase, type CaptionWord } from './captions'
import { headlineFontReady } from './headlineFont'
import { ChevronLeft, PauseIcon, PlayIcon } from './icons'

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
  bare = false,
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
  /** What is joined onto the video - its Add list - under the header. */
  clips?: ReactNode
  /** Captions with no punctuation: the preview shows them as they'll be. */
  bare?: boolean
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
    if (word) drawCaption(ctx, w, h, word.text, since, bare)
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
  }, [current, playing, words, paint]) // eslint-disable-line react-hooks/exhaustive-deps

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
        {clips}
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

      <ol className="phrases" ref={list}>
        {phrases.map((phrase, k) => (
          <li key={k} className={`phrase${k === current ? ' on' : ''}${phrase.length > 0 && !textOf(phrase) ? ' gone' : ''}`}>
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
