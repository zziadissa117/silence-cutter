// Your voice, once (voiceProfile.ts): about 45 seconds on the mic he films
// with - quiet, a paragraph read the way he talks, a few "um"s, a breath -
// so the cutter knows his room, how his words end, his natural gaps and his
// "um". Asked for once per person; again when his videos start to sound
// different (a new mic).

import { useEffect, useRef, useState } from 'react'

import { LevelMeter } from '../media/audio'
import {
  addProfile,
  chooseVoice,
  chosenVoice,
  loadProfile,
  loadProfiles,
  measureProfile,
  micName,
  offCount,
  removeProfile,
  type SetupMarks,
  type VoiceProfile,
} from './voiceProfile'

const QUIET_SEC = 3
const BREATH_SEC = 3

/** What he reads, written to touch every part of talking a cutter can get
 *  wrong (his ask, 2026-11-11: "a specific paragraph ... to hit every single
 *  area of our speech"): words that start soft ("honestly", "here", "five",
 *  "thirty") and end soft ("fast", "it", "facts", "shifts", "half"); a fast
 *  list with no pause; a question; numbers; short pauses at the commas and
 *  long ones where it says so; a last word that trails off. Each line on its
 *  own, a long pause between lines. */
export const READ_LINES: readonly string[] = [
  "Honestly, here's what I've learned from posting every single day.",
  'First, film it fast. Second, fix the sound. Third, post it - then forget it.',
  'Does it feel weird at first? Of course it does.',
  'But after thirty days, sixty videos, maybe a hundred, something shifts.',
  "You stop overthinking it, you just say what you think... and that's it.",
]
export const READ_TEXT = READ_LINES.join(' ')

type Step = 'intro' | 'quiet' | 'read' | 'um' | 'breath' | 'measuring' | 'done' | 'failed'

/** Shown on the Videos tab: no voice set up yet, or his videos sound unlike it. */
export function voiceReminder(): 'none' | 'changed' | null {
  if (!loadProfile()) return 'none'
  return offCount() >= 2 ? 'changed' : null
}

export function VoiceSetup({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('intro')
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [mic, setMic] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [made, setMade] = useState<VoiceProfile | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const marks = useRef<Partial<SetupMarks>>({})
  const had = loadProfile()

  const since = () => (performance.now() - startedAt.current) / 1000

  // The mics the phone has, once it lets the page hear one.
  const listMics = async () => {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    setMics(all.filter((d) => d.kind === 'audioinput'))
  }
  useEffect(() => {
    void listMics()
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const start = async () => {
    setProblem(null)
    try {
      const got = await navigator.mediaDevices.getUserMedia({
        // His voice as it is: no cleaning, so it sounds as his videos do.
        audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      stream.current = got
      void listMics()
      chunks.current = []
      const rec = new MediaRecorder(got)
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
      recorder.current = rec
      rec.start()
      startedAt.current = performance.now()
      marks.current = {}
      setStep('quiet')
    } catch (error) {
      setProblem(`The mic couldn't be opened: ${error instanceof Error ? error.message : String(error)}. Allow the microphone for this page and try again.`)
    }
  }

  const finish = async () => {
    const rec = recorder.current
    if (!rec) return
    setStep('measuring')
    const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()))
    rec.stop()
    await stopped
    const label = stream.current?.getAudioTracks()[0]?.label
    stream.current?.getTracks().forEach((t) => t.stop())
    try {
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/mp4' })
      const context = new AudioContext()
      const audio = await context.decodeAudioData(await blob.arrayBuffer())
      void context.close()
      const meter = new LevelMeter(audio.sampleRate)
      meter.push(
        Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c)),
        0,
      )
      meter.flush()
      const m = marks.current
      const profile =
        m.quietEnd !== undefined && m.readStart !== undefined && m.readEnd !== undefined
          ? measureProfile(meter.levels, { quietEnd: m.quietEnd, readStart: m.readStart, readEnd: m.readEnd, umStart: m.umStart, umEnd: m.umEnd }, label)
          : null
      if (!profile) {
        setProblem("Your voice couldn't be told apart from the room - somewhere quieter, or closer to the mic, and try again.")
        setStep('failed')
        return
      }
      setMade(addProfile({ ...profile, name: micName(label) }))
      setStep('done')
    } catch (error) {
      setProblem(`It couldn't be measured: ${error instanceof Error ? error.message : String(error)}`)
      setStep('failed')
    }
  }

  // A step that ends by itself: the quiet, the breath.
  useEffect(() => {
    if (step !== 'quiet' && step !== 'breath') return
    setLeft(step === 'quiet' ? QUIET_SEC : BREATH_SEC)
    const timer = window.setInterval(() => setLeft((n) => n - 1), 1000)
    const done = window.setTimeout(
      () => {
        if (step === 'quiet') {
          marks.current.quietEnd = since()
          marks.current.readStart = since()
          setStep('read')
        } else void finish()
      },
      (step === 'quiet' ? QUIET_SEC : BREATH_SEC) * 1000,
    )
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(done)
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="screen voice-setup" aria-label="Your voice">
      <div className="screen-head">
        <h1>Your voice</h1>
      </div>

      {step === 'intro' || step === 'failed' ? (
        <>
          <p className="lede">
            About 45 seconds, once: the cutter learns how your room sounds, how your words end, your natural pauses and your "um" - so it
            cuts your silences without touching your words.
          </p>
          <div className="callout voice-mic">
            <p>
              <strong>Use the mic you film with.</strong> If you change mic or phone later, do this again - the Cutter will remind you when
              your videos start to sound different.
            </p>
          </div>
          {mics.length > 1 ? (
            <label className="field">
              <span className="label">Mic</span>
              <select value={mic} onChange={(e) => setMic(e.target.value)}>
                <option value="">The phone's usual mic</option>
                {mics.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Mic ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {had ? <p className="hint">Recording on a mic you set up before replaces that one; another mic is added as another voice.</p> : null}
          {problem ? <div className="error">{problem}</div> : null}
          <div className="actions-row">
            <button type="button" className="btn primary" onClick={() => void start()}>
              {step === 'failed' ? 'Try again' : 'Start'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {had ? 'Back' : 'Later'}
            </button>
          </div>
        </>
      ) : null}

      {step === 'quiet' ? (
        <div className="voice-step">
          <div className="voice-dot" aria-hidden />
          <h2>Stay quiet</h2>
          <p className="hint">Listening to your room… {Math.max(0, left)}</p>
        </div>
      ) : null}

      {step === 'read' ? (
        <div className="voice-step">
          <div className="voice-dot" aria-hidden />
          <h2>Read this out loud, the way you talk</h2>
          <div className="voice-read">
            {READ_LINES.map((line, i) => (
              <p key={i}>
                {line}
                {i < READ_LINES.length - 1 ? <span className="voice-pause"> · pause · </span> : null}
              </p>
            ))}
          </div>
          <p className="hint">Your normal speed. Stop for a second where it says pause.</p>
          <button
            type="button"
            className="btn primary wide"
            onClick={() => {
              marks.current.readEnd = since()
              marks.current.umStart = since()
              setStep('um')
            }}
          >
            Done reading
          </button>
        </div>
      ) : null}

      {step === 'um' ? (
        <div className="voice-step">
          <div className="voice-dot" aria-hidden />
          <h2>Now say your "um"s</h2>
          <p className="voice-read">"Um" … "uh" … "umm" … the way you do when you think - with a pause between each.</p>
          <button
            type="button"
            className="btn primary wide"
            onClick={() => {
              marks.current.umEnd = since()
              setStep('breath')
            }}
          >
            Done
          </button>
        </div>
      ) : null}

      {step === 'breath' ? (
        <div className="voice-step">
          <div className="voice-dot" aria-hidden />
          <h2>Take one normal breath</h2>
          <p className="hint">{Math.max(0, left)}</p>
        </div>
      ) : null}

      {step === 'measuring' ? <p className="hint">Measuring your voice…</p> : null}

      {step === 'done' && made ? (
        <>
          <p className="lede">
            Done: "{made.name}". Every video that sounds like it is cut for your voice on that mic
            {loadProfiles().length > 1 ? ' - the Cutter picks the right voice for each video by itself' : ''}.
          </p>
          <ul className="voice-facts">
            <li>Your room: {Math.round(made.roomDb)} dB · your voice: {Math.round(made.speechDb)} dB</li>
            <li>Your natural gap between words: {Math.round(made.gapSec * 100) / 100} s - never cut</li>
            <li>{made.umDb !== undefined ? 'Your "um" is learned - the cutter looks for it in every video.' : 'No "um" heard - the cutter still finds them in your videos.'}</li>
          </ul>
          <button type="button" className="btn primary wide" onClick={onClose}>
            Done
          </button>
        </>
      ) : null}
    </section>
  )
}

/** His voices in Settings: which one each video takes - automatic, or the one
 *  he pins - each to take out, and another to add (another mic). */
export function VoiceList({ onAdd }: { onAdd: () => void }) {
  const [voices, setVoices] = useState(() => loadProfiles())
  const [use, setUse] = useState(() => chosenVoice())
  const pick = (id: string) => {
    chooseVoice(id)
    setUse(id)
  }
  return (
    <div className="setting voice-list">
      <div className="setting-text">
        <span className="row-name">{voices.length === 0 ? 'Not set up yet' : `${voices.length} voice${voices.length === 1 ? '' : 's'}`}</span>
        {voices.length === 0 ? (
          <span className="row-line wrap">45 seconds so the cutter knows how you talk and never cuts your words.</span>
        ) : (
          <>
            <span className="row-line wrap">Each video uses the voice it sounds like - or pin one (filming without your mic, say).</span>
            <div className="warmup-chips">
              <button type="button" className={`chip${use === 'auto' ? ' on' : ''}`} aria-pressed={use === 'auto'} onClick={() => pick('auto')}>
                Automatic
              </button>
              {voices.map((v) => (
                <button key={v.id} type="button" className={`chip${use === v.id ? ' on' : ''}`} aria-pressed={use === v.id} onClick={() => pick(v.id!)}>
                  {v.name ?? 'My voice'}
                </button>
              ))}
            </div>
            {voices.map((v) => (
              <span key={v.id} className="row-line">
                {v.name ?? 'My voice'} · {new Date(v.at).toLocaleDateString()}{' '}
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    if (!window.confirm(`Take out "${v.name ?? 'this voice'}"?`)) return
                    removeProfile(v.id!)
                    setVoices(loadProfiles())
                    setUse(chosenVoice())
                  }}
                >
                  take out
                </button>
              </span>
            ))}
          </>
        )}
      </div>
      <button type="button" className={`btn small${voices.length === 0 ? ' primary' : ''}`} onClick={onAdd}>
        {voices.length === 0 ? 'Set up' : '+ Voice'}
      </button>
    </div>
  )
}
