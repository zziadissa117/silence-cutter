// The "add videos" area on both pages.
//
// The real file input is laid over the whole area, invisible, so a tap lands
// on the input itself. It used to be a hidden input opened from a button's
// click handler - the pattern iOS is most particular about - and on an iPhone
// a picked video sometimes never reached the page at all, with no error
// anywhere. A direct tap is the plain, native path.
//
// Under the main one, on an iPhone, the one setting that makes adding
// instant - see pickFormat.ts - until a video is seen arriving untouched, or
// the tip is dismissed.

import { useState, type ReactNode } from 'react'

import { afterPick, dismissTip, pickTip, type PickTip } from './pickFormat'
import { pickStarted } from './pickWatch'
import { PICKER_CURRENT } from './words'

/** The video files the pages accept, by extension - the one list the picker
 *  and the drag-and-drop filter are both built from. */
export const VIDEO_EXTENSIONS = ['mov', 'mp4', 'm4v', 'mkv', 'avi', 'webm', 'mts', '3gp'] as const
export const VIDEO_PATTERN = new RegExp(`\\.(${VIDEO_EXTENSIONS.join('|')})$`, 'i')
const ACCEPT = ['video/*', ...VIDEO_EXTENSIONS.map((ext) => `.${ext}`)].join(',')

export function videoFilesFrom(list: Iterable<File>): File[] {
  return Array.from(list).filter((f) => f.type.startsWith('video/') || VIDEO_PATTERN.test(f.name))
}

const TIP: Record<NonNullable<PickTip>, string> = {
  how: `Videos arrive faster at full quality if the picker does not convert them. ${PICKER_CURRENT}`,
  converted: `Your iPhone converted that video before handing it over - that was the wait. ${PICKER_CURRENT}`,
}

export function VideoPicker({
  className,
  label,
  onFiles,
  tip = false,
  children,
}: {
  className: string
  label: string
  onFiles: (files: File[]) => void
  /** Show the iPhone picker tip under this control - the page's main one. */
  tip?: boolean
  children: ReactNode
}) {
  const [shownTip, setShownTip] = useState<PickTip>(() => (tip ? pickTip() : null))
  const [openedAt, setOpenedAt] = useState(0)
  return (
    <>
      <div className={`${className} picker`}>
        {children}
        <input
          type="file"
          accept={ACCEPT}
          multiple
          aria-label={label}
          onClick={() => {
            setOpenedAt(Date.now())
            pickStarted()
          }}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            e.target.value = ''
            onFiles(picked)
            if (tip) void afterPick(picked, openedAt ? Date.now() - openedAt : 0).then(setShownTip)
          }}
        />
      </div>
      {shownTip ? (
        <p className={`hint pick-tip${shownTip === 'converted' ? ' warn' : ''}`}>
          <span>{TIP[shownTip]}</span>
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              dismissTip()
              setShownTip(null)
            }}
          >
            Got it
          </button>
        </p>
      ) : null}
    </>
  )
}
