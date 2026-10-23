// What Captions asks before a video's edit screen opens, all on one screen:
// where it goes, its headline and how it looks, its music, the pictures that
// come up in it (each to keep or leave out) - and, when it has a headline,
// whether the hook (the first seconds, while the headline is up) gets
// captions too. He sets them here, then goes on to the edit screen.
// They used to sit in each video's row as well; there they were one more
// thing to scroll past on every video.
//
// Everything starts as it would be made - the angle's headline, look and
// music - so with nothing to change it is one tap on. Checking several
// videos at once asks for each of them here, and the hook once for all.
// The hook answer given last on this phone is the one offered first.

import { ChevronLeft } from './icons'
import type { Job } from './jobs'
import { PictureToggles, VideoFields } from './JobRow'
import type { Campaign, HeadlineStyle } from './look'
import type { PictureChoice } from './skipPictures'

const LAST_KEY = 'campaign.hookCaptions'

/** What was chosen last on this phone; false (no hook captions) until then. */
export function lastHookChoice(): boolean {
  try {
    return localStorage.getItem(LAST_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberHookChoice(on: boolean): void {
  try {
    localStorage.setItem(LAST_KEY, String(on))
  } catch {
    // Just offered the other way round next time.
  }
}

export function CheckQuestions({
  videos,
  campaigns,
  hasHook,
  onChoose,
  onHeadline,
  onHeadlineDone,
  onHeadlineStyle,
  onMusic,
  pictures,
  onSkipPicture,
  onNext,
  onCancel,
}: {
  /** The videos about to be checked. */
  videos: Job[]
  campaigns: Campaign[]
  /** Whether a video opens on a headline, for the hook question. */
  hasHook: (job: Job) => boolean
  onChoose: (id: string, campaignId: string, angleId: string) => void
  onHeadline: (id: string, text: string) => void
  onHeadlineDone: (id: string) => void
  onHeadlineStyle: (id: string, style: HeadlineStyle) => void
  onMusic: (id: string, choice: string) => void
  /** The pictures a video shows when their words are said. */
  pictures: (job: Job) => PictureChoice[]
  onSkipPicture: (id: string, pictureId: string, skip: boolean) => void
  /** On to the edit screen - with the hook answer when it was asked. */
  onNext: (hookCaptions?: boolean) => void
  onCancel: () => void
}) {
  const last = lastHookChoice()
  const hook = videos.some(hasHook)
  const next = (on?: boolean) => {
    if (on !== undefined) rememberHookChoice(on)
    onNext(on)
  }
  const options = [
    { on: false, label: 'No - start after the headline' },
    { on: true, label: 'Yes - caption the hook too' },
  ].sort((a, b) => Number(b.on === last) - Number(a.on === last))
  return (
    <section className="screen check-questions">
      <button type="button" className="back" onClick={onCancel}>
        <ChevronLeft /> Videos
      </button>
      <h2>{videos.length === 1 ? videos[0].name : `${videos.length} videos`}</h2>
      {videos.map((job) => (
        <div key={job.id} className="group check-video">
          {videos.length > 1 ? <div className="group-title">{job.name}</div> : null}
          <VideoFields
            job={job}
            campaigns={campaigns}
            onChoose={(campaignId, angleId) => onChoose(job.id, campaignId, angleId)}
            onHeadline={(text) => onHeadline(job.id, text)}
            onHeadlineDone={() => onHeadlineDone(job.id)}
            onHeadlineStyle={(style) => onHeadlineStyle(job.id, style)}
            onMusic={(choice) => onMusic(job.id, choice)}
          />
          <PictureToggles
            pictures={pictures(job)}
            skipped={job.day?.skipPictures}
            onSkip={(pictureId, skip) => onSkipPicture(job.id, pictureId, skip)}
            sayNone
          />
        </div>
      ))}
      {hook ? (
        <div className="check-hook">
          <div className="group-title">Captions on the hook?</div>
          <p className="hint">
            The hook is the start of the video, while the headline is up.
            {videos.length > 1 ? ` This goes for all ${videos.length} videos.` : ''}
          </p>
          {options.map(({ on, label }, i) => (
            <button key={label} type="button" className={`btn wide${i === 0 ? ' primary' : ''}`} onClick={() => next(on)}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="btn primary wide" onClick={() => next()}>
          Next
        </button>
      )}
    </section>
  )
}
