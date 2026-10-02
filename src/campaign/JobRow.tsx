// One video in the list: a dot for its state, its name, one line saying
// where it is, and the one thing to do next - approve it, send it, try it
// again. The rest (what it heard, where it goes, its headline) opens on a
// tap, and opens by itself when it needs him.
//
// Rows never move: the list stays in the order the videos were added, so
// approving one does not slide the next under his thumb.

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { totalDuration } from '../media/silenceMath'
import { ChevronDown } from './icons'
import { anyEffect, defaultEffects } from './defaultEffects'
import { NO_EFFECTS } from './effects'
import { canShareFiles, formatTime, outputName, share, type Job } from './jobs'
import { LIMITS, type Campaign } from './look'

type Tone = 'now' | 'later' | 'ok' | 'warn' | 'bad'

/** How long the clips joined on before and after came out. */
const joinedSec = (result: NonNullable<Job['result']>) => (result.clips?.beforeSec ?? 0) + (result.clips?.afterSec ?? 0)
/** His own part, cut. */
const cutSec = (result: NonNullable<Job['result']>) => result.newDurationSec - joinedSec(result)

const WORKING: Record<Job['phase'], string> = {
  reading: 'Reading the sound',
  model: 'Getting the speech model',
  listening: 'Listening',
  cutting: 'Making it',
  joining: 'Putting the parts together',
}

export function JobRow({
  job,
  label,
  campaigns,
  onApprove,
  onCheck,
  onCuts,
  onMusic,
  onNoEffects,
  onChoose,
  onHeadline,
  onHeadlineDone,
  onRetry,
  onRemove,
  onPost,
  postingNote,
  clips,
  joinWith,
  onJoin,
  suggestJoin,
  parts,
}: {
  job: Job
  label: string
  campaigns: Campaign[]
  onApprove: () => void
  /** With captions on, a sorted video is approved by checking its captions. */
  onCheck?: () => void
  /** Opens the video's cuts to fix by hand before it is made - absent for
   *  a reaction he doesn't talk in, which is kept whole. */
  onCuts?: () => void
  /** Picks the track under this video: "campaignId:angleId", "none", or ""
   *  for its angle's own. */
  onMusic: (choice: string) => void
  onNoEffects: (off: boolean) => void
  onChoose: (campaignId: string, angleId: string) => void
  onHeadline: (text: string) => void
  onHeadlineDone: () => void
  onRetry: () => void
  onRemove: () => void
  /** Sends a finished video to Postiz by hand, when it didn't go itself. */
  onPost?: () => void
  /** Why a finished video was not sent to Postiz, when posting is set up. */
  postingNote?: string
  /** What is joined onto a sorted video - its Add list. */
  clips?: ReactNode
  /** Other recordings this one can be joined with - it goes first. */
  joinWith?: { id: string; label: string }[]
  onJoin?: (otherId: string) => void
  /** A recording filmed right after this one, offered to be joined. */
  suggestJoin?: { name: string; onJoin: () => void; onDismiss: () => void }
  /** A joined video's recordings, and taking it apart again. */
  parts?: { names: string[]; onSplit: () => void }
}) {
  const unsure = job.status === 'sorted' && job.day?.guess?.sure === false
  const [open, setOpen] = useState(unsure)
  // Opens by itself the moment it turns out to need him - it was only a
  // name waiting its turn when the row first appeared.
  useEffect(() => {
    if (unsure) setOpen(true)
  }, [unsure])
  const [shareFailed, setShareFailed] = useState(false)
  const result = job.result
  const name = outputName(job.name, label)
  const file = useMemo(() => (result ? new File([result.blob], name, { type: 'video/mp4' }) : null), [result, name])
  const canSend = useMemo(() => (file ? canShareFiles([file]) : false), [file])
  const missed = result && result.notHeard.length > 0
  const plain = Boolean(result?.lookFailed)
  const noMusic = Boolean(result?.montage?.musicFailed)

  const tone: Tone =
    job.status === 'done'
      ? missed || plain || noMusic
        ? 'warn'
        : 'ok'
      : job.status === 'failed' || job.status === 'held'
        ? 'bad'
        : unsure
          ? 'warn'
          : job.status === 'sorted' || job.status === 'working'
            ? 'now'
            : 'later'

  const line =
    job.status === 'queued'
      ? job.prejoin || (job.day?.parts && !job.day.plan)
        ? 'Waiting to be put together'
        : job.day
        ? 'Waiting to be listened to'
        : `Waiting · ${label}`
      : job.status === 'working'
        ? `${WORKING[job.phase]}… ${Math.round(job.progress * 100)}%`
        : job.status === 'sorted'
          ? unsure
            ? `Needs you · ${job.day?.guess?.why ?? ''}`
            : [label, job.headlineText && `"${job.headlineText}"`].filter(Boolean).join(' · ')
          : job.status === 'approved'
            ? `Approved · ${label}`
            : job.status === 'done' && result
              ? plain
                ? `Plain cut · the look couldn't be added · ${formatTime(result.newDurationSec)}`
                : result.montage
                ? `${label} · ${result.montage.seconds.length} clip${result.montage.seconds.length === 1 ? '' : 's'} · ${formatTime(result.newDurationSec)}${result.montage.music ? '' : ' · no music'}`
                : result.reaction
                ? `${label} · ${formatTime(result.reaction.reactionSec)} reaction + ${formatTime(result.reaction.productSec)} product`
                : `${label} · ${formatTime(result.originalDurationSec)} → ${formatTime(cutSec(result))}${joinedSec(result) ? ` · ${formatTime(result.newDurationSec)} with clips` : ''}${missed ? ` · didn't hear "${result.notHeard[0]}"` : ''}`
              : job.status === 'held'
                ? 'Stopped the page twice - left alone'
                : (job.error ?? 'Failed')

  const shownLine = job.later && job.status !== 'failed' && job.status !== 'held' ? `${line} · for the next days` : line

  const send = async () => {
    if (!file) return
    if (!(await share([file]))) setShareFailed(true)
  }

  const action =
    job.status === 'sorted' ? (
      onCheck ? (
        <button type="button" className="btn small" onClick={onCheck}>
          {job.day?.captions ? 'Captions' : 'Check captions'}
        </button>
      ) : (
        <button type="button" className="btn small" onClick={onApprove}>
          Approve
        </button>
      )
    ) : job.status === 'done' && file && job.url ? (
      canSend && !shareFailed ? (
        <button type="button" className="btn small" onClick={() => void send()}>
          Send
        </button>
      ) : (
        <a className="btn small" href={job.url} download={name}>
          Save
        </a>
      )
    ) : job.status === 'held' || job.status === 'failed' ? (
      <button type="button" className="btn small" onClick={onRetry}>
        Try again
      </button>
    ) : null

  const expandable = job.status !== 'working' && job.status !== 'approved'

  return (
    <li className={`vrow${open ? ' open' : ''}`}>
      <div className="vrow-top">
        <button
          type="button"
          className="vrow-open"
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`dot ${tone}`} aria-hidden />
          <span className="vrow-text">
            <span className="vrow-name">{job.name}</span>
            <span className={`vrow-line${tone === 'warn' ? ' warn' : tone === 'bad' ? ' bad' : ''}`}>{shownLine}</span>
          </span>
          {expandable ? (
            <span className="vrow-chevron">
              <ChevronDown />
            </span>
          ) : null}
        </button>
        {action ? <div className="vrow-action">{action}</div> : null}
      </div>

      {suggestJoin ? (
        <div className="join-hint">
          <span className="hint">Filmed right before {suggestJoin.name}</span>
          <button type="button" className="btn small" onClick={suggestJoin.onJoin}>
            Join them
          </button>
          <button type="button" className="linkbtn" aria-label="Keep them apart" onClick={suggestJoin.onDismiss}>
            ✕
          </button>
        </div>
      ) : null}

      {job.status === 'working' ? (
        <div className="bar">
          <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      ) : null}

      {open && expandable ? (
        <div className="vrow-details">
          {job.status === 'sorted' && job.day?.plan ? (
            <SortedDetails
              job={job}
              campaigns={campaigns}
              onChoose={onChoose}
              onHeadline={onHeadline}
              onHeadlineDone={onHeadlineDone}
              onCuts={onCuts}
              onMusic={onMusic}
              onNoEffects={onNoEffects}
              clips={clips}
              joinWith={joinWith}
              onJoin={onJoin}
              parts={parts}
            />
          ) : null}

          {job.status === 'done' && result ? (
            <>
              {result.montage ? (
                <div className="facts">
                  {result.montage.seconds.map(formatTime).join(' + ')}
                  {result.headline ? ` · "${result.headline}"` : ''}
                  {result.montage.music ? ` · music: ${result.montage.music}` : ''}
                </div>
              ) : (
              <div className="facts">
                {result.cuts} pause{result.cuts === 1 ? '' : 's'} cut
                {result.fillerWords ? ` · ${result.fillerWords} "um"` : ''}
                {result.stutters ? ` · ${result.stutters} stumble` : ''}
                {result.logoAt.length > 0 ? ` · logo at ${result.logoAt.map(formatTime).join(', ')}` : ''}
                {result.picturesAt.length > 0 ? ` · picture at ${result.picturesAt.map(formatTime).join(', ')}` : ''}
                {result.headline ? ` · "${result.headline}"` : ''}
                {result.clips?.beforeSec ? ` · ${formatTime(result.clips.beforeSec)} video before` : ''}
                {result.clips?.afterSec ? ` · ${formatTime(result.clips.afterSec)} video after` : ''}
              </div>
              )}
              {result.montage?.musicFailed ? (
                <div className="hint warn-text">Made without the music - {result.montage.musicFailed}.</div>
              ) : null}
              {result.clips && result.clips.leftOut.length > 0 ? (
                <div className="hint warn-text">
                  Made without the video {result.clips.leftOut.join(' or ')} - it isn't on this phone any more, or couldn't be
                  read.
                </div>
              ) : null}
              {plain ? (
                <div className="hint warn-text">
                  The look couldn't be added ({result.lookFailed}), so this is the plain cut - add the headline and logo in
                  TikTok.
                </div>
              ) : null}
              {missed ? (
                <div className="hint warn-text">
                  Didn't hear "{result.notHeard.join('" or "')}", so what it brings up didn't happen.{' '}
                  {result.heardSample ? `It heard: "${result.heardSample}"` : 'It heard no words at all.'}
                </div>
              ) : null}
              {postingNote ? <div className="hint warn-text">{postingNote}</div> : null}
              {onPost ? (
                <button type="button" className="linkbtn" onClick={onPost}>
                  Send to Postiz
                </button>
              ) : null}
            </>
          ) : null}

          {job.status === 'failed' || job.status === 'held' ? <div className="error">{job.error}</div> : null}

          {job.status === 'queued' || job.status === 'sorted' || job.status === 'held' || job.status === 'failed' ? (
            <button type="button" className="linkbtn" onClick={onRemove}>
              Remove from the list
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** Every track set on any angle, once each - the tracks to pick from. */
export function musicTracks(campaigns: Campaign[]): { value: string; name: string }[] {
  const seen = new Set<string>()
  const out: { value: string; name: string }[] = []
  for (const c of campaigns) {
    for (const a of c.angles) {
      if (!a.music || seen.has(a.music.name)) continue
      seen.add(a.music.name)
      out.push({ value: `${c.id}:${a.id}`, name: a.music.name })
    }
  }
  return out
}

function SortedDetails({
  job,
  campaigns,
  onChoose,
  onHeadline,
  onHeadlineDone,
  onCuts,
  onMusic,
  onNoEffects,
  clips,
  joinWith,
  onJoin,
  parts,
}: {
  job: Job
  campaigns: Campaign[]
  onChoose: (campaignId: string, angleId: string) => void
  onHeadline: (text: string) => void
  onHeadlineDone: () => void
  onCuts?: () => void
  onMusic: (choice: string) => void
  onNoEffects: (off: boolean) => void
  clips?: ReactNode
  joinWith?: { id: string; label: string }[]
  onJoin?: (otherId: string) => void
  parts?: { names: string[]; onSplit: () => void }
}) {
  const plan = job.day?.plan
  const kept = job.day?.keep ?? plan?.keep ?? []
  const heard = (job.day?.plan?.words ?? []).map((w) => w.text.trim()).join(' ')
  const angle = campaigns.find((c) => c.id === job.campaignId)?.angles.find((a) => a.id === job.angleId)
  return (
    <>
      <div className="quote">{heard ? `"${heard.length > 160 ? `${heard.slice(0, 160)}…` : heard}"` : 'No words heard.'}</div>
      <label className="field">
        <span className="label">Goes to</span>
        <select
          value={`${job.campaignId}|${job.angleId}`}
          onChange={(e) => {
            const [campaignId, angleId] = e.target.value.split('|')
            onChoose(campaignId, angleId)
          }}
        >
          {campaigns.map((c) => (
            <optgroup key={c.id} label={c.name}>
              {c.angles.map((a) => (
                <option key={a.id} value={`${c.id}|${a.id}`}>
                  {c.general ? a.name : `${c.name} · ${a.name}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Headline</span>
        <input
          type="text"
          value={job.headlineText}
          maxLength={LIMITS.headlineChars}
          placeholder="No headline"
          onChange={(e) => onHeadline(e.target.value)}
          onBlur={onHeadlineDone}
        />
        {angle?.headline.fromFirstLine ? <span className="hint">From your first line.</span> : null}
      </label>
      <label className="field">
        <span className="label">Music</span>
        <select value={job.day?.music ?? ''} onChange={(e) => onMusic(e.target.value)}>
          <option value="">{angle?.music ? `The angle's: ${angle.music.name}` : "The angle's: none"}</option>
          {musicTracks(campaigns)
            .filter((t) => t.value !== `${job.campaignId}:${job.angleId}`)
            .map((t) => (
              <option key={t.value} value={t.value}>
                {t.name}
              </option>
            ))}
          <option value="none">No music</option>
        </select>
      </label>
      {anyEffect(defaultEffects()) && !anyEffect(angle?.effects ?? NO_EFFECTS) ? (
        <label className="field">
          <span className="label">Effects</span>
          <select value={job.day?.noEffects ? 'off' : 'default'} onChange={(e) => onNoEffects(e.target.value === 'off')}>
            <option value="default">Default effects</option>
            <option value="off">No effects</option>
          </select>
        </label>
      ) : null}
      {clips}
      {parts ? (
        <div className="cuts-row">
          <span className="facts">Joined from {parts.names.join(' + ')}</span>
          <button type="button" className="linkbtn" onClick={parts.onSplit}>
            Split apart
          </button>
        </div>
      ) : null}
      {joinWith && joinWith.length > 0 && onJoin ? (
        <label className="field">
          <span className="label">Join with another recording</span>
          <select value="" onChange={(e) => e.target.value && onJoin(e.target.value)}>
            <option value="" disabled>
              It goes after this one…
            </option>
            {joinWith.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {onCuts ? (
        <div className="cuts-row">
          <span className="facts">
            {job.reaction ? 'Product clip: ' : ''}
            {plan ? `${formatTime(plan.duration)} → ${formatTime(totalDuration(kept))}` : ''}
            {job.day?.keep ? ' · cuts fixed by hand' : ''}
          </span>
          <button type="button" className="btn small" onClick={onCuts}>
            Edit cuts
          </button>
        </div>
      ) : job.reaction ? (
        <div className="facts">No talking over the product, so it is kept whole.</div>
      ) : null}
    </>
  )
}
