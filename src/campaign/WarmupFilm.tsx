// Filming warm-ups one after another (his pick, 2026-11-11: "a film of several
// in one go is a really good idea"): each idea in turn - its example, how to
// film it, its headline to change if he likes - then the camera, its sound
// playing to move to, stopping by itself at its length. Each is made at once
// (warmupMake.ts) and kept until it goes out (warmups.ts keepMade).

import { useEffect, useState } from 'react'

import { Recorder } from './Recorder'
import { makeWarmupVideo } from './warmupMake'
import { keepMade, warmupFile, type WarmupIdea } from './warmups'

type Step = { kind: 'read' } | { kind: 'record' } | { kind: 'making'; progress: number } | { kind: 'done' }

export function WarmupFilm({ ideas, onClose }: { ideas: WarmupIdea[]; onClose: (made: number) => void }) {
  const [index, setIndex] = useState(0)
  const [step, setStep] = useState<Step>({ kind: 'read' })
  const [made, setMade] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const idea = ideas[index]
  const [headline, setHeadline] = useState(idea?.headline ?? '')
  const [sound, setSound] = useState<File | null>(null)
  const [soundGone, setSoundGone] = useState(false)

  // Its sound, ready before the camera opens.
  useEffect(() => {
    setHeadline(idea?.headline ?? '')
    setSound(null)
    setSoundGone(false)
    if (!idea?.sound) return
    let alive = true
    void warmupFile(idea.sound).then((file) => {
      if (!alive) return
      setSound(file)
      setSoundGone(!file)
    })
    return () => {
      alive = false
    }
  }, [idea])

  const next = () => {
    setProblem(null)
    if (index + 1 >= ideas.length) setStep({ kind: 'done' })
    else {
      setIndex(index + 1)
      setStep({ kind: 'read' })
    }
  }

  const make = async (takes: File[]) => {
    if (!idea) return
    setStep({ kind: 'making', progress: 0 })
    try {
      const video = await makeWarmupVideo(takes, idea, headline.trim(), sound ? { audio: sound, name: idea.sound?.name ?? 'Sound' } : null, (p) =>
        setStep({ kind: 'making', progress: p }),
      )
      await keepMade(video, idea, headline.trim())
      setMade((n) => n + 1)
      next()
    } catch (error) {
      setProblem(`It couldn't be made: ${error instanceof Error ? error.message : String(error)}`)
      setStep({ kind: 'read' })
    }
  }

  if (step.kind === 'record' && idea) {
    return (
      <Recorder
        limitSec={idea.seconds}
        sound={sound}
        guide={
          <>
            <strong>{idea.title}</strong>
            {idea.script ? <span>{idea.script}</span> : null}
            <span>
              {idea.seconds} s{sound ? ' · its sound plays while you film' : ''} - it stops by itself.
            </span>
          </>
        }
        onCancel={() => setStep({ kind: 'read' })}
        onDone={(files) => void make(files)}
      />
    )
  }

  if (step.kind === 'done' || !idea) {
    return (
      <section className="screen warmups" aria-label="Warm-ups filmed">
        <div className="screen-head">
          <h1>Done</h1>
        </div>
        <p className="lede">
          {made === 0 ? 'Nothing filmed this time.' : `${made} warm-up${made === 1 ? '' : 's'} ready. They go out on the campaigns you set them for.`}
        </p>
        <button type="button" className="btn primary wide" onClick={() => onClose(made)}>
          Back to Warm-ups
        </button>
      </section>
    )
  }

  return (
    <section className="screen warmups" aria-label="Film a warm-up">
      <div className="screen-head">
        <h1>{idea.title}</h1>
        <span className="hint">
          {index + 1} of {ideas.length}
        </span>
      </div>
      {step.kind === 'making' ? (
        <div className="group">
          <p className="hint">Making it… {Math.round(step.progress * 100)}%</p>
          <div className="bar">
            <div style={{ width: `${Math.round(step.progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <>
          {idea.example && 'link' in idea.example ? (
            <a className="btn small" href={idea.example.link} target="_blank" rel="noreferrer">
              See the example on {/tiktok\.com/i.test(idea.example.link) ? 'TikTok' : 'Instagram'}
            </a>
          ) : null}
          {idea.script ? <p className="warmup-script">{idea.script}</p> : null}
          <label className="field">
            <span className="label">Headline</span>
            <input type="text" value={headline} maxLength={120} onChange={(e) => setHeadline(e.target.value)} />
            <span className="hint">Change it to fit you, or leave it.</span>
          </label>
          <p className="hint">
            {idea.seconds} seconds{idea.sound ? (soundGone ? " · its sound couldn't be fetched - check the signal" : sound ? ` · sound: ${idea.sound.name}` : ' · getting its sound…') : ' · no sound set'}
          </p>
          {problem ? <div className="error">{problem}</div> : null}
          <div className="actions-row">
            <button type="button" className="btn primary" disabled={Boolean(idea.sound) && !sound && !soundGone} onClick={() => setStep({ kind: 'record' })}>
              Film it
            </button>
            <button type="button" className="btn" onClick={next}>
              {index + 1 >= ideas.length ? 'Finish' : 'Skip'}
            </button>
          </div>
          <button type="button" className="linkbtn" onClick={() => onClose(made)}>
            Stop here
          </button>
        </>
      )}
    </section>
  )
}
