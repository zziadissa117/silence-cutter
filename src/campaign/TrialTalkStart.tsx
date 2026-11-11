// Trial reels -> Talking (his ask, 2026-11-11): one talking clip that did
// well, made again and again with the same words and captions, a new
// headline and one of his songs each time. Here he picks the clip and its
// songs, checks the captions once (Claude reads them first, as for every
// talking video), and crosses out the headlines Claude wrote that he doesn't
// like; then the loop makes the copies (trialLoop.ts TrialTalk).

import { useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { CaptionReview } from './CaptionReview'
import type { CaptionWord } from './captions'
import type { Song } from './musicBank'
import type { CampaignPlan } from './plan'
import { postingHere, recheckCaptions, trialHeadlines } from './posting'
import { cutTalk, hearTalk, spokenText, wordsOnCut, wordsToCheck } from './trialTalk'

export interface TalkToAdd {
  name: string
  /** The clip cut once. */
  cut: File
  /** The captions on the cut clip's timeline. */
  words: CaptionWord[]
  headlines: string[]
  songs: Song[]
}

type Step =
  | { kind: 'pick' }
  | { kind: 'hearing'; phase: string; progress: number }
  | { kind: 'captions'; plan: CampaignPlan }
  | { kind: 'headlines'; plan: CampaignPlan; checked: CaptionWord[] }

export function TrialTalkStart({
  songs,
  check,
  onAdd,
  onFull,
  busyElsewhere,
}: {
  /** His music bank's songs. */
  songs: Song[]
  /** What stops it starting (no account picked…), or null. */
  check: () => string | null
  onAdd: (talk: TalkToAdd, onBusy: (what: string) => void) => Promise<void>
  /** Whether it takes the whole screen (the captions check). */
  onFull: (full: boolean) => void
  busyElsewhere: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [step, setStepNow] = useState<Step>({ kind: 'pick' })
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [headlines, setHeadlines] = useState<string[]>([])
  const [own, setOwn] = useState('')
  const setStep = (next: Step) => {
    setStepNow(next)
    onFull(next.kind === 'captions')
  }

  const start = async () => {
    setProblem(null)
    // His ask: the video is checked first - picked, or said so.
    if (!file) return setProblem('Pick your talking video first.')
    if (picked.size === 0) return setProblem('Pick at least one song from your music bank.')
    const blocked = check()
    if (blocked) return setProblem(blocked)
    try {
      setStep({ kind: 'hearing', phase: 'Listening…', progress: 0 })
      const plan = await hearTalk(file, [], (phase, p) =>
        setStepNow({
          kind: 'hearing',
          phase: phase === 'model' ? 'Getting the speech model ready…' : 'Listening…',
          progress: p,
        }),
      )
      if (wordsToCheck(plan).length < 3) {
        setStep({ kind: 'pick' })
        return setProblem("Hardly any talking was heard in this video. For a video without talking, pick 'Not talking' above.")
      }
      setStep({ kind: 'captions', plan })
    } catch (error) {
      setStep({ kind: 'pick' })
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const write = async (words: CaptionWord[], have: string[]) => {
    setBusy('Claude is writing the headlines…')
    setProblem(null)
    try {
      const more = await trialHeadlines(spokenText(words), have)
      setHeadlines((now) => [...now, ...more.filter((h) => !now.includes(h))])
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const approved = (plan: CampaignPlan, checked: CaptionWord[]) => {
    setStep({ kind: 'headlines', plan, checked })
    setHeadlines([])
    void write(checked, [])
  }

  const go = async (plan: CampaignPlan, checked: CaptionWord[]) => {
    if (!file) return
    const kept = headlines.map((h) => h.trim()).filter(Boolean)
    if (kept.length === 0) return setProblem('Keep at least one headline.')
    setProblem(null)
    try {
      setBusy('Cutting the pauses out, once…')
      const cut = await cutTalk(file, plan, file.name, (p) => setBusy(`Cutting the pauses out, once… ${Math.round(p * 100)}%`))
      await onAdd(
        {
          name: file.name,
          cut,
          words: wordsOnCut(checked, plan),
          headlines: kept,
          songs: songs.filter((s) => picked.has(s.id)),
        },
        (what) => setBusy(what),
      )
      setFile(null)
      setPicked(new Set())
      setHeadlines([])
      setStep({ kind: 'pick' })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  if (step.kind === 'captions') {
    const initial = wordsToCheck(step.plan)
    return (
      <CaptionReview
        name={file?.name ?? 'Talking video'}
        file={file}
        initial={initial}
        quick
        approveLabel="Approve - write the headlines"
        onRecheck={
          postingHere()
            ? (phrases) =>
                recheckCaptions(phrases, [], undefined, {
                  campaign: 'Trial reels - his own talking video',
                  brand: [],
                  about: '',
                  angle: '',
                  headline: '',
                })
            : undefined
        }
        recheckKey={`trial-talk:${file?.name ?? ''}:${file?.size ?? 0}`}
        onChange={() => {}}
        onApprove={(words) => approved(step.plan, words)}
        onSkip={(words) => approved(step.plan, words)}
        onClose={() => setStep({ kind: 'pick' })}
      />
    )
  }

  if (step.kind === 'headlines') {
    return (
      <div className="card-group">
        <div className="setting">
          <div className="setting-text">
            <span className="row-name">Headlines · {headlines.length}</span>
            <span className="row-line wrap">One per copy, each in turn. Take out the ones you don&rsquo;t like, or add your own.</span>
          </div>
        </div>
        {headlines.map((h) => (
          <div key={h} className="setting">
            <div className="setting-text">
              <span className="row-line wrap">{h}</span>
            </div>
            <button
              type="button"
              className="btn small"
              aria-label={`Take out ${h}`}
              disabled={busy !== null}
              onClick={() => setHeadlines((list) => list.filter((x) => x !== h))}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="setting">
          <div className="setting-text">
            <input type="text" value={own} maxLength={140} aria-label="Your own headline" placeholder="Add your own" onChange={(e) => setOwn(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn small"
            disabled={!own.trim() || headlines.includes(own.trim())}
            onClick={() => {
              setHeadlines((list) => [...list, own.trim()])
              setOwn('')
            }}
          >
            Add
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            {busy ? <span className="row-line">{busy}</span> : null}
            {problem ? <span className="row-line warn-text wrap">{problem}</span> : null}
          </div>
          <button type="button" className="btn small" disabled={busy !== null} onClick={() => void write(step.checked, headlines)}>
            Write more
          </button>
          <button type="button" className="btn primary" disabled={busy !== null || busyElsewhere} onClick={() => void go(step.plan, step.checked)}>
            Start
          </button>
        </div>
        <button type="button" className="linkbtn" disabled={busy !== null} onClick={() => setStep({ kind: 'pick' })}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="card-group">
      <div className="setting">
        <div className="setting-text">
          <span className="row-line wrap">
            Your talking video, as you filmed it. The pauses are cut once and you check the captions once; every copy says the same words with the same
            captions, a new headline and one of your songs under your voice.
          </span>
          {file ? <span className="row-line wrap">{file.name}</span> : null}
        </div>
        <VideoPicker className="btn small primary" label="Pick your talking video" onFiles={(files) => files[0] && (setFile(files[0]), setProblem(null))}>
          {file ? 'Pick again' : 'Pick video'}
        </VideoPicker>
      </div>
      <div className="setting">
        <div className="setting-text">
          <span className="row-name">Songs · {picked.size} picked</span>
          <span className="row-line wrap">They take turns evenly, a different order each round.</span>
          {songs.length === 0 ? <span className="row-line warn-text wrap">Your music bank is empty: add songs in More → Music first.</span> : null}
          <div className="warmup-chips">
            {songs.map((s) => {
              const on = picked.has(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`chip${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((now) => {
                      const next = new Set(now)
                      if (on) next.delete(s.id)
                      else next.add(s.id)
                      return next
                    })
                  }
                >
                  {s.name.replace(/\.[^./]+$/, '')}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          {step.kind === 'hearing' ? <span className="row-line">{`${step.phase} ${Math.round(step.progress * 100)}%`}</span> : null}
          {problem ? <span className="row-line warn-text wrap">{problem}</span> : null}
        </div>
        <button type="button" className="btn primary" disabled={step.kind === 'hearing' || busyElsewhere} onClick={() => void start()}>
          Start
        </button>
      </div>
    </div>
  )
}
