// A video's cuts and its captions on one page, the way a phone editor shows
// them: the video at the top with the captions drawn on it as they will be
// burned in, the cuts' timeline under it, and the phrases to fix under that.
// Switching between two screens to fix one video was the annoying part - each
// one opened the video again and lost the place.
//
// The cuts editor (CutsEditor) owns the one video and its timeline; the
// captions (CaptionReview, embedded) move and play that video instead of one
// of their own, so only one player ever runs. Play plays the kept parts
// only, with the captions popping in: exactly the video that will be made.
// A change to the cuts puts the captions through the new cut a moment later,
// keeping what he has typed; a part brought back brings its words back.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'

import type { Range } from '../media/silenceMath'
import { CaptionReview, paintPopBox, usePopStills, type EmbeddedVideo } from './CaptionReview'
import { CAPTION_LEAD, captionAt, captionRanges, drawStyledCaption, type CaptionWord, PHRASE_HOLD_SEC } from './captions'
import { CutsEditor, type CutsControl } from './CutsEditor'
import type { ManualPicture } from './manualPictures'

/** How long the cuts are left to settle before the captions follow them:
 *  dragging an edge changes them every frame. */
const SETTLE_MS = 400

export interface EditedCuts {
  keep: Range[]
  overlays: ManualPicture[]
  files: Map<string, Blob>
}

type CutsProps = ComponentProps<typeof CutsEditor>
type ReviewProps = ComponentProps<typeof CaptionReview>

export function EditScreen({
  id,
  name,
  file,
  missing = false,
  cuts,
  shown,
  review,
  onKeep,
  onChange,
  onFinish,
}: {
  id: string
  name: string
  file: Blob | null
  missing?: boolean
  /** The timeline: everything the cuts editor shows. */
  cuts: Pick<
    CutsProps,
    'duration' | 'initial' | 'words' | 'checks' | 'peaks' | 'noiseNote' | 'overlays' | 'bank' | 'defaults' | 'loadImage' | 'videoBank' | 'loadVideo' | 'headline'
  >
  /** The captions he checks, through the cut as it is now. */
  shown: CaptionWord[]
  /** How the captions look, the headline and the rest under the phrases. */
  review: Omit<ReviewProps, 'name' | 'file' | 'missing' | 'initial' | 'onChange' | 'onApprove' | 'onSkip' | 'onClose' | 'onCuts' | 'embedded'>
  /** The cuts changed (settled): the captions are to follow them. */
  onKeep: (keep: Range[], before: Range[]) => void
  /** He changed a caption. */
  onChange: (words: CaptionWord[]) => void
  /** Leaving: approved with captions, without them, or just closed. */
  onFinish: (how: 'with' | 'without' | false, cuts: EditedCuts, words: CaptionWord[]) => void
}) {
  // What the timeline starts from is fixed for this visit: the cuts editor
  // holds the cuts as he changes them.
  const [start] = useState(() => ({ keep: cuts.initial, words: cuts.words }))
  const latest = useRef<EditedCuts>({ keep: cuts.initial, overlays: cuts.overlays ?? [], files: new Map() })
  const [applied, setApplied] = useState(cuts.initial)
  const appliedRef = useRef(applied)
  appliedRef.current = applied
  const settle = useRef(0)
  const [typing, setTyping] = useState(false)
  const control = useRef<CutsControl | null>(null)

  // The captions drawn on the video: his, as he types them.
  const words = useRef(shown)
  const shownFor = useRef(applied)
  if (shownFor.current !== applied) {
    shownFor.current = applied
    words.current = shown
  }
  const look = useRef(review)
  look.current = review
  const pops = usePopStills(review.pops)
  const stills = useRef(pops.stills)
  stills.current = pops.stills

  const paintOver = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, t: number, playing: boolean) => {
    const r = look.current
    paintPopBox(ctx, w, h, t, r.pops, stills.current, false)
    const all = words.current
    const starts = all.map((x) => x.start)
    const style = r.captionStyle ?? 'word'
    const at = captionAt(starts, all, t, style === 'word' ? undefined : PHRASE_HOLD_SEC)
    if (at < 0) return
    drawStyledCaption(ctx, w, h, all, captionRanges(all, style), at, playing ? t + CAPTION_LEAD - starts[at] : 1, r.bare ?? false, r.position ?? 'usual', r.size ?? 'normal', style)
  }, [])

  // A new look, or the stills arriving: drawn again.
  useEffect(() => {
    control.current?.repaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.captionStyle, review.position, review.size, review.bare, review.pops?.size, review.pops?.position, review.pops?.skipped?.join('|'), pops.ready])

  useEffect(() => () => window.clearTimeout(settle.current), [])

  const onState = useCallback(
    (keep: Range[], overlays: ManualPicture[], files: Map<string, Blob>) => {
      latest.current = { keep, overlays, files }
      window.clearTimeout(settle.current)
      if (JSON.stringify(keep) === JSON.stringify(appliedRef.current)) return
      settle.current = window.setTimeout(() => {
        const before = appliedRef.current
        onKeep(keep, before)
        setApplied(keep)
      }, SETTLE_MS)
    },
    [onKeep],
  )

  const embedded = useMemo<EmbeddedVideo>(
    () => ({
      seek: (t) => control.current?.seek(t),
      playFrom: (t) => control.current?.playFrom(t),
      subscribe: (listener) => control.current?.subscribe(listener) ?? (() => {}),
      onTyping: setTyping,
    }),
    [],
  )

  const finish = (how: 'with' | 'without' | false, said: CaptionWord[]) => {
    window.clearTimeout(settle.current)
    onFinish(how, latest.current, said)
  }

  return (
    <CutsEditor
      key={id}
      name={name}
      file={file}
      missing={missing}
      duration={cuts.duration}
      initial={start.keep}
      words={start.words}
      checks={cuts.checks}
      peaks={cuts.peaks}
      noiseNote={cuts.noiseNote}
      overlays={cuts.overlays}
      bank={cuts.bank}
      defaults={cuts.defaults}
      loadImage={cuts.loadImage}
      videoBank={cuts.videoBank}
      loadVideo={cuts.loadVideo}
      headline={cuts.headline}
      onDone={() => finish(false, words.current)}
      onCancel={() => finish(false, words.current)}
      paintOver={paintOver}
      onState={onState}
      control={control}
      headActions={null}
      typing={typing}
      below={
        <CaptionReview
          key={`${id}:${JSON.stringify(applied)}`}
          {...review}
          name={name}
          file={null}
          initial={shown}
          embedded={embedded}
          onChange={(next) => {
            words.current = next
            control.current?.repaint()
            onChange(next)
          }}
          onApprove={(said) => finish('with', said)}
          onSkip={(said) => finish('without', said)}
          onClose={(said) => finish(false, said)}
        />
      }
    />
  )
}
