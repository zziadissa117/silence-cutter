// A split screen format's step lines and money range, on its Batch card
// (splitScreen.ts). The lines are typed one per line; each starts where the
// product shows it - spread through the product by themselves, set exactly
// by playing it and tapping "Starts here" on a line.

import { useEffect, useRef, useState } from 'react'

import type { BankFile, BatchFormat } from './batch'
import { DEFAULT_MONEY, linesFrom, type MoneyRange, type SplitLine } from './splitScreen'

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

export function SplitLines({
  format,
  product,
  loadFile,
  onSave,
}: {
  format: BatchFormat
  product: BankFile | null
  loadFile: (file: BankFile) => Promise<Blob | null>
  onSave: (lines: SplitLine[]) => void
}) {
  const lines = format.lines ?? []
  const [text, setText] = useState(() => lines.map((l) => l.text).join('\n'))
  const [url, setUrl] = useState<string | null>(null)
  const [length, setLength] = useState(product?.seconds ?? 0)
  const video = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!product) return
    let made: string | null = null
    let alive = true
    void loadFile(product).then((blob) => {
      if (!alive || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
      setUrl(null)
    }
  }, [product, loadFile])

  const save = (next: string) => {
    setText(next)
    onSave(linesFrom(next, lines, length))
  }
  const startHere = (i: number) => {
    const at = Math.round((video.current?.currentTime ?? 0) * 10) / 10
    onSave(lines.map((l, k) => (k === i ? { ...l, at } : l)).sort((a, b) => a.at - b.at))
  }

  return (
    <div className="split-lines">
      <label className="field">
        <span className="label">Steps written in the middle</span>
        <textarea
          rows={Math.max(3, lines.length + 1)}
          value={text}
          placeholder={'Step 1. Find a soccer match\nStep 2. Search this in google'}
          aria-label="Step lines, one per line"
          onChange={(e) => save(e.target.value)}
        />
        <span className="hint">One per line, in order, over the product.</span>
      </label>
      {product && url ? (
        <video
          ref={video}
          className="split-lines-video"
          src={url}
          controls
          playsInline
          muted
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setLength(d)
          }}
        />
      ) : null}
      {lines.length > 0 ? (
        <ul className="split-lines-list">
          {lines.map((l, i) => (
            <li key={`${l.text}-${i}`}>
              <span className="split-line-at">{clock(l.at)}</span>
              <span className="split-line-text">{l.text}</span>
              {product ? (
                <button type="button" className="btn small" onClick={() => startHere(i)}>
                  Starts here
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {lines.length > 0 && product ? <p className="hint">Play the product to where a step begins, then tap Starts here on it.</p> : null}
      {!product ? <p className="hint">Add the product to set where each step starts.</p> : null}
    </div>
  )
}

export function MoneyRow({ format, onSave }: { format: BatchFormat; onSave: (money: MoneyRange) => void }) {
  const money = format.money ?? DEFAULT_MONEY
  const [min, setMin] = useState(String(money.min))
  const [max, setMax] = useState(String(money.max))
  const commit = () => {
    const a = Number(min)
    const b = Number(max)
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) onSave({ min: Math.min(a, b), max: Math.max(a, b) })
  }
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="row-name">Money on the goal</span>
        <span className="row-line">A different amount on every video, like &ldquo;+$586.68 US&rdquo;.</span>
        <div className="money-range">
          <span>$</span>
          <input type="number" inputMode="decimal" min={1} value={min} aria-label="Lowest amount" onChange={(e) => setMin(e.target.value)} onBlur={commit} />
          <span>to $</span>
          <input type="number" inputMode="decimal" min={1} value={max} aria-label="Highest amount" onChange={(e) => setMax(e.target.value)} onBlur={commit} />
        </div>
      </div>
    </div>
  )
}
