// The "add videos" area on both pages.
//
// The real file input is laid over the whole area, invisible, so his tap
// lands on the input itself. It used to be a hidden input opened from a
// button's click handler - the pattern iOS is most particular about - and on
// his iPhone a picked video sometimes never reached the page at all, with no
// error anywhere. A direct tap is the plain, native path.
//
// Under it, on an iPhone, the one setting that makes adding instant - see
// pickFormat.ts - until a video is seen arriving untouched.

import { useState, type ReactNode } from 'react'

import { afterPick, pickTip, type PickTip } from './pickFormat'
import { pickStarted } from './pickWatch'

const ACCEPT = 'video/*,.mov,.mp4,.m4v,.mkv,.avi,.webm'

const TIP: Record<NonNullable<PickTip>, string> = {
  how: 'Tip: in the picker tap ⋯ → Options → Format → Current. Videos then come in straight away, at full quality.',
  converted:
    'Your iPhone converted that video before handing it over - that was the wait. In the picker tap ⋯ → Options → Format → Current, and they come in straight away.',
}

export function VideoPicker({
  className,
  label,
  onFiles,
  children,
}: {
  className: string
  label: string
  onFiles: (files: File[]) => void
  children: ReactNode
}) {
  const [tip, setTip] = useState<PickTip>(pickTip)
  return (
    <>
      <div className={`${className} picker`}>
        {children}
        <input
          type="file"
          accept={ACCEPT}
          multiple
          aria-label={label}
          onClick={() => pickStarted()}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            e.target.value = ''
            onFiles(picked)
            if (tip) void afterPick(picked).then(setTip)
          }}
        />
      </div>
      {tip ? <p className={`hint pick-tip${tip === 'converted' ? ' warn' : ''}`}>{TIP[tip]}</p> : null}
    </>
  )
}
