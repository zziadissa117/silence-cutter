// One picture in an angle: the picture, the words that bring it up, and
// where it sits. A photo of Sydney Sweeney when he says her name.

import { useEffect, useRef, useState } from 'react'

import { LIMITS, parseWordList, type LogoPosition, type PictureCue } from './look'

const POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

/** The longest side a picture is kept at. The video is 1080 wide, and a
 *  12-megapixel photo held at full size is 48 MB of a phone's memory for no
 *  gain. */
const MAX_SIDE = 1080

/** The picture he chose, brought down to video size. PNGs stay PNG so a cut-
 *  out keeps its clear background; photos become JPEG. */
export async function shrinkPicture(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
    const keepsClear = /png|webp|gif/.test(file.type)
    return await canvas.convertToBlob(keepsClear ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 })
  } finally {
    bitmap.close()
  }
}

export function PictureRow({
  index,
  picture,
  onChange,
  onRemove,
}: {
  index: number
  picture: PictureCue
  onChange: (fields: Partial<PictureCue>) => void
  onRemove: () => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [wordsText, setWordsText] = useState(picture.words.join(', '))
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const next = URL.createObjectURL(picture.image)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [picture.image])

  return (
    <div className="sound">
      <div className="row">
        <span className="label">Picture {index + 1}</span>
        <button type="button" className="linkbtn" onClick={onRemove}>
          Remove
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setError(null)
          shrinkPicture(file)
            .then((image) => onChange({ image }))
            .catch(() => setError("That picture couldn't be opened. Try another."))
        }}
      />
      <div className="row">
        {url ? <img className="thumb" src={url} alt={`Picture ${index + 1}`} /> : <span />}
        <button type="button" className="btn" onClick={() => picker.current?.click()}>
          Change picture
        </button>
      </div>
      <label className="field">
        <span className="label">Comes up when I say</span>
        <input
          type="text"
          value={wordsText}
          placeholder="e.g. Sydney Sweeney"
          aria-label={`Words that bring up picture ${index + 1}`}
          onChange={(e) => {
            setWordsText(e.target.value)
            onChange({ words: parseWordList(e.target.value) })
          }}
        />
        <span className="hint">
          A name of a few words counts when each word is heard, even spelled a bit differently. Add more, separated by
          commas - "Sydney Sweeney, Sydney".
        </span>
      </label>
      <label className="field">
        <span className="label">Where</span>
        <select value={picture.position} onChange={(e) => onChange({ position: e.target.value as LogoPosition })}>
          {POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="slider">
        <span>Width</span>
        <input
          type="range"
          min={LIMITS.pictureWidthPct.min}
          max={LIMITS.pictureWidthPct.max}
          step={1}
          value={picture.widthPct}
          onChange={(e) => onChange({ widthPct: Number(e.target.value) })}
        />
        <output>{picture.widthPct}%</output>
      </label>
      <label className="slider">
        <span>On screen for</span>
        <input
          type="range"
          min={LIMITS.pictureSeconds.min}
          max={LIMITS.pictureSeconds.max}
          step={0.5}
          value={picture.seconds}
          onChange={(e) => onChange({ seconds: Number(e.target.value) })}
        />
        <output>{picture.seconds.toFixed(1)} s</output>
      </label>
      {error ? <div className="error">{error}</div> : null}
    </div>
  )
}
