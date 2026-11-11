// More -> Motion graphics: a talking video with motion graphics around it,
// planned by Claude from what he says. His ask (2026-11-07): "I just drop in
// the videos, and it does it automatically, just like the cutter does
// already", in the style of his friend's reel, and to see how it will look
// before it is made: "is there a way to check before if it's good".
//
//   pick   one recording, and a line of what he wants (optional)
//   hear   cut and heard on the phone, as on Videos (motion/make.ts)
//   plan   Claude's storyboard (postiz motion-plan): each scene in a line, a
//          still of each drawn by the render's own code, a slider to look
//          anywhere, and a chat to change it - nothing made yet
//   make   the same one-pass render as every video, the graphics drawn on
//   done   watch it, save it to the phone
//
// Every step is kept on the phone (motion/session.ts): closing the app never
// loses the video or the plan. Only the words go to Claude, never the video.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { CaptionWord } from './captions'

import type { ChatTurn, Storyboard } from '../../supabase/functions/postiz/motion.ts'
import { forgetCut } from '../media/outputSink'
import { VideoPicker } from '../VideoPicker'
import { report } from '../report'
import { BackToMore } from './MoreView'
import { drawMotion, faceDropAt, fillBehindFace, type Timing } from './motion/draw'
import { FrameReader } from './motion/frames'
import { Planning, useElapsed } from './motion/Planning'
import { AskExamples, FORMAT_INFO, FormatPicker, saveFormat, savedFormat } from './motion/FormatPicker'
import { formatOf, popScene, type FormatAsk } from '../../supabase/functions/postiz/motion.ts'
import { captionLook, captionsToEdit, claudeWords, drawCaptionAt, forClaude, hear, makeMotionVideo, shownCaptions, soundsFor, storyWords, type CaptionChoice } from './motion/make'
import { loadMusicBank, songFile, useMusicBank } from './musicBank'
import { CaptionReview, type EmbeddedVideo } from './CaptionReview'
import { clearSession, freshFile, loadSession, saveSession, type MotionSession } from './motion/session'
import { cutLength, cutTiming, rawTimeAt } from './motion/track'
import { motionPlan, postingHere, recheckCaptions } from './posting'
import type { RecheckContext } from '../../supabase/functions/postiz/recheck.ts'
import { hasShareSheet, shareVideo, useSharable } from './shareFile'

type Step =
  | { kind: 'loading' }
  | { kind: 'pick' }
  | { kind: 'hearing'; what: string; fraction: number }
  | { kind: 'planning'; words: string[]; raw: number }
  | { kind: 'plan' }
  | { kind: 'making'; fraction: number }
  | { kind: 'done' }
  | { kind: 'captions' }
  | { kind: 'check' }

const STILL = { width: 360, height: 640 }

/** How long Claude may take before the phone stops waiting and says so: the
 *  server says a job still going after 7 minutes was stopped. */
const PLAN_MINUTES = 8

/** `work`, or an error once `minutes` have gone by with no answer - never a
 *  spinner for ever. */
function withinMinutes<T>(work: Promise<T>, minutes: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Claude didn't answer in ${minutes} minutes. Try again - nothing is lost.`)), minutes * 60_000),
    ),
  ])
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function MotionView({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<MotionSession | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [problem, setProblem] = useState<string | null>(null)
  const [ask, setAsk] = useState('')
  const [format, setFormat] = useState<FormatAsk>(savedFormat)
  const chooseFormat = (next: FormatAsk) => {
    setFormat(next)
    saveFormat(next)
  }
  const busy = useRef(false)

  // Back to where he was.
  useEffect(() => {
    void loadSession().then((kept) => {
      setSession(kept)
      if (!kept) setStep({ kind: 'pick' })
      else if (kept.made) setStep({ kind: 'done' })
      else if (kept.storyboard) setStep({ kind: 'plan' })
      // Heard, not checked yet: the caption check is where he left off.
      else if (kept.plan && !kept.checked) setStep({ kind: 'check' })
      else setStep({ kind: 'pick' })
      if (kept && !kept.storyboard) setAsk(kept.ask)
    })
  }, [])

  const keep = (next: MotionSession) => {
    setSession(next)
    void saveSession(next)
  }

  /** Heard (if not yet), then planned by Claude. */
  const plan = async (start: MotionSession) => {
    if (busy.current) return
    busy.current = true
    setProblem(null)
    let current = start
    try {
      if (!postingHere()) throw new Error('Set up posting in Settings first - Claude plans the graphics with your Anthropic key.')
      if (!current.plan) {
        setStep({ kind: 'hearing', what: 'Reading the video', fraction: 0 })
        const heard = await hear(current.file, {
          onAnalyseProgress: (p) => setStep({ kind: 'hearing', what: 'Reading the video', fraction: p }),
          onModelDownload: (p) => setStep({ kind: 'hearing', what: 'Getting the speech model', fraction: p }),
          onTranscribeProgress: (p) => setStep({ kind: 'hearing', what: 'Listening to what you say', fraction: p }),
        })
        current = { ...current, plan: heard }
        keep(current)
      }
      const words = storyWords(current.plan!)
      if (words.length < 3) throw new Error("No words were heard in this video, so there's nothing to put graphics on.")
      // The captions first, as on Videos: Claude checks them, he looks over
      // its fixes and approves - then the plan is made from the words as he
      // approved them (onChecked carries on from here).
      if (!current.checked) {
        setStep({ kind: 'check' })
        return
      }
      const sent = claudeWords(current.plan!, current.captions)
      setStep({ kind: 'planning', words: sent.words, raw: (current.plan!.keep[0]?.start ?? 0) + 1 })
      const answer = await withinMinutes(motionPlan({ job: `${current.id}-${Date.now().toString(36)}`, ...sent, ask: current.ask, format: current.format ?? 'auto' }), PLAN_MINUTES)
      current = { ...current, storyboard: answer.storyboard, chat: [], costCents: current.costCents + answer.costCents }
      keep(current)
      setStep({ kind: 'plan' })
    } catch (error) {
      report({ kind: 'fallback', phase: 'motion plan', message: message(error) })
      setProblem(message(error))
      setStep(current.storyboard ? { kind: 'plan' } : { kind: 'pick' })
    } finally {
      busy.current = false
    }
  }

  const pick = (files: File[]) => {
    const file = files[0]
    if (!file) return
    const next: MotionSession = { id: `motion-${Date.now().toString(36)}`, file, fileName: file.name, ask: ask.trim(), format, chat: [], costCents: 0 }
    keep(next)
    void plan(next)
  }

  /** Made from the plan as it is now - or as `given`, a change he typed just
   *  before tapping Make, sent first (his ask, 2026-11-11). */
  const make = async (given?: MotionSession) => {
    const from = given ?? session
    if (!from?.plan || !from.storyboard || busy.current) return
    busy.current = true
    setProblem(null)
    setStep({ kind: 'making', fraction: 0 })
    try {
      // Read again from the phone's storage, so it is never a Blob Safari has let go.
      const file = await freshFile(from.id, from.file)
      const made = await makeMotionVideo(file, from.plan, from.storyboard, from.id, (fraction) => setStep({ kind: 'making', fraction }), from.captions, !from.noSounds)
      // Kept with the session, copied out of the render's own storage.
      const copy = new Blob([await made.blob.arrayBuffer()], { type: 'video/mp4' })
      if (made.storedAs) void forgetCut(made.storedAs)
      keep({ ...from, made: copy, madeFrom: from.storyboard })
      setStep({ kind: 'done' })
    } catch (error) {
      report({ kind: 'fallback', phase: 'motion make', message: message(error) })
      setProblem(`It couldn't be made: ${message(error)}`)
      setStep({ kind: 'plan' })
    } finally {
      busy.current = false
    }
  }

  const startOver = async () => {
    if (session?.made === undefined && session?.storyboard && !window.confirm('Start again with another video? This plan is let go.')) return
    await clearSession()
    setSession(null)
    setAsk('')
    setProblem(null)
    setStep({ kind: 'pick' })
  }

  return (
    <section className="screen motion">
      {step.kind === 'captions' || step.kind === 'check' ? null : (
        <>
          <BackToMore onBack={onBack} />
          <div className="screen-head">
            <h1>Motion graphics</h1>
          </div>
        </>
      )}
      {problem ? <p className="hint warn-text">{problem}</p> : null}
      {step.kind === 'loading' ? <p className="hint">One moment…</p> : null}
      {step.kind === 'pick' ? (
        <>
          <p className="lede">Drop in a talking video. It is cut like on Videos, Claude listens and plans graphics around what you say - you see the plan and fix it before anything is made.</p>
          <div className="list-title">Which look</div>
          <FormatPicker value={format} onChange={chooseFormat} />
          <label className="field">
            <span className="label">What you want (optional)</span>
            <textarea
              rows={2}
              value={ask}
              placeholder="Tap an example below, type your own, or leave it to Claude"
              onChange={(e) => setAsk(e.target.value)}
            />
          </label>
          <AskExamples format={format} ask={ask} onPick={setAsk} />
          <VideoPicker className="drop motion-drop" label="Pick a talking video" onFiles={pick}>
            <span className="big">Pick a talking video</span>
            <span className="hint">One at a time · only your words go to Claude, never the video</span>
          </VideoPicker>
          {session && !session.storyboard ? (
            <button type="button" className="btn wide" onClick={() => void plan(session)}>
              Try {session.fileName} again
            </button>
          ) : null}
        </>
      ) : null}
      {step.kind === 'hearing' ? <Working what={step.what} fraction={step.fraction} /> : null}
      {step.kind === 'planning' && session ? <Planning words={step.words} file={session.file} raw={step.raw} ask={session.ask} format={session.format === 'glass' ? 'glass' : 'board'} /> : null}
      {step.kind === 'making' ? <Working what="Making the video" fraction={step.fraction} note="Keep the app open - it is made on this phone." /> : null}
      {(step.kind === 'plan' || step.kind === 'making') && session?.plan && session.storyboard ? (
        <PlanScreen
          session={session}
          onChange={keep}
          onMake={(given) => void make(given)}
          onStartOver={() => void startOver()}
          onCaptions={() => setStep({ kind: 'captions' })}
          onFormat={(next) => {
            const again = { ...session, format: next, storyboard: undefined, chat: [] }
            keep(again)
            void plan(again)
          }}
          making={step.kind === 'making'}
        />
      ) : null}
      {step.kind === 'check' && session?.plan ? (
        <CaptionCheck
          session={session}
          onDone={(captions) => {
            const next = { ...session, checked: true, ...(captions ? { captions } : {}) }
            keep(next)
            window.scrollTo({ top: 0 })
            void plan(next)
          }}
        />
      ) : null}
      {step.kind === 'captions' && session?.plan ? (
        <EditCaptions
          session={session}
          onDone={(captions) => {
            if (captions) keep({ ...session, captions })
            setStep({ kind: 'plan' })
            window.scrollTo({ top: 0 })
          }}
        />
      ) : null}
      {step.kind === 'done' && session?.made ? (
        <Done
          session={session}
          onEdit={() => {
            keep({ ...session, made: undefined, madeFrom: undefined })
            setStep({ kind: 'plan' })
          }}
          onAnother={() => void startOver()}
        />
      ) : null}
    </section>
  )
}

/** Sound effects on this video: his own (Music -> Sound effects), picked by
 *  their names for each kind of moment, with a switch to make it without.
 *  The Cutter's made-up sounds are gone (his ask, 2026-11-11). */
function SoundEffects({ session, onChange, disabled }: { session: MotionSession; onChange: (next: MotionSession) => void; disabled: boolean }) {
  const effects = useMusicBank('effects')
  const sounds = useMemo(() => soundsFor(session.plan!, session.storyboard!, true, effects), [session.plan, session.storyboard, effects])
  const count = sounds.reduce((sum, s) => sum + s.moments.length, 0)
  const on = !session.noSounds
  return (
    <div className="setting motion-sfx">
      <label className="toggle">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange({ ...session, noSounds: !e.target.checked })} />
        <span>
          <span className="label">Sound effects</span>
          <span className="hint" style={{ display: 'block' }}>
            {!on
              ? 'Off for this video.'
              : count > 0
                ? `${count} from your sound effects: ${[...new Set(sounds.map((s) => s.effectName))].join(', ')} - under your voice.`
                : 'None yet: add yours in Music, under Sound effects, with the kind in the name (whoosh, swish, pop, ding, click, boom, camera).'}
          </span>
        </span>
      </label>
      {on && sounds.length > 0 ? (
        <button type="button" className="linkbtn" onClick={() => void hearEffects(sounds.map((s) => s.effectId))}>
          Hear them
        </button>
      ) : null}
    </div>
  )
}

/** Plays each of his effects once, one after the other. */
async function hearEffects(ids: string[]): Promise<void> {
  const bank = await loadMusicBank()
  for (const id of ids) {
    const song = bank.find((s) => s.id === id)
    const file = song ? await songFile(song).catch(() => null) : null
    if (!file) continue
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
      void audio.play().catch(() => resolve())
      window.setTimeout(resolve, 4000)
    })
    URL.revokeObjectURL(url)
  }
}

/** The caption check before the plan - the same as on Videos: Claude reads
 *  the captions by itself, and only what it changed or isn't sure of comes up,
 *  one at a time, to keep (Good), undo or fix; then Approve. "All captions"
 *  opens every phrase. His ask (2026-11-08): "You know how we usually just
 *  check the captions, like Claude checks the captions, and then I review or
 *  approve ... That's exactly the format that I want." */
function CaptionCheck({ session, onDone }: { session: MotionSession; onDone: (captions: CaptionChoice | null) => void }) {
  const plan = session.plan!
  const [quick, setQuick] = useState(true)
  const [initial] = useState(() => captionsToEdit(plan, session.captions))
  const player = useRef<HTMLVideoElement>(null)
  const url = useMemo(() => URL.createObjectURL(session.file), [session.file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const embedded = useMemo<EmbeddedVideo>(
    () => ({
      seek: (t) => {
        if (player.current) player.current.currentTime = Math.max(0, t)
      },
      playFrom: (t) => {
        const v = player.current
        if (!v) return
        v.currentTime = Math.max(0, t)
        void v.play().catch(() => {})
      },
      subscribe: (listener) => {
        const v = player.current
        if (!v) return () => {}
        const tell = () => listener(v.currentTime, !v.paused)
        const events = ['timeupdate', 'play', 'pause', 'seeked'] as const
        for (const e of events) v.addEventListener(e, tell)
        return () => {
          for (const e of events) v.removeEventListener(e, tell)
        }
      },
      onTyping: () => {},
    }),
    [],
  )
  const sameWords = (words: CaptionWord[]) => words.map((w) => w.text.trim()).join(' ') === initial.map((w) => w.text.trim()).join(' ')
  const finish = (words: CaptionWord[], off: boolean) =>
    onDone(off || !sameWords(words) || session.captions ? { ...session.captions, edited: sameWords(words) ? session.captions?.edited : words, off } : null)
  return (
    <section className="screen motion motion-check">
      <div className="screen-head">
        <h1>Check the captions</h1>
      </div>
      <p className="lede">Claude reads them first - look over what it fixed, then Approve. The graphics are planned from the words you approve.</p>
      <video ref={player} className="motion-check-video" src={url} playsInline controls preload="metadata" />
      <CaptionReview
        name={session.fileName}
        file={null}
        initial={initial}
        embedded={embedded}
        quick={quick}
        onTimeline={() => setQuick(false)}
        approveLabel="Approve - plan the graphics"
        onRecheck={postingHere() ? (phrases) => recheckCaptions(phrases, [], undefined, recheckContext(session)) : undefined}
        recheckKey={`motion:${session.id}`}
        onChange={() => {}}
        onApprove={(words) => finish(words, false)}
        onSkip={(words) => finish(words, true)}
        onClose={(words) => finish(words, false)}
      />
    </section>
  )
}

/** What a glass scene is, for its row on the plan screen. */
function glassLabel(scene: Storyboard['scenes'][number]): string {
  const part = scene.parts[0]
  if (!part) return ''
  if (part.kind === 'steps') return 'Light screen with your steps'
  const where = 'place' in part ? (part.place === 'behind' ? 'behind you' : part.place === 'side' ? 'at your side' : 'under your face') : ''
  return `Glass card ${where}`
}

/** What Claude is told about a motion video when it checks its captions:
 *  what he asked for, and the plan's own words on screen - the names and
 *  numbers it should expect to hear. */
function recheckContext(session: MotionSession): RecheckContext {
  const board = session.storyboard
  const onScreen = (board?.scenes ?? []).flatMap((scene) =>
    scene.parts.flatMap((part) => ('text' in part && typeof part.text === 'string' ? [part.text] : part.kind === 'cards' ? part.cards.map((c) => c.badge) : [])),
  )
  return {
    campaign: 'Motion graphics - his own talking video',
    brand: [],
    about: [session.ask, ...onScreen].filter(Boolean).join(' · ').slice(0, 1000),
    angle: '',
    headline: '',
  }
}

/** The Cutter's own caption screen (CaptionReview) on this video: fix the
 *  words, where they sit, how big, which style - or make it without them.
 *  The graphics keep their moments whatever he types. Done with nothing
 *  given back means he left without changing anything. */
function EditCaptions({ session, onDone }: { session: MotionSession; onDone: (captions: CaptionChoice | null) => void }) {
  const plan = session.plan!
  const wordsLook = session.storyboard ? formatOf(session.storyboard) === 'glass' : false
  const [choice, setChoice] = useState<CaptionChoice>(() => ({ ...session.captions }))
  const [initial] = useState(() => captionsToEdit(plan, session.captions))
  const look = captionLook(choice)
  const sameWords = (words: CaptionWord[]) => words.map((w) => w.text.trim()).join(' ') === initial.map((w) => w.text.trim()).join(' ')
  // Words he didn't change stay "as heard", so the plan doesn't say they were.
  const save = (words: CaptionWord[], off: boolean) =>
    onDone({ ...choice, edited: session.captions?.edited || !sameWords(words) ? words : undefined, off })
  return (
    <CaptionReview
      name={session.fileName}
      file={session.file}
      initial={initial}
      approveLabel="Done"
      position={look.position}
      onPosition={(position) => setChoice((c) => ({ ...c, position }))}
      size={look.size}
      onSize={(size) => setChoice((c) => ({ ...c, size }))}
      captionStyle={look.style}
      // Claude's look at the captions, as on Videos: by itself the first time
      // they are opened (recheckKey), and again on a tap - the words it
      // thinks were heard wrong, fixed, each one shown to keep or undo.
      onRecheck={postingHere() ? (phrases) => recheckCaptions(phrases, [], undefined, recheckContext(session)) : undefined}
      recheckKey={`motion:${session.id}`}
      // The words look draws its own blocks: one word / highlight does nothing there.
      onCaptionStyle={wordsLook ? undefined : (style) => setChoice((c) => ({ ...c, style }))}
      onChange={() => {}}
      onApprove={(words) => save(words, false)}
      onSkip={(words) => save(words, true)}
      onClose={(words) => (sameWords(words) && JSON.stringify(choice) === JSON.stringify({ ...session.captions }) ? onDone(null) : save(words, choice.off === true))}
    />
  )
}

function Working({ what, fraction, note }: { what: string; fraction?: number; note?: string }) {
  return (
    <div className="motion-working">
      <p className="row-name">
        {what}
        {fraction !== undefined ? ` · ${Math.round(fraction * 100)}%` : '…'}
      </p>
      {fraction !== undefined ? (
        <div className="motion-bar">
          <div style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      ) : null}
      {note ? <p className="hint">{note}</p> : null}
    </div>
  )
}

/** The storyboard before it is made: a big still to scrub through, a line and
 *  a small still for each scene, and the chat. */
function PlanScreen({
  session,
  onChange,
  onMake,
  onStartOver,
  onCaptions,
  onFormat,
  making,
}: {
  session: MotionSession
  onChange: (next: MotionSession) => void
  /** With the plan as changed by what he had typed, sent first. */
  onMake: (given?: MotionSession) => void
  onStartOver: () => void
  onCaptions: () => void
  onFormat: (format: FormatAsk) => void
  making: boolean
}) {
  const plan = session.plan!
  const choice = session.captions
  const shown = useMemo(() => shownCaptions(plan, choice), [plan, choice])
  // What he types to change the plan: never lost by tapping Make - Make
  // sends it first (his ask, 2026-11-11: "I always click Make and it makes
  // the video without sending my fix").
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [chatProblem, setChatProblem] = useState<string | null>(null)
  const send = async (): Promise<MotionSession | null> => {
    const said = draft.trim()
    if (!said || sending || !session.plan || !session.storyboard) return null
    setSending(true)
    setChatProblem(null)
    const chat: ChatTurn[] = [...session.chat, { from: 'him', text: said }]
    try {
      const words = storyWords(session.plan)
      const answer = await withinMinutes(
        motionPlan({ job: `${session.id}-${Date.now().toString(36)}`, ...forClaude(words, session.plan), ask: session.ask, storyboard: session.storyboard, chat }),
        PLAN_MINUTES,
      )
      const next: MotionSession = {
        ...session,
        storyboard: answer.storyboard,
        chat: [...chat, { from: 'claude', text: answer.reply || 'Done.' }],
        costCents: session.costCents + answer.costCents,
      }
      onChange(next)
      setDraft('')
      return next
    } catch (error) {
      setChatProblem(message(error))
      return null
    } finally {
      setSending(false)
    }
  }
  const unsent = draft.trim().length > 0
  const look = formatOf(session.storyboard!)
  const board = session.storyboard!
  const words = useMemo(() => storyWords(plan), [plan])
  const timing = useMemo(() => cutTiming(words, plan.keep), [words, plan])
  const length = cutLength(plan.keep)
  const [at, setAt] = useState(() => Math.min(length, Math.max(0, (board.scenes[0] ? timing.start(board.scenes[0].from) : 0) + 1.5)))
  const reader = useRef<FrameReader | null>(null)
  const big = useRef<HTMLCanvasElement>(null)
  const [stills, setStills] = useState<Record<number, string>>({})

  useEffect(() => {
    reader.current = new FrameReader(session.file, STILL.width, STILL.height)
    return () => {
      reader.current?.dispose()
      reader.current = null
    }
  }, [session.file])

  // The big still, redrawn as he slides.
  useEffect(() => {
    let alive = true
    const canvas = big.current
    if (!canvas || !reader.current) return
    void drawStill(reader.current, canvas, board, timing, shown, plan.keep, at, choice).then(() => {
      if (!alive) return
    })
    return () => {
      alive = false
    }
  }, [at, board, timing, shown, plan.keep, choice])

  // A small still of each scene, in its middle once its parts are up.
  useEffect(() => {
    let alive = true
    setStills({})
    void (async () => {
      for (const [i, scene] of board.scenes.entries()) {
        if (!reader.current) return
        const t = Math.min(timing.end(scene.to), lastPartAt(scene, timing) + 0.8)
        const canvas = document.createElement('canvas')
        canvas.width = STILL.width
        canvas.height = STILL.height
        await drawStill(reader.current, canvas, board, timing, shown, plan.keep, t, choice)
        if (!alive) return
        const url = canvas.toDataURL('image/jpeg', 0.7)
        setStills((s) => ({ ...s, [i]: url }))
      }
    })()
    return () => {
      alive = false
    }
  }, [board, timing, shown, plan.keep, choice])

  return (
    <div className="motion-plan">
      <p className="lede">Claude's plan. Slide to see any moment, or tap a scene. Change anything by telling Claude below - nothing is made until you tap Make.</p>
      <div className="motion-stage">
        <canvas ref={big} width={STILL.width} height={STILL.height} className="motion-still" />
        <input type="range" min={0} max={Math.max(0.1, length)} step={0.05} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label="Where in the video" />
        <div className="hint">
          {clock(at)} / {clock(length)}
        </div>
      </div>
      <ul className="rows group motion-scenes">
        {board.title ? (
          <li>
            <button type="button" className="row-link" onClick={() => setAt(1.2)}>
              <span className="row-text">
                <span className="row-name">0:00 · Title over your head</span>
                <span className="row-line">{board.title.text}</span>
              </span>
            </button>
          </li>
        ) : null}
        {board.hook ? (
          <li>
            <button type="button" className="row-link" onClick={() => setAt(timing.start(board.hook!.at) + 0.9)}>
              <span className="row-text">
                <span className="row-name">{clock(timing.start(board.hook.at))} · Over your face</span>
                <span className="row-line">
                  {board.hook.label ? `${board.hook.label}: ` : ''}
                  {board.hook.text}, counting up
                </span>
              </span>
            </button>
          </li>
        ) : null}
        {board.scenes.map((scene, i) => (
          <li key={`${scene.from}-${i}`}>
            <button type="button" className="row-link motion-scene" onClick={() => setAt(Math.min(timing.end(scene.to), lastPartAt(scene, timing) + 0.8))}>
              {stills[i] ? <img src={stills[i]} alt="" className="motion-thumb" /> : <span className="motion-thumb" />}
              <span className="row-text">
                <span className="row-name">
                  {clock(timing.start(scene.from))}–{clock(timing.end(scene.to))}
                  {look === 'board' ? (popScene(scene) ? ' · Card over your face' : ' · Board') : ` · ${glassLabel(scene)}`}
                </span>
                <span className="row-line">{scene.says || scene.parts.map((p) => p.kind).join(', ')}</span>
              </span>
            </button>
          </li>
        ))}
        {board.end ? (
          <li>
            <button type="button" className="row-link" onClick={() => setAt(timing.start(board.end!.at) + 0.5)}>
              <span className="row-text">
                <span className="row-name">{clock(timing.start(board.end.at))} · Call to action</span>
                <span className="row-line">{board.end.text}</span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
      <SoundEffects session={session} onChange={onChange} disabled={making} />
      <div className="motion-look">
        <span className="hint">
          Look: <strong>{FORMAT_INFO[look].name}</strong>
          {session.format === 'auto' || !session.format ? ' (Claude picked it)' : ''}
        </span>
        <button type="button" className="linkbtn" disabled={making} onClick={() => window.confirm(`Plan it again as ${FORMAT_INFO[look === 'board' ? 'glass' : 'board'].name}? This plan is replaced.`) && onFormat(look === 'board' ? 'glass' : 'board')}>
          Switch to {look === 'board' ? 'Format 2 · Glass' : 'Format 1 · Board'}
        </button>
      </div>
      <button type="button" className="btn wide" disabled={making} onClick={onCaptions}>
        {choice?.off ? 'Captions off - turn on or edit' : choice?.edited ? 'Edit captions (changed)' : 'Edit captions · Claude checks them'}
      </button>
      <Chat session={session} disabled={making} text={draft} onText={setDraft} sending={sending} problem={chatProblem} onSend={() => void send()} />
      <div className="motion-actions">
        <button
          type="button"
          className="btn primary wide"
          disabled={making || sending}
          onClick={() => {
            if (!unsent) return onMake()
            void send().then((next) => next && onMake(next))
          }}
        >
          {making ? 'Making…' : sending ? 'Sending your change…' : unsent ? 'Send my change, then make the video' : 'Make the video'}
        </button>
        <button type="button" className="linkbtn" disabled={making} onClick={onStartOver}>
          Start again with another video
        </button>
      </div>
      {session.costCents > 0 ? <p className="hint">Claude so far on this video: {session.costCents < 1 ? 'under 1¢' : `${Math.round(session.costCents)}¢`}</p> : null}
    </div>
  )
}

function lastPartAt(scene: Storyboard['scenes'][number], timing: Timing): number {
  const ats: number[] = []
  for (const part of scene.parts) {
    ats.push(part.at)
    if (part.kind === 'cards') for (const c of part.cards) ats.push(c.at, ...c.lines.map((l) => l.at))
    if (part.kind === 'list' || part.kind === 'icons') ats.push(...part.items.map((i) => i.at))
    if (part.kind === 'tiles') ats.push(...part.steps.map((s) => s.at))
    if (part.kind === 'phones') ats.push(...part.items.map((i) => i.at), ...part.prices.map((p) => p.at))
    if (part.kind === 'math') ats.push(...part.lines.map((l) => l.at), part.result.at)
  }
  return timing.start(Math.max(scene.from, ...ats))
}

/** One frame as it will be made: his face (moved down under the board), the
 *  graphics, the caption. */
async function drawStill(
  reader: FrameReader,
  canvas: HTMLCanvasElement,
  board: Storyboard,
  timing: Timing,
  shown: ReturnType<typeof storyWords>,
  keep: { start: number; end: number }[],
  t: number,
  choice?: CaptionChoice,
): Promise<void> {
  const frame = await reader.frameAt(rawTimeAt(t, keep))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  const drop = faceDropAt(board, timing, t, height)
  fillBehindFace(ctx, width, drop)
  if (frame) ctx.drawImage(frame as CanvasImageSource, 0, drop, width, height)
  drawMotion(ctx, width, height, board, timing, t)
  // The Cutter's own captions, in every look (his rule, 2026-11-11).
  drawCaptionAt(ctx, width, height, shown, keep, t, choice, { storyboard: board, timing })
}

/** The chat with Claude about the plan: each message changes the storyboard.
 *  What he types is kept by the plan screen, so Make can send it first. */
function Chat({
  session,
  disabled,
  text,
  onText,
  sending,
  problem,
  onSend,
}: {
  session: MotionSession
  disabled: boolean
  text: string
  onText: (text: string) => void
  sending: boolean
  problem: string | null
  onSend: () => void
}) {
  const seconds = useElapsed(sending)
  return (
    <div className="motion-chat">
      <div className="list-title">Tell Claude what to change</div>
      {session.chat.length > 0 ? (
        <ul className="motion-turns">
          {session.chat.map((turn, i) => (
            <li key={i} className={turn.from === 'him' ? 'him' : 'claude'}>
              {turn.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="motion-say field">
        <textarea
          rows={2}
          value={text}
          disabled={disabled || sending}
          placeholder="e.g. make the sum come in later, drop the phones, why a grid here?"
          onChange={(e) => onText(e.target.value)}
        />
        <button type="button" className="btn primary" disabled={disabled || sending || !text.trim()} onClick={onSend}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
      {sending ? (
        <p className="hint motion-changing">
          <span className="motion-pulse" aria-hidden /> Claude is changing the plan · {seconds} s
        </p>
      ) : null}
      {problem ? <p className="hint warn-text">{problem}</p> : null}
    </div>
  )
}

function Done({ session, onEdit, onAnother }: { session: MotionSession; onEdit: () => void; onAnother: () => void }) {
  const url = useMemo(() => (session.made ? URL.createObjectURL(session.made) : null), [session.made])
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])
  const name = `${session.fileName.replace(/\.[^.]+$/, '')}_motion.mp4`
  const file = useSharable(session.made, name)
  const [note, setNote] = useState<string | null>(null)
  return (
    <div className="motion-done">
      <p className="lede">Made. Save it to your phone to post it - or New post on the Posts tab sends it through Postiz.</p>
      {url ? <video className="motion-video" src={url} controls playsInline /> : null}
      <div className="motion-actions">
        {hasShareSheet() ? (
          <button
            type="button"
            className="btn primary wide"
            disabled={!file}
            onClick={() => void (file ? shareVideo(file).then((ok) => setNote(ok ? null : "The share sheet didn't open - try again.")) : null)}
          >
            {file ? 'Save / share' : 'Getting it ready…'}
          </button>
        ) : url ? (
          <a className="btn primary wide" href={url} download={name}>
            Download
          </a>
        ) : null}
        <button type="button" className="btn wide" onClick={onEdit}>
          Change the graphics and make it again
        </button>
        <button type="button" className="linkbtn" onClick={onAnother}>
          Make another
        </button>
      </div>
      {note ? <p className="hint warn-text">{note}</p> : null}
    </div>
  )
}
