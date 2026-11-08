// Before he drops a video: which look, each shown playing in a little phone
// with a line saying what it is and when it fits, and examples of what to
// ask for that he can tap instead of typing. His ask (2026-11-08): "when
// choosing give description and little ui", "in the what you want (optional)
// give me some examples built in there".
//
// The pick is remembered on this phone: tapped once, it is his default until
// he taps another.

import { useEffect, useRef } from 'react'

import { cleanStoryboard, type FormatAsk, type Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import { drawMotion, faceDropAt, fillBehindFace, type Timing } from './draw'
import { kineticPhrases, type Kinetic } from './words'

const KEY = 'motion.format'

export function savedFormat(): FormatAsk {
  try {
    const kept = localStorage.getItem(KEY)
    return kept === 'board' || kept === 'words' ? kept : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveFormat(format: FormatAsk): void {
  try {
    localStorage.setItem(KEY, format)
  } catch {
    // Kept for this visit only.
  }
}

export const FORMAT_INFO: Record<FormatAsk, { name: string; line: string }> = {
  auto: {
    name: 'Claude picks',
    line: 'Claude picks the look that fits what you say.',
  },
  board: {
    name: 'Format 1 · Board',
    line: 'Little cards pop up over your face; for the big moments a board with cards, grids and sums. For numbers and money.',
  },
  words: {
    name: 'Format 2 · Words',
    line: 'Your words build up big under your face. For stories and tips.',
  },
}

/** Lines to tap into "What you want", for each look. */
export const EXAMPLES: Record<FormatAsk, string[]> = {
  auto: [
    'Keep it simple: only the main points',
    'Make the money numbers big',
    'Show my tips as a numbered list',
    'Add a follow banner at the end',
  ],
  board: [
    'Show the 3 tips as a list',
    'Put the two options side by side as cards',
    'Build the math up line by line',
    'Make the money count up big',
    'Add a follow banner at the end',
  ],
  words: [
    'Make the key words gold',
    'Number the mistakes with diamonds',
    'Flash the punchline on white',
    'Dim the screen on my reaction',
    'End with big gold "FOLLOW FOR MORE"',
  ],
}

// --- The little phones -------------------------------------------------------

const STEP = 0.32
const at = (i: number) => 0.3 + i * STEP
const demoTiming: Timing = { start: at, end: (i) => at(i) + 0.25 }

const BOARD_DEMO: Storyboard = cleanStoryboard(
  {
    format: 'board',
    scenes: [
      {
        from: 0,
        to: 9,
        says: '',
        parts: [
          { kind: 'title', at: 0, text: '2 types of deals' },
          { kind: 'cards', at: 1, cards: [{ badge: 'Base pay', tone: 'purple', at: 1, lines: [{ text: 'guaranteed', at: 3, mark: 'check' }] }, { badge: 'CPM', tone: 'green', at: 2, lines: [{ text: 'more money', at: 4, mark: 'check' }] }] },
        ],
      },
      {
        from: 11,
        to: 19,
        says: '',
        parts: [{ kind: 'math', at: 11, lines: [{ text: '50 videos', at: 11 }, { text: '× 1,500 views', at: 13 }], result: { text: '= $300 / day', at: 15 } }],
      },
    ],
  },
  22,
)

const WORDS_TEXT = 'here are the three big mistakes. it might actually be worth it, DM EDIT'.split(' ')
const WORDS_DEMO: Storyboard = cleanStoryboard(
  {
    format: 'words',
    grade: 'teal',
    emphasis: [
      { at: 2, style: 'serif' },
      { at: 3, style: 'big' },
      { at: 8, style: 'gold' },
    ],
    scenes: [{ from: 3, to: 5, says: '', parts: [{ kind: 'diamonds', at: 3, items: [{ at: 3 }, { at: 4 }, { at: 5 }] }] }],
  },
  WORDS_TEXT.length,
)
const wordsKinetic: Kinetic = (() => {
  const words = WORDS_TEXT.map((text, i) => ({ text, start: at(i), end: at(i) + 0.25 }))
  const styles = new Map((WORDS_DEMO.emphasis ?? []).map((e) => [e.at, e.style]))
  return { words, timing: demoTiming, phrases: kineticPhrases(words), styleOf: (i) => styles.get(i) ?? null }
})()

const LOOP = at(WORDS_TEXT.length) + 1

/** A stand-in for him: a dark room and a head and shoulders. */
function standIn(ctx: CanvasRenderingContext2D, width: number, height: number, drop: number, warm: boolean): void {
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, warm ? '#3a2a22' : '#22313a')
  bg.addColorStop(1, '#0d0d10')
  ctx.fillStyle = bg
  ctx.fillRect(0, drop, width, height)
  ctx.fillStyle = warm ? '#8a6a58' : '#6d7f88'
  ctx.beginPath()
  ctx.ellipse(width / 2, drop + height * 0.33, width * 0.15, height * 0.1, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = warm ? '#7a2e24' : '#3b4a3a'
  ctx.beginPath()
  ctx.ellipse(width / 2, drop + height * 0.62, width * 0.42, height * 0.18, 0, Math.PI, 0)
  ctx.fill()
  ctx.fillRect(width * 0.08, drop + height * 0.62, width * 0.84, height * 0.4)
}

export function MiniPhone({ format, offset = 0 }: { format: FormatAsk; offset?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    let frame = 0
    const started = performance.now() - offset * 1000
    const draw = () => {
      const elapsed = (performance.now() - started) / 1000
      // "Claude picks" plays one, then the other.
      const showing = format === 'auto' ? (Math.floor(elapsed / LOOP) % 2 === 0 ? 'board' : 'words') : format
      const t = elapsed % LOOP
      const { width, height } = el
      ctx.fillStyle = '#0d0d10'
      ctx.fillRect(0, 0, width, height)
      if (showing === 'board') {
        const drop = faceDropAt(BOARD_DEMO, demoTiming, t, height)
        fillBehindFace(ctx, width, drop)
        standIn(ctx, width, height, drop, true)
        drawMotion(ctx, width, height, BOARD_DEMO, demoTiming, t)
      } else {
        standIn(ctx, width, height, 0, false)
        drawMotion(ctx, width, height, WORDS_DEMO, demoTiming, t, wordsKinetic)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [format, offset])
  return <canvas ref={canvas} width={180} height={320} className="motion-mini" aria-hidden />
}

export function FormatPicker({ value, onChange }: { value: FormatAsk; onChange: (format: FormatAsk) => void }) {
  return (
    <div className="motion-formats" role="radiogroup" aria-label="Which look">
      {(['auto', 'board', 'words'] as const).map((format, i) => (
        <button
          key={format}
          type="button"
          role="radio"
          aria-checked={value === format}
          className={`motion-format${value === format ? ' on' : ''}`}
          onClick={() => onChange(format)}
        >
          <MiniPhone format={format} offset={i * 1.3} />
          <span className="row-name">{FORMAT_INFO[format].name}</span>
          <span className="motion-format-line">{FORMAT_INFO[format].line}</span>
        </button>
      ))}
    </div>
  )
}

/** Example lines under "What you want": a tap adds one. */
export function AskExamples({ format, ask, onPick }: { format: FormatAsk; ask: string; onPick: (next: string) => void }) {
  return (
    <div className="motion-examples">
      {EXAMPLES[format].map((example) => {
        const has = ask.toLowerCase().includes(example.toLowerCase())
        return (
          <button
            key={example}
            type="button"
            className={`motion-example${has ? ' on' : ''}`}
            onClick={() => onPick(has ? ask.replace(new RegExp(`\\s*${example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?`, 'i'), '').trim() : `${ask.trim()}${ask.trim() ? '. ' : ''}${example}`)}
          >
            {has ? '✓ ' : '+ '}
            {example}
          </button>
        )
      })}
    </div>
  )
}
