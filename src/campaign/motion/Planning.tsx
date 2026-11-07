// What he sees while Claude plans the graphics (20 s to a couple of minutes):
// his ask (2026-11-08) "make a little ui showing anything just getting
// prepared ... because its boring and idk if its working".
//
// Everything on it is true: a clock counting the seconds since his words
// went to Claude (so he sees it is alive), his own words with a light moving
// through them and the numbers he says picked out on the phone - the things
// graphics are made of - and the style playing over his own face. Nothing
// pretends to know how far Claude has got: it doesn't say.

import { useEffect, useMemo, useRef, useState } from 'react'

import { cleanStoryboard, type FormatAsk } from '../../../supabase/functions/postiz/motion.ts'
import { drawMotion, faceDropAt, fillBehindFace, type Timing } from './draw'
import { FrameReader } from './frames'
import { MiniPhone } from './FormatPicker'

/** Seconds since `active` became true, ticking once a second; 0 while off. */
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const started = Date.now()
    setSeconds(0)
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])
  return seconds
}

const NUMBER_WORDS = /^(dollars?|euros?|bucks|k|m|percent|%|\$|€|views?|vues?|videos?|vidéos?|followers?|days?|jours?|per|par|a|times|x|months?|mois|hours?|heures?)$/i

/** The numbers he says, with the word after when it says what they count
 *  ("25 dollars", "10K", "10 000 views") - what graphics are made of. Each
 *  once, in the order said, at most `max`. */
export function numbersSaid(words: readonly string[], max = 8): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const bare = words.map((w) => w.trim().replace(/^[("'“]+|[)"'”.,!?;:]+$/g, ''))
  for (let i = 0; i < bare.length && out.length < max; i++) {
    if (!/\d/.test(bare[i])) continue
    let phrase = bare[i]
    let j = i + 1
    // "10 000": thousands said as two words.
    while (j < bare.length && /^\d{3}$/.test(bare[j]) && /\d$/.test(phrase)) phrase += ` ${bare[j++]}`
    if (j < bare.length && NUMBER_WORDS.test(bare[j]) && !/[$€%]|k$/i.test(phrase)) phrase += ` ${bare[j++]}`
    i = j - 1
    const key = phrase.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(phrase)
  }
  return out
}

/** The style, looping over his face: a scene coming up, cards, a grid
 *  filling, a sum counting up. Not his plan - that is what Claude is
 *  writing. */
const DEMO_WORDS = 34
const DEMO_STEP = 0.25
const DEMO_LOOP = DEMO_WORDS * DEMO_STEP + 1.2
const demoTiming: Timing = { start: (i) => 0.4 + i * DEMO_STEP, end: (i) => 0.4 + i * DEMO_STEP + 0.2 }
const DEMO = cleanStoryboard(
  {
    scenes: [
      {
        from: 0,
        to: 14,
        says: '',
        parts: [
          { kind: 'title', at: 0, text: 'Your graphics' },
          {
            kind: 'cards',
            at: 2,
            cards: [
              { badge: 'Idea', tone: 'purple', at: 2, lines: [{ text: 'on your words', at: 5, mark: 'check' }] },
              { badge: 'Numbers', tone: 'green', at: 4, lines: [{ text: 'counting up', at: 7, mark: 'check' }] },
            ],
          },
        ],
      },
      {
        from: 15,
        to: 32,
        says: '',
        parts: [
          { kind: 'tiles', at: 15, count: 10, steps: [{ at: 16, filled: 3, tone: 'purple', locked: true }, { at: 22, filled: 10, tone: 'green', locked: false }] },
          { kind: 'math', at: 24, lines: [{ text: '10 videos', at: 24 }, { text: '× 1,500 views', at: 26 }], result: { text: '= 15,000 views', at: 28 } },
        ],
      },
    ],
  },
  DEMO_WORDS,
)

function DemoBoard({ file, raw }: { file: Blob; raw: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [face, setFace] = useState<CanvasImageSource | null>(null)
  useEffect(() => {
    const reader = new FrameReader(file, 180, 320)
    let alive = true
    void reader.frameAt(raw).then((frame) => {
      if (alive && frame) setFace(frame as CanvasImageSource)
    })
    return () => {
      alive = false
      reader.dispose()
    }
  }, [file, raw])
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    let frame = 0
    const started = performance.now()
    const draw = () => {
      const t = ((performance.now() - started) / 1000) % DEMO_LOOP
      const { width, height } = el
      ctx.fillStyle = '#1b1b22'
      ctx.fillRect(0, 0, width, height)
      const drop = faceDropAt(DEMO, demoTiming, t, height)
      fillBehindFace(ctx, width, drop)
      if (face) ctx.drawImage(face, 0, drop, width, height)
      drawMotion(ctx, width, height, DEMO, demoTiming, t)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [face])
  return <canvas ref={canvas} width={360} height={640} className="motion-demo" aria-label="The style of the graphics, playing" />
}

/** His words with a light going through them, as Claude reads them: a
 *  window of words that moves on with the light, so it never runs out of
 *  sight on a long video. */
function Reading({ words }: { words: readonly string[] }) {
  const [lit, setLit] = useState(0)
  useEffect(() => {
    if (words.length === 0) return
    const timer = setInterval(() => setLit((i) => (i + 1) % words.length), 140)
    return () => clearInterval(timer)
  }, [words.length])
  const from = Math.max(0, lit - 14)
  const shown = words.slice(from, from + 40)
  return (
    <p className="motion-reading" aria-hidden>
      {from > 0 ? '… ' : null}
      {shown.map((w, k) => {
        const i = from + k
        return (
          <span key={i} className={i === lit ? 'lit' : Math.abs(i - lit) < 3 ? 'near' : undefined}>
            {w.trim()}{' '}
          </span>
        )
      })}
    </p>
  )
}

/** The planning screen: alive, honest, and something to look at. */
export function Planning({ words, file, raw, ask, format = 'board' }: { words: readonly string[]; file: Blob; raw: number; ask: string; format?: FormatAsk }) {
  const seconds = useElapsed(true)
  const numbers = useMemo(() => numbersSaid(words), [words])
  // The numbers come in one after another, not all at once.
  const numbersShown = Math.min(numbers.length, Math.floor(seconds / 1.5) + 1)
  const note =
    seconds < 40
      ? 'Usually 20 seconds to a minute.'
      : seconds < 120
        ? 'Still working - a long video takes a bit longer.'
        : 'Taking longer than usual - still waiting. If Claude gets stuck it says so.'
  return (
    <div className="motion-planning">
      <div className="motion-planning-head">
        <span className="motion-pulse" aria-hidden />
        <span className="row-name">Claude is planning your graphics</span>
        <span className="motion-clock">{seconds} s</span>
      </div>
      <p className="hint">
        Your {words.length} words went to Claude{ask.trim() ? `, with "${ask.trim().slice(0, 80)}"` : ''}. {note}
      </p>
      <Reading words={words} />
      {numbers.length > 0 ? (
        <div className="motion-numbers">
          <span className="hint">Numbers you say - they make the best graphics:</span>
          <div className="motion-chips">
            {numbers.slice(0, numbersShown).map((n) => (
              <span key={n} className="motion-chip">
                {n}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {format === 'words' ? <MiniPhone format="words" /> : <DemoBoard file={file} raw={raw} />}
      <p className="hint motion-demo-note">The style you get. Your own graphics come from your words.</p>
    </div>
  )
}
