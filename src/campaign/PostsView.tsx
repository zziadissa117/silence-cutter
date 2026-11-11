// The Posts screen: every finished video on its way to Postiz, and what
// became of it.
//
// In the order he reads it (his ask, 2026-11-11): what is still going up,
// what didn't go out in the last day, then one list of everything still to go
// out by its time - the next first, to approve or already set - and at the
// bottom what went out in the last few hours (postsList.postsOrder). Every post can be saved to the
// phone or shared, from the phone's own copy while it has one, Postiz's
// otherwise: Inflow's and Lock in's approvals go out by hand.
//
// Rows never move under his thumb: each list keeps its order while he is on
// the screen, and a post only changes list when he acts on it.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { shortNumber } from './analytics'
import { dayLabel } from './batch'
import { hasShareSheet, shareVideo, useSharable } from './shareFile'
import { ChevronLeft, PlusIcon } from './icons'
import type { Campaign } from './look'
import { NewPost } from './NewPost'
import { StopPicker } from './StopPicker'
import { jobOfPostKey, EDIT_WINDOW_MS } from './store'
import { MusicAfter, useCanChangeMusic } from './MusicAfter'
import { JUST_POSTED_MS, byDay, campaignsIn, localDay, postsOrder, rememberShown, shownCampaign } from './postsList'
import { canAddMusic } from './musicAfterSend'
import { copyKind, forgetSend, localVideo, retryStuck, sending, tidySends, watchSending, type Sending } from './outbox'
import {
  PostingError,
  accountLabel,
  linkLabel,
  handleOf,
  isBeingRemade,
  lastPosts,
  listPosts,
  localInput,
  placeFor,
  postAction,
  postingHere,
  redoCaptions,
  redoSaid,
  stoppable,
  whenLabel,
  type PostAction,
  type RedoMode,
  type ServerPost,
} from './posting'

const POLL_MS = 15_000
/** Up next shows this many until he asks for the rest. */
const NEXT_SHOWN = 15
/** How many of a batch waiting for him are shown open, to check. */
const PREVIEW = 3
/** As the server's batch.ts BATCH_TRUST: his 3rd yes in a batch approves the rest. */
const BATCH_TRUST = 3
/** Where he disconnects and reconnects an account that won't post. */
const POSTIZ_ACCOUNTS = 'https://platform.postiz.com/launches'

function useSending(): Sending[] {
  const [now, setNow] = useState(sending)
  useEffect(() => watchSending(() => setNow(sending())), [])
  return now
}

function videoName(post: ServerPost): string {
  const base = (post.fileName ?? 'video').replace(/\.[^./]+$/, '')
  const tag = post.campaignName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
  return `${base}_${tag || 'post'}.mp4`
}

interface Copy {
  file: File | null
  /** A copy kept in the database is read into memory whole, so it waits to
   *  be asked for - and so does Postiz's copy, fetched over the network. */
  load: (() => void) | null
  loading: boolean
  /** Asked for, and it couldn't be had. */
  failed: boolean
}

/** The phone's own copy of a post's video. One in private files is found as
 *  the card appears - it is read from disk as it plays or goes - so Save can
 *  open the share sheet straight from the tap. */
function useCopy(key: string, remote: string | null = null): Copy {
  const [file, setFile] = useState<File | null>(null)
  const [lazy, setLazy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const fetchIt = useCallback(async () => {
    let blob = await localVideo(key)
    // The phone lets go of its copy once a post has gone out; Postiz keeps
    // one, and lets this page fetch it.
    if (!blob && remote) {
      const response = await fetch(remote).catch(() => null)
      blob = response?.ok ? await response.blob().catch(() => null) : null
    }
    if (blob && blob.size > 0) setFile(new File([blob], `${key}.mp4`, { type: 'video/mp4' }))
    else setFailed(true)
  }, [key, remote])
  useEffect(() => {
    let cancelled = false
    void copyKind(key).then((kind) => {
      if (cancelled) return
      if (kind === 'opfs') void fetchIt()
      else if (kind === 'idb' || remote) setLazy(true)
    })
    return () => {
      cancelled = true
    }
  }, [key, remote, fetchIt])
  const load = useMemo(
    () =>
      lazy && !file && !failed
        ? () => {
            setLoading(true)
            void fetchIt().finally(() => setLoading(false))
          }
        : null,
    [lazy, file, failed, fetchIt],
  )
  return { file, load, loading, failed }
}

function SaveVideo({ post, primary = false }: { post: ServerPost; primary?: boolean }) {
  const { file: copy, load, loading } = useCopy(post.key, post.videoUrl)
  // In memory for the share sheet (shareFile.ts): Save opened an empty
  // preview on his iPhone when it was read from storage.
  const sharable = useSharable(copy, videoName(post))
  const [shareFailed, setShareFailed] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!copy) return
    const next = URL.createObjectURL(copy)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [copy])
  const className = `btn small${primary ? ' primary' : ''}`
  if (load) {
    return (
      <button type="button" className={className} disabled={loading} onClick={load}>
        {loading ? 'Getting it…' : 'Get video'}
      </button>
    )
  }
  if (copy && hasShareSheet()) {
    return (
      <button type="button" className={className} disabled={!sharable} onClick={() => sharable && void shareVideo(sharable).then((ok) => setShareFailed(!ok))}>
        {!sharable ? 'Getting it…' : shareFailed ? 'Save video · try again' : 'Save video'}
      </button>
    )
  }
  const href = url ?? post.videoUrl
  if (!href) return null
  return (
    <a className={className} href={href} download={videoName(post)} target={url ? undefined : '_blank'} rel="noreferrer">
      {url ? 'Save video' : 'Open video'}
    </a>
  )
}

export function Watch({ post }: { post: ServerPost }) {
  const { file: copy, load } = useCopy(post.key)
  useEffect(() => load?.(), [load])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!copy) return
    const next = URL.createObjectURL(copy)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [copy])
  const src = url ?? post.videoUrl
  if (src) return <video className="post-video" src={src} controls playsInline preload="metadata" />
  return <div className="hint">No copy of this video on the phone, and Postiz has none yet.</div>
}

/** One post waiting for him: its caption to read (or paste), its time, and
 *  the button that lets it go. */
/** Opens the video's cuts, captions and music again, while its recording is
 *  still on the phone. A post that already went out says a new one is needed. */
function EditAgain({
  post,
  editable,
  onEdit,
}: {
  post: ServerPost
  editable: Record<string, number>
  onEdit: (key: string) => void
}) {
  const madeAt = editable[jobOfPostKey(post.key)]
  if (madeAt === undefined || post.status === 'rejected') return null
  const left = Math.max(0, madeAt + EDIT_WINDOW_MS - Date.now())
  const minutes = Math.ceil(left / 60_000)
  const label = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
  const out = post.status === 'posted'
  return (
    <button
      type="button"
      className="linkbtn"
      title={out ? 'Already posted: editing makes a new post.' : 'Replaces this post.'}
      onClick={() => onEdit(post.key)}
    >
      {out ? 'Edit as new post' : 'Edit again'} · {label} left
    </button>
  )
}

function WaitingPost({
  post,
  busy,
  problem,
  watchFirst = false,
  onAct,
  editable,
  onEdit,
  campaigns,
  onChanged,
  onRedo,
}: {
  post: ServerPost
  busy: boolean
  editable: Record<string, number>
  onEdit: (key: string) => void
  campaigns: Campaign[]
  onChanged: (message: string) => void
  /** What his last tap on it came back with. */
  problem?: string
  /** One of the first of its batch: shown with its video, to check it. */
  watchFirst?: boolean
  /** A batch post: its batch's captions redone (hashtags added, rewritten). */
  onRedo?: (mode: RedoMode) => Promise<void>
  onAct: (action: PostAction, fields?: { caption?: string; at?: string; captions?: Record<string, { caption?: string }>; disliked?: boolean }) => void
}) {
  // His own words while he types; null means the box shows the caption as
  // the server has it - so a caption the server rewrites or re-tags
  // meanwhile shows up, instead of the old one going back on the next tap.
  const [typed, setTyped] = useState<string | null>(null)
  const caption = typed ?? post.caption ?? ''
  const setCaption = setTyped
  useEffect(() => {
    if (typed !== null && typed === (post.caption ?? '')) setTyped(null)
  }, [post.caption, typed])
  const [own, setOwn] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(post.captions ?? {}).map(([id, t]) => [id, t.caption ?? ''])),
  )
  const ownCaptions = () => Object.fromEntries(Object.entries(own).filter(([, text]) => text.trim()).map(([id, text]) => [id, { caption: text }]))
  const ownEdited = JSON.stringify(ownCaptions()) !== JSON.stringify(Object.fromEntries(Object.entries(post.captions ?? {}).map(([id, t]) => [id, { caption: t.caption ?? '' }]).filter(([, t]) => (t as { caption: string }).caption.trim())))
  const [changingTime, setChangingTime] = useState(false)
  const [addingMusic, setAddingMusic] = useState(false)
  const musicWord = useCanChangeMusic(post) ? 'Change music' : 'Add music'
  const [at, setAt] = useState(localInput(post.postAt))
  const [watching, setWatching] = useState(watchFirst)
  const brand = post.approval === 'brand'
  const paste = post.captionBy === 'paste'
  const edited = typed !== null && typed !== (post.caption ?? '')
  const fields = () => ({
    ...(edited ? { caption } : {}),
    ...(ownEdited ? { captions: ownCaptions() } : {}),
    ...(changingTime ? { at: new Date(at).toISOString() } : {}),
  })

  return (
    <li className="post">
      <div className="post-head">
        <span className="post-time">{timeLabel(post.postAt)}</span>
        <span className="post-title">{post.campaignName}{post.repost ? ' · repost' : ''}</span>
        <span className="state-chip now">{post.ready ? 'Tap Post' : brand ? 'Brand' : 'To approve'}</span>
      </div>
      <div className="post-line">
        {post.accounts.map((a) => (a.held ? `${accountLabel(a)} (${a.held === 'paused' ? 'paused - waiting' : "today's limit - waiting"})` : accountLabel(a))).join(', ')}
      </div>
      {post.error ? <div className="hint warn-text">{post.error}</div> : null}
      {post.ready ? (
        <div className="hint">Approved - it waits here until you tap Post. Save the video first if you want it.</div>
      ) : brand ? (
        <div className="hint">Send it to the brand first - Save video - then Brand approved when they say yes.</div>
      ) : null}
      <textarea
        className="post-caption"
        rows={4}
        value={caption}
        aria-label={`Caption for ${post.campaignName}`}
        placeholder={paste ? 'Paste the tracking caption' : 'Caption'}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => edited && onAct('edit', { caption })}
      />
      {changingTime ? (
        <label className="field">
          <span className="label">Posts at</span>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
      ) : null}
      {watching ? <Watch post={post} /> : null}
      {addingMusic ? <MusicAfter post={post} campaigns={campaigns} caption={caption} onDone={onChanged} onClose={() => setAddingMusic(false)} /> : null}
      {problem ? <p className="hint warn-text">{problem}</p> : null}
      {/* What he does with nearly every post, in one row: approve (or post
          it now), watch it, turn it down. The rest behind More options. */}
      <div className="post-actions">
        <button
          type="button"
          className="btn small primary"
          disabled={busy || !caption.trim()}
          onClick={() => onAct('approve', fields())}
        >
          {busy ? 'Sending…' : post.ready ? 'Post' : brand ? 'Brand approved' : 'Approve'}
        </button>
        {/* Approved and out now, whatever its time (2026-10-29, his ask):
            a time of now goes to Postiz as "post now" (postiz schedule). */}
        <button
          type="button"
          className="btn small"
          disabled={busy || !caption.trim()}
          onClick={() => onAct('approve', { ...fields(), at: new Date().toISOString() })}
        >
          Post now
        </button>
        {brand ? <SaveVideo post={post} primary /> : null}
        <button type="button" className="linkbtn" onClick={() => setWatching((w) => !w)}>
          {watching ? 'Hide video' : 'Watch'}
        </button>
        <button
          type="button"
          className="linkbtn danger"
          disabled={busy}
          onClick={() =>
            window.confirm(`Reject this ${post.campaignName} post? It won't be posted.${post.batch ? ' The batch makes another in its place.' : ''}`) &&
            onAct('reject', { disliked: true })
          }
        >
          Reject
        </button>
      </div>
      <details className="post-more">
        <summary className="linkbtn">More options</summary>
        <div className="post-actions">
          {post.ready ? null : (
            <button type="button" className="btn small" disabled={busy || !caption.trim()} onClick={() => onAct('ready', fields())}>
              Approve, post later
            </button>
          )}
          <button type="button" className="btn small" onClick={() => setChangingTime((c) => !c)}>
            {changingTime ? 'Keep its time' : 'Change time'}
          </button>
          {canAddMusic(post) ? (
            <button type="button" className="btn small" onClick={() => setAddingMusic((m) => !m)}>
              {addingMusic ? 'Hide music' : musicWord}
            </button>
          ) : null}
          {brand ? null : <SaveVideo post={post} primary={false} />}
          <EditAgain post={post} editable={editable} onEdit={onEdit} />
        </div>
        {onRedo ? <RedoBatch onRedo={onRedo} /> : null}
        {post.accounts.filter((a) => !a.held).length > 1 ? (
          <details className="per-platform">
            <summary className="linkbtn">A different caption for one platform</summary>
            {post.accounts
              .filter((a) => !a.held)
              .map((a) => (
                <label key={a.id} className="field">
                  <span className="label">{accountLabel(a)}</span>
                  <textarea
                    className="post-caption"
                    rows={3}
                    value={own[a.id] ?? ''}
                    placeholder="Same as above"
                    aria-label={`Caption for ${accountLabel(a)}`}
                    onChange={(e) => setOwn({ ...own, [a.id]: e.target.value })}
                    onBlur={() => ownEdited && onAct('edit', { captions: ownCaptions() })}
                  />
                </label>
              ))}
          </details>
        ) : null}
      </details>
    </li>
  )
}

/** Scheduled - or approved, which is the same to him - with its time still
 *  ahead: what the blue clock means. */
function waitingForTime(post: ServerPost, now = Date.now()): boolean {
  return (post.status === 'scheduled' || post.status === 'approved') && post.postAt !== null && Date.parse(post.postAt) > now
}

function OtherPost({
  post,
  busy,
  problem,
  onAct,
  editable,
  onEdit,
  campaigns,
  onChanged,
  onRedo,
}: {
  post: ServerPost
  busy: boolean
  editable: Record<string, number>
  onEdit: (key: string) => void
  campaigns: Campaign[]
  onChanged: (message: string) => void
  /** What his last tap on it came back with. */
  problem?: string
  onAct: (action: PostAction) => void
  /** A batch post still to go: its batch's captions redone. */
  onRedo?: (mode: RedoMode) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [addingMusic, setAddingMusic] = useState(false)
  const musicWord = useCanChangeMusic(post) ? 'Change music' : 'Add music'
  const tone =
    post.status === 'posted' ? (post.error ? 'warn' : 'ok') : post.status === 'error' || post.status === 'failed' ? 'bad' : 'later'
  // Sent through Buffer, the backup, instead of Postiz.
  const viaBuffer = (post.viaBuffer ?? []).length > 0 ? ' · via Buffer' : ''
  const line =
    post.status === 'posted'
      ? `Posted · ${post.accounts.filter((a) => !a.held).map((a) => (handleOf(a) ? `@${handleOf(a)}` : a.name)).join(', ')}${viaBuffer}`
      : post.status === 'scheduled'
        ? `${post.accounts.map(accountLabel).join(', ')}${viaBuffer}`
        : post.status === 'failed' || post.status === 'error'
          ? (post.error ?? 'Failed')
          : post.status === 'approved'
            ? `Approved · ${post.accounts.map(accountLabel).join(', ')}`
            : post.status === 'writing'
              ? post.error ?? 'Writing the caption…'
              : 'Sending…'
  const links = Object.entries(post.links)
  // Its views, once the server has read them (postiz/views.ts).
  const views = post.status === 'posted' && post.views ? Object.values(post.views).reduce((n, v) => n + (Number(v) || 0), 0) : null
  return (
    <li className="post">
      <button type="button" className="post-head as-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="post-time">{post.status === 'failed' ? '-' : timeLabel(post.postAt)}</span>
        <span className="post-title">{post.campaignName}</span>
        <span className={`state-chip ${tone}`}>
          {post.status === 'posted'
            ? post.error
              ? 'Partly'
              : 'Posted'
            : post.status === 'failed'
              ? 'Not posted'
              : post.status === 'error'
                ? 'Failed'
                : waitingForTime(post)
                  ? 'Scheduled'
                  : 'Going out'}
        </span>
      </button>
      <div className={`post-line${tone === 'bad' ? ' bad' : tone === 'warn' ? ' warn' : ''}`}>
        {line}
        {views !== null ? <span className="views-pill">{shortNumber(views)} views</span> : null}
      </div>
      {open ? (
        <>
          {post.caption ? <div className="post-caption-read">{post.caption}</div> : null}
          <Watch post={post} />
          {onRedo ? <RedoBatch onRedo={onRedo} /> : null}
        </>
      ) : null}
      {post.status === 'posted' && post.error ? <div className="hint warn-text">{post.error}</div> : null}
      {(post.status === 'scheduled' || post.status === 'approved') && post.error ? (
        <div className={`hint${post.error.startsWith("The caption couldn't") ? ' warn-text' : ''}`}>{post.error}</div>
      ) : null}
      {post.repostDue ? (
        <div className="hint warn-text">Time to repost - open the post and tap Repost.</div>
      ) : null}
      {links.length > 0 ? (
        <div className="post-links">
          {links.map(([name, href]) => (
            <a key={name} className="linkbtn" href={href} target="_blank" rel="noreferrer">
              {linkLabel(name, post.accounts)}
            </a>
          ))}
        </div>
      ) : null}
      {addingMusic ? <MusicAfter post={post} campaigns={campaigns} onDone={onChanged} onClose={() => setAddingMusic(false)} /> : null}
      {problem ? <p className="hint warn-text">{problem}</p> : null}
      <div className="post-actions">
        <SaveVideo post={post} />
        <EditAgain post={post} editable={editable} onEdit={onEdit} />
        {canAddMusic(post) ? (
          <button type="button" className="linkbtn" onClick={() => setAddingMusic((m) => !m)}>
            {addingMusic ? 'Hide music' : musicWord}
          </button>
        ) : null}
        {post.status === 'failed' ? (
          <button type="button" className="btn small" disabled={busy} onClick={() => onAct('retry')}>
            {busy ? 'Trying…' : 'Try again'}
          </button>
        ) : null}
        {post.status === 'error' || (post.status === 'posted' && post.error?.startsWith('Not posted to')) ? (
          <>
            <button type="button" className="btn small primary" disabled={busy} onClick={() => onAct('retry-accounts')}>
              {busy ? 'Trying…' : post.status === 'error' ? 'Post again' : 'Post again to the missing ones'}
            </button>
            {/* An account that won't post (mostly YouTube): disconnect and
                reconnect it there, then the button above posts to it at once,
                under the new id Postiz gives it (postiz retryAccounts). */}
            <a className="linkbtn" href={POSTIZ_ACCOUNTS} target="_blank" rel="noreferrer">
              Reconnect in Postiz
            </a>
          </>
        ) : null}
        {post.status === 'approved' || (post.status === 'scheduled' && post.postAt && new Date(post.postAt).getTime() > Date.now()) ? (
          <button type="button" className="linkbtn" disabled={busy} onClick={() => onAct('unschedule')}>
            Take back
          </button>
        ) : null}
        {post.status === 'failed' ? (
          <button type="button" className="linkbtn danger" disabled={busy} onClick={() => onAct('reject')}>
            Remove
          </button>
        ) : null}
      </div>
    </li>
  )
}

/** "7:55 PM" - the day is the list's own heading. */
function timeLabel(iso: string | null): string {
  if (!iso) return 'No time'
  const at = new Date(iso)
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  // Still to come: under its day's heading. Gone out on another day: the day too.
  if (at.getTime() >= Date.now() || localDay(iso) === localDay(new Date().toISOString())) return time
  return whenLabel(iso)
}

/** His batch's captions redone with its campaign's rules as they are now. */
function RedoBatch({ onRedo }: { onRedo: (mode: RedoMode) => Promise<void> }) {
  const [redoing, setRedoing] = useState<RedoMode | null>(null)
  return (
    <div className="post-actions">
      {(['hashtags', 'rewrite'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className="linkbtn"
          disabled={redoing !== null}
          onClick={() => {
            setRedoing(mode)
            void onRedo(mode).finally(() => setRedoing(null))
          }}
        >
          {redoing === mode ? 'Working…' : mode === 'hashtags' ? "Add missing hashtags to this batch" : "Rewrite this batch's captions"}
        </button>
      ))}
    </div>
  )
}

/** "Today", "Tomorrow" or "Sat, Oct 31". */
function dayTitle(date: string | null): string {
  if (!date) return 'No time yet'
  const today = localDay(new Date().toISOString())
  if (date === today) return 'Today'
  if (date === localDay(new Date(Date.now() + 24 * 3_600_000).toISOString())) return 'Tomorrow'
  return dayLabel(date)
}

/** A video that can't go up until he does something - its copy gone from
 *  the phone, signed out: what is wrong, and his two ways out. */
function SendingRow({ item, onRemove }: { item: Sending; onRemove: () => void }) {
  const { entry } = item
  return (
    <li className="post">
      <div className="post-head">
        <span className="dot bad" aria-hidden />
        <span className="post-title">{entry.campaign.name}</span>
        <span className="post-when">Not sent</span>
      </div>
      <div className="post-line bad">
        {entry.meta.fileName}: {entry.error}
      </div>
      <div className="post-actions">
        <button type="button" className="btn small" onClick={() => void retryStuck(entry.key)}>
          Try again
        </button>
        <button
          type="button"
          className="linkbtn danger"
          onClick={() => window.confirm("Stop sending this video? It won't be posted.") && onRemove()}
        >
          Stop sending
        </button>
      </div>
    </li>
  )
}

/** Everything still on its way, as one line: the videos going up from this
 *  phone - one at a time, so the rest are only waiting their turn - and what
 *  the server is still getting ready. Each one shows in Up next as soon as
 *  it is ready. Open it to see them one by one. */
function OnTheWay({ sending, working }: { sending: Sending[]; working: ServerPost[] }) {
  const [open, setOpen] = useState(false)
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  const now = sending.find((item) => item.now)
  const writing = working.filter((p) => p.status === 'writing').length
  const arriving = working.length - writing
  const count = sending.length
  const head =
    count > 0
      ? `${count} video${count === 1 ? '' : 's'} going up`
      : `${working.length} getting ready`
  const line = [
    count === 0
      ? null
      : offline
        ? 'No signal - they go up by themselves when there is.'
        : now
          ? `Now ${now.entry.meta.fileName} · ${Math.round(now.progress * 100)}%${count > 1 ? ` · ${count - 1} waiting their turn` : ''}`
          : 'Starting again in a moment…',
    arriving > 0 ? `${arriving} arriving on the server` : null,
    writing > 0 ? `Claude is writing ${writing === 1 ? 'a caption' : `${writing} captions`}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className="post">
      <button type="button" className="post-head as-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`dot ${offline && count > 0 ? 'warn' : 'later'}`} aria-hidden />
        <span className="post-title">{head}</span>
        <span className="post-when">{open ? 'Hide' : 'Show'}</span>
      </button>
      <div className="post-line">{line}</div>
      {now ? (
        <div className="bar">
          <div style={{ width: `${Math.round(now.progress * 100)}%` }} />
        </div>
      ) : null}
      <div className="hint">Each one shows in Up next as soon as it is ready - nothing to do here.</div>
      {open ? (
        <ul className="posts-list batch-inside">
          {sending.map((item) => (
            <li key={item.entry.key} className="post">
              <div className="post-head">
                <span className="dot later" aria-hidden />
                <span className="post-title">{item.entry.campaign.name}</span>
                <span className="post-when">{item.now ? `${Math.round(item.progress * 100)}%` : 'Waiting its turn'}</span>
              </div>
              <div className="post-line">{item.entry.meta.fileName}</div>
            </li>
          ))}
          {working.map((post) => (
            <li key={post.id} className="post">
              <div className="post-head">
                <span className="dot later" aria-hidden />
                <span className="post-title">{post.campaignName}</span>
                <span className="post-when">{post.status === 'writing' ? 'Caption' : 'Arriving'}</span>
              </div>
              <div className="post-line">{post.status === 'writing' ? (post.error ?? 'Claude is writing the caption…') : 'The last parts are arriving…'}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function PostsView({
  campaigns,
  onBack,
  editable,
  onEditAgain,
  remaking = [],
  newPost = true,
}: {
  campaigns: Campaign[]
  /** "+ New post" offered: not to a Trial-reels-only login, which can post
   *  nothing else (the server refuses it). */
  newPost?: boolean
  /** Back where it was opened from; none as a tab of its own. */
  onBack?: () => void
  editable: Record<string, number>
  onEditAgain: (key: string) => void
  /** Post keys he is making again: not shown until the new version replaces them. */
  remaking?: string[]
}) {
  const [allPosts, setPosts] = useState<ServerPost[]>(lastPosts)
  const remakingSet = new Set(remaking)
  const posts = allPosts.filter((p) => !isBeingRemade(p, remakingSet))
  const [making, setMaking] = useState(false)
  const profile = postingHere()?.profile ?? null
  const [problem, setProblem] = useState<string | null>(null)
  // What a tap on a post came back with, shown under that post - at the top
  // of a long list it went unseen, and "Post again" looked like it did
  // nothing (2026-10-29).
  const [postProblems, setPostProblems] = useState<Record<string, string>>({})
  const postProblem = (id: string, message: string | null) =>
    setPostProblems((all) => {
      const { [id]: _gone, ...rest } = all
      return message ? { ...rest, [id]: message } : rest
    })
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [approvingAll, setApprovingAll] = useState(false)
  // Ticking posts to stop - a whole campaign, or one by one.
  const [stopping, setStopping] = useState(false)
  // One campaign at a time, or all of them - remembered on this phone.
  const [shown, setShown] = useState<string | null>(shownCampaign)
  const [allNext, setAllNext] = useState(false)
  const outgoing = useSending()

  const load = useCallback(async (fresh = false) => {
    try {
      const next = await listPosts(fresh)
      setPosts(next)
      setProblem(null)
      void tidySends(next)
    } catch (error) {
      setProblem(error instanceof PostingError && error.later ? 'No connection - showing the posts as they last were.' : String((error as Error).message ?? error))
    }
  }, [])

  /** Music was added to a post and sent as a new version: say so, and look again. */
  const onMusicDone = (message: string) => {
    setSaid(message)
    void load(true)
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // A video that just finished going up shows as soon as the server has it.
  const sentCount = outgoing.filter((s) => s.entry.state === 'sent').length
  useEffect(() => {
    if (sentCount > 0) void load(true)
  }, [sentCount, load])

  const act = async (post: ServerPost, action: PostAction, fields?: { caption?: string; at?: string; disliked?: boolean }) => {
    // Saving an edit happens as he leaves the box - often by tapping
    // Approve, which carries the same words. It never holds the buttons,
    // or that tap would land on a disabled one and be lost.
    if (action === 'edit') {
      void postAction('edit', post.id, fields).catch(() => {})
      return
    }
    setBusy((b) => new Set(b).add(post.id))
    try {
      const { alsoApproved, ...next } = await postAction(action, post.id, fields)
      // An action's reply carries Postiz's link only: the server's own, from
      // the list, stays until the next read.
      setPosts((ps) => ps.map((p) => (p.id === next.id ? { ...next, videoUrl: next.videoUrl ?? p.videoUrl } : p)))
      postProblem(post.id, next.status === 'waiting' && next.error && action === 'approve' ? next.error : null)
      // His third yes in a batch approves the rest of it on the server.
      if (alsoApproved) {
        setSaid(`The other ${alsoApproved} of this batch are approved too.`)
        void load(true)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      postProblem(
        post.id,
        action === 'ready' && /unknown action/i.test(message)
          ? "Post later needs the server updated first - run ./deploy-server.sh in silence-cutter."
          : message,
      )
    } finally {
      setBusy((b) => {
        const rest = new Set(b)
        rest.delete(post.id)
        return rest
      })
    }
  }

  const inPosts = campaignsIn(posts)
  const showing = shown && inPosts.some((c) => c.id === shown) ? shown : null
  const view = showing ? posts.filter((p) => p.campaignId === showing) : posts
  const show = (id: string | null) => {
    setShown(id)
    rememberShown(id)
  }
  /** One batch's captions written again with its campaign's rules as they
   *  are now - after he added a hashtag, say. */
  const redoBatch = async (batch: ServerPost[], mode: RedoMode) => {
    const owner = campaigns.find((c) => c.id === batch[0].campaignId)
    if (!owner?.posting) {
      setProblem(`${batch[0].campaignName} has no caption rules on this phone - set them in its Posting first.`)
      return
    }
    const tags = owner.posting.hashtags
    if (mode === 'hashtags' && tags.length === 0) {
      setProblem(`${owner.name} has no hashtags yet - add them in its Posting, then come back.`)
      return
    }
    const ask =
      mode === 'hashtags'
        ? `Add ${tags.join(' ')} to these ${batch.length} ${owner.name} posts? Captions stay as they are; times stay the same.`
        : `Have Claude write these ${batch.length} ${owner.name} captions again with its caption rules${tags.length > 0 ? ` and ${tags.join(' ')}` : ''}? Times stay the same.`
    if (!window.confirm(ask)) return
    try {
      setSaid(redoSaid(owner.name, await redoCaptions(owner.id, owner.posting, batch.map((p) => p.id), mode), mode, tags))
      void load(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProblem(/unknown action/i.test(message) ? 'Redoing captions needs the server updated first - run ./deploy-server.sh in silence-cutter.' : message)
    }
  }
  const waiting = view.filter((p) => p.status === 'waiting' && !p.ready)
  const approvable = waiting.filter((p) => p.approval !== 'brand' && p.caption?.trim())
  const sendingNow = outgoing.filter((s) => s.entry.state === 'sending')
  const sendingKeys = new Set(sendingNow.map((s) => s.entry.key))
  // On the way: what is still going up from this phone, and what the server
  // is still getting ready (the last parts arriving, Claude writing the
  // caption) - seconds to minutes, then each goes into Up next.
  const working = view.filter((p) => (p.status === 'uploading' || p.status === 'writing') && !sendingKeys.has(p.key))
  // One list by time, the next first; then what went out in the last hours
  // (postsList.postsOrder). Approved is scheduled, to him: it goes at its time.
  const order = postsOrder(view)
  // The first few of a batch waiting for him open with their video, to check.
  const firstOfBatch = new Set(
    [...new Set(waiting.filter((p) => p.batch).map((p) => p.campaignId))].flatMap((id) =>
      order.next.filter((p) => p.status === 'waiting' && p.batch && p.campaignId === id).slice(0, PREVIEW).map((p) => p.id),
    ),
  )
  /** A batch post still to go: its batch's captions can be redone. */
  const redoFor = (post: ServerPost) => {
    if (!post.batch) return undefined
    const batch = order.next.filter((p) => p.batch && p.campaignId === post.campaignId)
    return (mode: RedoMode) => redoBatch(batch, mode)
  }
  const other = (post: ServerPost) => (
    <OtherPost
      key={post.id}
      editable={editable}
      onEdit={onEditAgain}
      campaigns={campaigns}
      onChanged={onMusicDone}
      post={post}
      busy={busy.has(post.id)}
      problem={postProblems[post.id]}
      onAct={(action) => void act(post, action)}
      onRedo={post.status === 'scheduled' || post.status === 'approved' ? redoFor(post) : undefined}
    />
  )

  /** Three at a time: each approval waits on the server putting the post
   *  into Postiz, and 25 one after another kept the screen on for minutes. */
  const approveThese = async (these: ServerPost[]) => {
    const queue = [...these]
    const worker = async () => {
      for (let post = queue.shift(); post; post = queue.shift()) await act(post, 'approve')
    }
    await Promise.all([worker(), worker(), worker()])
  }
  const approveAll = async () => {
    setApprovingAll(true)
    await approveThese(approvable)
    setApprovingAll(false)
  }

  const nothing = posts.length === 0 && sendingNow.length === 0
  // Accounts picked somewhere - not just a campaign with times saved.
  const profileNow = postingHere()?.profile
  const anyAccounts = Boolean(profileNow) && campaigns.some((c) => placeFor(profileNow!, c.id).accounts.length > 0)
  const canStop = stoppable(posts)

  return (
    <section className="screen posts">
      {onBack ? (
        <button type="button" className="back" onClick={onBack}>
          <ChevronLeft /> Videos
        </button>
      ) : null}
      <div className="screen-head">
        <h1>Posts</h1>
        <div className="actions-row">
          {approvable.length > 1 && !stopping ? (
            <button type="button" className="btn small primary" disabled={approvingAll} onClick={() => void approveAll()}>
              {approvingAll ? 'Approving…' : `Approve all ${approvable.length}`}
            </button>
          ) : null}
          {canStop.length > 0 && !stopping ? (
            <button type="button" className="btn small" onClick={() => setStopping(true)}>
              Select
            </button>
          ) : null}
          {profile && newPost && !making && !stopping ? (
            <button type="button" className="btn small" onClick={() => setMaking(true)}>
              <PlusIcon /> New post
            </button>
          ) : null}
        </div>
      </div>

      {stopping ? (
        <StopPicker
          posts={canStop}
          onCancel={() => setStopping(false)}
          onDone={(message) => {
            setStopping(false)
            setSaid(message)
            void load(true)
          }}
        />
      ) : null}

      {/* While picking, only the picker: the lists below would be the same
          posts twice. */}
      {stopping ? null : (
      <>
      {profile && making ? (
        <NewPost campaigns={campaigns} profile={profile} onDone={() => setMaking(false)} onCancel={() => setMaking(false)} />
      ) : null}

      {said ? (
        <div className="notice">
          <span>{said}</span>
          <button type="button" className="linkbtn" onClick={() => setSaid(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {problem ? (
        <div className="notice">
          <span>{problem}</span>
          <button type="button" className="linkbtn" onClick={() => setProblem(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {inPosts.length > 1 ? (
        // One box, not a button for each of up to 30 campaigns.
        <select className="posts-filter" aria-label="Show campaign" value={showing ?? ''} onChange={(e) => show(e.target.value || null)}>
          <option value="">All campaigns · {posts.length}</option>
          {inPosts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.count}
            </option>
          ))}
        </select>
      ) : null}

      {nothing ? (
        <p className="empty">
          {!anyAccounts
            ? 'No campaign has accounts picked yet, so nothing is sent. Pick them in Campaigns - open a campaign, then Posting.'
            : 'Nothing yet. Finished videos show up here on their way to Postiz.'}
        </p>
      ) : null}

      {sendingNow.length > 0 || working.length > 0 ? (
        <ul className="posts-list on-the-way">
          {/* What he has to act on, one by one; the rest is one line. */}
          {sendingNow
            .filter((item) => item.entry.stuck)
            .map((item) => (
              <SendingRow key={item.entry.key} item={item} onRemove={() => void forgetSend(item.entry.key)} />
            ))}
          <OnTheWay sending={sendingNow.filter((item) => !item.entry.stuck)} working={working} />
        </ul>
      ) : null}

      {order.missed.length > 0 ? (
        <>
          <div className="list-title bad">Didn't go out · {order.missed.length}</div>
          <ul className="posts-list">{order.missed.map((post) => other(post))}</ul>
        </>
      ) : null}

      {order.next.length > 0 ? (
        <>
          <div className="list-title">
            Up next <span className="list-count">{order.next.length}</span>
          </div>
          {order.next.some((p) => p.status === 'waiting' && p.batch) ? (
            <p className="hint tip">Approve {BATCH_TRUST} of a batch and the rest of it goes by itself.</p>
          ) : null}
          {byDay(allNext ? order.next : order.next.slice(0, NEXT_SHOWN)).map(({ date, posts: day }) => (
            <div key={date ?? 'none'} className="day-block">
              <div className="day-title">{dayTitle(date)}</div>
              <ul className="posts-list">
                {day.map((post) =>
                  post.status === 'waiting' ? (
                    <WaitingPost
                      key={post.id}
                      watchFirst={firstOfBatch.has(post.id)}
                      editable={editable}
                      onEdit={onEditAgain}
                      campaigns={campaigns}
                      onChanged={onMusicDone}
                      post={post}
                      busy={busy.has(post.id)}
                      problem={postProblems[post.id]}
                      onAct={(action, fields) => void act(post, action, fields)}
                      onRedo={redoFor(post)}
                    />
                  ) : (
                    other(post)
                  ),
                )}
              </ul>
            </div>
          ))}
          {order.next.length > NEXT_SHOWN ? (
            <button type="button" className="linkbtn see-more" onClick={() => setAllNext((a) => !a)}>
              {allNext ? 'Show fewer' : `Show all ${order.next.length}`}
            </button>
          ) : null}
        </>
      ) : null}

      {order.justPosted.length > 0 ? (
        <>
          <div className="list-title">
            Just posted <span className="list-count">last {JUST_POSTED_MS / 3_600_000} hours</span>
          </div>
          <ul className="posts-list">{order.justPosted.map((post) => other(post))}</ul>
        </>
      ) : null}
      </>
      )}
    </section>
  )
}
