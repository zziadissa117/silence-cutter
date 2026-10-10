// The Posts screen: every finished video on its way to Postiz, and what
// became of it.
//
// What needs him comes first - a caption to read and approve, a tracking
// caption to paste, a brand to hear back from - then what is still going
// up, what is scheduled, and what went out. Every post can be saved to the
// phone or shared, from the phone's own copy while it has one, Postiz's
// otherwise: Inflow's and Lock in's approvals go out by hand.
//
// Rows never move under his thumb: each list keeps its order while he is on
// the screen, and a post only changes list when he acts on it.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { dayLabel } from './batch'
import { canShareFiles, share } from './jobs'
import { ChevronLeft } from './icons'
import type { Campaign } from './look'
import { NewPost } from './NewPost'
import { StopPicker } from './StopPicker'
import { jobOfPostKey, EDIT_WINDOW_MS } from './store'
import { MusicAfter } from './MusicAfter'
import { campaignsIn, foldBatches, rememberShown, shownCampaign, type ListItem } from './postsList'
import { canAddMusic } from './musicAfterSend'
import { copyKind, forgetSend, kick, localVideo, sending, tidySends, watchSending, type Sending } from './outbox'
import {
  PostingError,
  accountLabel,
  handleOf,
  lastPosts,
  listPosts,
  localInput,
  postAction,
  postingHere,
  stoppable,
  whenLabel,
  type PostAction,
  type ServerPost,
} from './posting'

const POLL_MS = 15_000
/** Posted shows this many until he asks for the rest. */
const POSTED_SHOWN = 10

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
  const file = useMemo(() => (copy ? new File([copy], videoName(post), { type: 'video/mp4' }) : null), [copy, post])
  const [shareFailed, setShareFailed] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  const className = `btn small${primary ? ' primary' : ''}`
  if (load) {
    return (
      <button type="button" className={className} disabled={loading} onClick={load}>
        {loading ? 'Getting it…' : 'Get video'}
      </button>
    )
  }
  if (file && canShareFiles([file]) && !shareFailed) {
    return (
      <button type="button" className={className} onClick={() => void share([file]).then((ok) => !ok && setShareFailed(true))}>
        Save video
      </button>
    )
  }
  const href = url ?? post.videoUrl
  if (!href) return null
  return (
    <a className={className} href={href} download={videoName(post)} target={url ? undefined : '_blank'} rel="noreferrer">
      Save video
    </a>
  )
}

function Watch({ post }: { post: ServerPost }) {
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
  return src ? <video className="post-video" src={src} controls playsInline preload="metadata" /> : null
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
  onAct,
  editable,
  onEdit,
  campaigns,
  onChanged,
}: {
  post: ServerPost
  busy: boolean
  editable: Record<string, number>
  onEdit: (key: string) => void
  campaigns: Campaign[]
  onChanged: (message: string) => void
  onAct: (action: PostAction, fields?: { caption?: string; at?: string; captions?: Record<string, { caption?: string }> }) => void
}) {
  const [caption, setCaption] = useState(post.caption ?? '')
  const [own, setOwn] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(post.captions ?? {}).map(([id, t]) => [id, t.caption ?? ''])),
  )
  const ownCaptions = () => Object.fromEntries(Object.entries(own).filter(([, text]) => text.trim()).map(([id, text]) => [id, { caption: text }]))
  const ownEdited = JSON.stringify(ownCaptions()) !== JSON.stringify(Object.fromEntries(Object.entries(post.captions ?? {}).map(([id, t]) => [id, { caption: t.caption ?? '' }]).filter(([, t]) => (t as { caption: string }).caption.trim())))
  const [changingTime, setChangingTime] = useState(false)
  const [addingMusic, setAddingMusic] = useState(false)
  const [at, setAt] = useState(localInput(post.postAt))
  const [watching, setWatching] = useState(false)
  const brand = post.approval === 'brand'
  const paste = post.captionBy === 'paste'
  const edited = caption !== (post.caption ?? '')
  const fields = () => ({
    ...(edited ? { caption } : {}),
    ...(ownEdited ? { captions: ownCaptions() } : {}),
    ...(changingTime ? { at: new Date(at).toISOString() } : {}),
  })

  return (
    <li className="post">
      <div className="post-head">
        <span className="dot now" aria-hidden />
        <span className="post-title">{post.campaignName}{post.repost ? ' · repost' : ''}</span>
        <span className="post-when">{whenLabel(post.postAt)}</span>
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
      {changingTime ? (
        <label className="field">
          <span className="label">Posts at</span>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
      ) : null}
      {watching ? <Watch post={post} /> : null}
      {addingMusic ? <MusicAfter post={post} campaigns={campaigns} onDone={onChanged} onClose={() => setAddingMusic(false)} /> : null}
      <div className="post-actions">
        <button
          type="button"
          className="btn small primary"
          disabled={busy || !caption.trim()}
          onClick={() => onAct('approve', fields())}
        >
          {busy ? 'Sending…' : post.ready ? 'Post' : brand ? 'Brand approved' : 'Approve'}
        </button>
        {post.ready ? null : (
          <button type="button" className="btn small" disabled={busy || !caption.trim()} onClick={() => onAct('ready', fields())}>
            Approve, post later
          </button>
        )}
        <SaveVideo post={post} primary={brand} />
        <EditAgain post={post} editable={editable} onEdit={onEdit} />
        {canAddMusic(post) ? (
          <button type="button" className="linkbtn" onClick={() => setAddingMusic((m) => !m)}>
            {addingMusic ? 'Hide music' : 'Add music'}
          </button>
        ) : null}
        <button type="button" className="linkbtn" onClick={() => setWatching((w) => !w)}>
          {watching ? 'Hide' : 'Watch'}
        </button>
        <button type="button" className="linkbtn" onClick={() => setChangingTime((c) => !c)}>
          {changingTime ? 'Keep its time' : 'Change time'}
        </button>
        <button
          type="button"
          className="linkbtn danger"
          disabled={busy}
          onClick={() => window.confirm(`Reject this ${post.campaignName} post? It won't be posted.`) && onAct('reject')}
        >
          Reject
        </button>
      </div>
    </li>
  )
}

function OtherPost({
  post,
  busy,
  onAct,
  editable,
  onEdit,
  campaigns,
  onChanged,
}: {
  post: ServerPost
  busy: boolean
  editable: Record<string, number>
  onEdit: (key: string) => void
  campaigns: Campaign[]
  onChanged: (message: string) => void
  onAct: (action: PostAction) => void
}) {
  const [open, setOpen] = useState(false)
  const [addingMusic, setAddingMusic] = useState(false)
  const tone =
    post.status === 'posted' ? (post.error ? 'warn' : 'ok') : post.status === 'error' || post.status === 'failed' ? 'bad' : 'later'
  const line =
    post.status === 'posted'
      ? `Posted · ${post.accounts.filter((a) => !a.held).map((a) => (handleOf(a) ? `@${handleOf(a)}` : a.name)).join(', ')}`
      : post.status === 'scheduled'
        ? post.accounts.map(accountLabel).join(', ')
        : post.status === 'failed' || post.status === 'error'
          ? (post.error ?? 'Failed')
          : post.status === 'approved'
            ? 'Going to Postiz…'
            : post.status === 'writing'
              ? post.error ?? 'Writing the caption…'
              : 'Sending…'
  const links = Object.entries(post.links)
  return (
    <li className="post">
      <button type="button" className="post-head as-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`dot ${tone}`} aria-hidden />
        <span className="post-title">{post.campaignName}</span>
        <span className="post-when">{whenLabel(post.postAt)}</span>
      </button>
      <div className={`post-line${tone === 'bad' ? ' bad' : tone === 'warn' ? ' warn' : ''}`}>{line}</div>
      {open ? (
        <>
          {post.caption ? <div className="post-caption-read">{post.caption}</div> : null}
          <Watch post={post} />
        </>
      ) : null}
      {post.repostDue ? (
        <div className="hint warn-text">Time to repost - open the post and tap Repost.</div>
      ) : null}
      {links.length > 0 ? (
        <div className="post-links">
          {links.map(([name, href]) => (
            <a key={name} className="linkbtn" href={href} target="_blank" rel="noreferrer">
              {name}
            </a>
          ))}
        </div>
      ) : null}
      {addingMusic ? <MusicAfter post={post} campaigns={campaigns} onDone={onChanged} onClose={() => setAddingMusic(false)} /> : null}
      <div className="post-actions">
        <SaveVideo post={post} />
        <EditAgain post={post} editable={editable} onEdit={onEdit} />
        {canAddMusic(post) ? (
          <button type="button" className="linkbtn" onClick={() => setAddingMusic((m) => !m)}>
            {addingMusic ? 'Hide music' : 'Add music'}
          </button>
        ) : null}
        {post.status === 'failed' ? (
          <button type="button" className="btn small" disabled={busy} onClick={() => onAct('retry')}>
            {busy ? 'Trying…' : 'Try again'}
          </button>
        ) : null}
        {post.status === 'scheduled' && post.postAt && new Date(post.postAt).getTime() > Date.now() ? (
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

/** A batch folded into one row: the campaign, how many, which days and
 *  when the next one goes. Tap to open it and see each post. */
function BatchRow({ posts, children }: { posts: ServerPost[]; children: (post: ServerPost) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const dates = posts.map((p) => p.batch?.date ?? '').filter(Boolean).sort()
  const days = dates.length === 0 ? '' : dates[0] === dates[dates.length - 1] ? dayLabel(dates[0]) : `${dayLabel(dates[0])} to ${dayLabel(dates[dates.length - 1])}`
  const next = posts.find((p) => p.postAt && Date.parse(p.postAt) > Date.now())
  const tone = posts.every((p) => p.status === 'posted') ? 'ok' : posts[0].status === 'waiting' ? 'now' : 'later'
  return (
    <li className="post batch-row">
      <button type="button" className="post-head as-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`dot ${tone}`} aria-hidden />
        <span className="post-title">
          {posts[0].campaignName} · {posts.length} videos
        </span>
        <span className="post-when">{open ? 'Hide' : 'Show'}</span>
      </button>
      <div className="post-line">
        {days}
        {next ? ` · next ${whenLabel(next.postAt)}` : ''}
      </div>
      {open ? <ul className="posts-list batch-inside">{posts.map((post) => children(post))}</ul> : null}
    </li>
  )
}

function SendingRow({ item, onRemove }: { item: Sending; onRemove: () => void }) {
  const { entry } = item
  return (
    <li className="post">
      <div className="post-head">
        <span className={`dot ${entry.error ? 'warn' : 'later'}`} aria-hidden />
        <span className="post-title">{entry.campaign.name}</span>
        <span className="post-when">{Math.round(item.progress * 100)}%</span>
      </div>
      <div className={`post-line${entry.error ? ' warn' : ''}`}>
        {entry.error ? `${entry.error} Trying again by itself.` : `Sending ${entry.meta.fileName}…`}
      </div>
      <div className="bar">
        <div style={{ width: `${Math.round(item.progress * 100)}%` }} />
      </div>
      {entry.error ? (
        <div className="post-actions">
          <button type="button" className="btn small" onClick={kick}>
            Try now
          </button>
          <button
            type="button"
            className="linkbtn danger"
            onClick={() => window.confirm("Stop sending this video? It won't be posted.") && onRemove()}
          >
            Stop sending
          </button>
        </div>
      ) : null}
    </li>
  )
}

export function PostsView({
  campaigns,
  onBack,
  editable,
  onEditAgain,
}: {
  campaigns: Campaign[]
  onBack: () => void
  editable: Record<string, number>
  onEditAgain: (key: string) => void
}) {
  const [posts, setPosts] = useState<ServerPost[]>(lastPosts)
  const [making, setMaking] = useState(false)
  const profile = postingHere()?.profile ?? null
  const [problem, setProblem] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [approvingAll, setApprovingAll] = useState(false)
  // Ticking posts to stop - a whole campaign, or one by one.
  const [stopping, setStopping] = useState(false)
  // One campaign at a time, or all of them - remembered on this phone.
  const [shown, setShown] = useState<string | null>(shownCampaign)
  const [allPosted, setAllPosted] = useState(false)
  const outgoing = useSending()

  const load = useCallback(async () => {
    try {
      const next = await listPosts()
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
    void load()
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
    if (sentCount > 0) void load()
  }, [sentCount, load])

  const act = async (post: ServerPost, action: PostAction, fields?: { caption?: string; at?: string }) => {
    // Saving an edit happens as he leaves the box - often by tapping
    // Approve, which carries the same words. It never holds the buttons,
    // or that tap would land on a disabled one and be lost.
    if (action === 'edit') {
      void postAction('edit', post.id, fields).catch(() => {})
      return
    }
    setBusy((b) => new Set(b).add(post.id))
    try {
      const next = await postAction(action, post.id, fields)
      setPosts((ps) => ps.map((p) => (p.id === next.id ? next : p)))
      if (next.status === 'waiting' && next.error && action === 'approve') setProblem(next.error)
      else setProblem(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProblem(
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
  const list = (items: ListItem[], row: (post: ServerPost) => ReactNode) =>
    items.map((item) =>
      item.kind === 'post' ? (
        row(item.post)
      ) : (
        <BatchRow key={item.id} posts={item.posts}>
          {row}
        </BatchRow>
      ),
    )

  const waiting = view.filter((p) => p.status === 'waiting' && !p.ready)
  // Approved with "post later": held until he taps Post.
  const ready = view.filter((p) => p.status === 'waiting' && p.ready).sort((a, b) => (a.postAt ?? '').localeCompare(b.postAt ?? ''))
  const approvable = waiting.filter((p) => p.approval !== 'brand' && p.caption?.trim())
  const sendingNow = outgoing.filter((s) => s.entry.state === 'sending')
  const sendingKeys = new Set(sendingNow.map((s) => s.entry.key))
  const working = view.filter((p) => ['uploading', 'writing', 'approved'].includes(p.status) && !sendingKeys.has(p.key))
  const byTime = (a: ServerPost, b: ServerPost) => (a.postAt ?? '').localeCompare(b.postAt ?? '')
  const scheduled = view.filter((p) => p.status === 'scheduled').sort(byTime)
  const failed = view.filter((p) => p.status === 'failed')
  const done = view
    .filter((p) => p.status === 'posted' || p.status === 'error')
    .sort((a, b) => byTime(b, a))

  const approveAll = async () => {
    setApprovingAll(true)
    for (const post of approvable) await act(post, 'approve')
    setApprovingAll(false)
  }

  const nothing = posts.length === 0 && sendingNow.length === 0
  const canStop = stoppable(posts)

  return (
    <section className="screen posts">
      <button type="button" className="back" onClick={onBack}>
        <ChevronLeft /> Videos
      </button>
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
        </div>
      </div>

      {stopping ? (
        <StopPicker
          posts={canStop}
          onCancel={() => setStopping(false)}
          onDone={(message) => {
            setStopping(false)
            setSaid(message)
            void load()
          }}
        />
      ) : null}

      {/* While picking, only the picker: the lists below would be the same
          posts twice. */}
      {stopping ? null : (
      <>
      {profile && making ? (
        <NewPost campaigns={campaigns} profile={profile} onDone={() => setMaking(false)} onCancel={() => setMaking(false)} />
      ) : profile ? (
        <button type="button" className="btn add-more" onClick={() => setMaking(true)}>
          + New post
        </button>
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
        <div className="seg chips posts-filter" role="radiogroup" aria-label="Show campaign">
          <button type="button" role="radio" aria-checked={showing === null} className={showing === null ? 'active' : ''} onClick={() => show(null)}>
            All {posts.length}
          </button>
          {inPosts.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={showing === c.id} className={showing === c.id ? 'active' : ''} onClick={() => show(c.id)}>
              {c.name} {c.count}
            </button>
          ))}
        </div>
      ) : null}

      {nothing ? (
        <p className="empty">
          {Object.keys(postingHere()?.profile.settings.campaigns ?? {}).length === 0
            ? 'No campaign has accounts picked yet, so nothing is sent. Pick them in Campaigns - open a campaign, then Posting.'
            : 'Nothing yet. Finished videos show up here on their way to Postiz.'}
        </p>
      ) : null}

      {waiting.length > 0 ? (
        <>
          <div className="list-title">To approve</div>
          <ul className="posts-list">
            {list(foldBatches(waiting), (post) => (
              <WaitingPost key={post.id} editable={editable} onEdit={onEditAgain} campaigns={campaigns} onChanged={onMusicDone} post={post} busy={busy.has(post.id)} onAct={(action, fields) => void act(post, action, fields)} />
            ))}
          </ul>
        </>
      ) : null}

      {ready.length > 0 ? (
        <>
          <div className="list-title">Ready to post · {ready.length}</div>
          <ul className="posts-list">
            {list(foldBatches(ready), (post) => (
              <WaitingPost key={post.id} editable={editable} onEdit={onEditAgain} campaigns={campaigns} onChanged={onMusicDone} post={post} busy={busy.has(post.id)} onAct={(action, fields) => void act(post, action, fields)} />
            ))}
          </ul>
        </>
      ) : null}

      {sendingNow.length > 0 || working.length > 0 ? (
        <>
          <div className="list-title">On the way</div>
          <ul className="posts-list">
            {sendingNow.map((item) => (
              <SendingRow key={item.entry.key} item={item} onRemove={() => void forgetSend(item.entry.key)} />
            ))}
            {working.map((post) => (
              <OtherPost key={post.id} editable={editable} onEdit={onEditAgain} campaigns={campaigns} onChanged={onMusicDone} post={post} busy={busy.has(post.id)} onAct={(action) => void act(post, action)} />
            ))}
          </ul>
        </>
      ) : null}

      {failed.length > 0 ? (
        <>
          <div className="list-title">Failed</div>
          <ul className="posts-list">
            {failed.map((post) => (
              <OtherPost key={post.id} editable={editable} onEdit={onEditAgain} campaigns={campaigns} onChanged={onMusicDone} post={post} busy={busy.has(post.id)} onAct={(action) => void act(post, action)} />
            ))}
          </ul>
        </>
      ) : null}

      {scheduled.length > 0 ? (
        <>
          <div className="list-title">Scheduled · {scheduled.length}</div>
          <ul className="posts-list">
            {list(foldBatches(scheduled), (post) => (
              <OtherPost key={post.id} editable={editable} onEdit={onEditAgain} campaigns={campaigns} onChanged={onMusicDone} post={post} busy={busy.has(post.id)} onAct={(action) => void act(post, action)} />
            ))}
          </ul>
        </>
      ) : null}

      {done.length > 0 ? (
        <>
          <div className="list-title">Posted · {done.length}</div>
          <ul className="posts-list">
            {(allPosted ? done : done.slice(0, POSTED_SHOWN)).map((post) => (
              <OtherPost key={post.id} editable={editable} onEdit={onEditAgain} campaigns={campaigns} onChanged={onMusicDone} post={post} busy={busy.has(post.id)} onAct={(action) => void act(post, action)} />
            ))}
          </ul>
          {done.length > POSTED_SHOWN ? (
            <button type="button" className="linkbtn" onClick={() => setAllPosted((a) => !a)}>
              {allPosted ? 'Show fewer' : `Show all ${done.length}`}
            </button>
          ) : null}
        </>
      ) : null}
      </>
      )}
    </section>
  )
}
