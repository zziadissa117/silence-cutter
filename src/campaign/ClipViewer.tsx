// A batch clip played full screen, straight from the phone: tap a reaction
// (or any clip) in the Batch tab to watch it, and take it out from here if it
// is the one making videos laggy. "I could click on them and then watch them
// and see if they're laggy or not. Maybe I can delete them and put another one."

import { useEffect, useState } from 'react'

import type { BankFile } from './batch'
import { loadBankFile } from './store'

export function ClipViewer({
  file,
  note,
  onClose,
  onTakeOut,
}: {
  file: BankFile
  /** What the videos made with it came to: "3 videos, 3 rejected". */
  note?: string
  onClose: () => void
  onTakeOut?: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let made: string | null = null
    let gone = false
    loadBankFile(file)
      .then((blob) => {
        if (gone) return
        if (!blob) setProblem('This clip is no longer on the phone.')
        else {
          made = URL.createObjectURL(blob)
          setUrl(made)
        }
      })
      .catch(() => {
        if (!gone) setProblem("This clip couldn't be read.")
      })
    return () => {
      gone = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [file])

  return (
    <div className="clip-viewer" role="dialog" aria-label={file.name}>
      <div className="clip-viewer-head">
        <span className="bank-name">{file.name}</span>
        {note ? <span className="hint">{note}</span> : null}
      </div>
      {url ? <video src={url} controls autoPlay playsInline loop /> : <p className="hint clip-viewer-wait">{problem ?? 'Opening…'}</p>}
      <div className="clip-viewer-actions">
        {onTakeOut ? (
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              onTakeOut()
              onClose()
            }}
          >
            Take it out
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
