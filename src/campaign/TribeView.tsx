// The Tribe tab (tribe.ts): every video he made for Tribe, kept on the phone
// with its recording until he marks it approved. Waiting on Tribe on top -
// watch it, save it again, edit it again when Tribe asks for a change - and
// the approved ones folded below (their recording gone, the video kept).

import { useEffect, useState } from 'react'

import { FullPage } from './FullPage'
import { CloseIcon } from './icons'
import { formatTime } from './jobs'
import { canShareFiles, share } from './jobs'
import { approveTribe, forgetJob, hasRecording, heldVideos, loadHeldVideo, unapproveTribe, type PendingJob } from './store'

interface TribeVideo {
  id: string
  name: string
  headline: string
  seconds: number
  madeAt: number
  version: number
  approvedAt?: number
  recording: boolean
}

const dayOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export function TribeView({ version, editing, onEditAgain }: { version: number; editing: number; onEditAgain: (id: string) => void }) {
  const [videos, setVideos] = useState<TribeVideo[] | null>(null)
  const [readAgain, setReadAgain] = useState(0)
  const [watching, setWatching] = useState<TribeVideo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [showApproved, setShowApproved] = useState(false)

  useEffect(() => {
    let alive = true
    void heldVideos().then(async (rows: PendingJob[]) => {
      const mine = rows.filter((r) => r.tribe && r.held && r.madeAt !== undefined)
      const list = await Promise.all(
        mine.map(async (r) => ({
          id: r.id,
          name: r.fileName,
          headline: r.held!.headline || r.headlineText || '',
          seconds: r.held!.duration,
          madeAt: r.madeAt!,
          version: r.version ?? 1,
          ...(r.tribe?.approvedAt ? { approvedAt: r.tribe.approvedAt } : {}),
          recording: await hasRecording(r.id),
        })),
      )
      if (alive) setVideos(list.sort((a, b) => b.madeAt - a.madeAt))
    })
    return () => {
      alive = false
    }
  }, [version, readAgain])

  const act = async (id: string, what: () => Promise<void>) => {
    setBusy(id)
    setSaid(null)
    try {
      await what()
      setReadAgain((n) => n + 1)
    } catch (error) {
      setSaid(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const save = (v: TribeVideo) =>
    act(v.id, async () => {
      const blob = await loadHeldVideo(v.id)
      if (!blob) throw new Error('This video is no longer on the phone.')
      const file = new File([blob], `${v.name.replace(/\.[^./]+$/, '')}${v.version > 1 ? ` v${v.version}` : ''}.mp4`, { type: 'video/mp4' })
      if (canShareFiles([file])) {
        await share([file])
        return
      }
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    })

  const waiting = (videos ?? []).filter((v) => !v.approvedAt)
  const approved = (videos ?? []).filter((v) => v.approvedAt)

  const row = (v: TribeVideo) => (
    <li key={v.id} className="tribe-item">
      <button type="button" className="tribe-still" aria-label={`Watch ${v.name}`} onClick={() => setWatching(v)}>
        <Still id={v.id} />
        <span className="var-len">{formatTime(v.seconds)}</span>
      </button>
      <div className="tribe-text">
        <span className="row-name">{v.headline || v.name}</span>
        <span className="hint">
          Made {dayOf(v.madeAt)}
          {v.version > 1 ? ` · edit ${v.version}` : ''}
          {v.approvedAt ? ` · approved ${dayOf(v.approvedAt)}` : ''}
        </span>
        <div className="actions-row">
          <button type="button" className="btn small" disabled={busy !== null} onClick={() => void save(v)}>
            Save
          </button>
          {!v.approvedAt ? (
            <>
              <button type="button" className="btn small" disabled={busy !== null || !v.recording} onClick={() => onEditAgain(v.id)}>
                Edit again
              </button>
              <button
                type="button"
                className="btn small primary"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm('Tribe approved it? Its recording leaves the phone to free space - the finished video stays here.')) {
                    void act(v.id, () => approveTribe(v.id))
                  }
                }}
              >
                Approved ✓
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn small" disabled={busy !== null} onClick={() => void act(v.id, () => unapproveTribe(v.id))}>
                Not approved
              </button>
              <button
                type="button"
                className="linkbtn warn-text"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm('Delete this video from the phone?')) void act(v.id, () => forgetJob(v.id))
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
        {!v.approvedAt && !v.recording ? <span className="hint warn-text">Its recording is gone - it can be saved, not edited again.</span> : null}
      </div>
    </li>
  )

  return (
    <section className="screen tribe">
      <div className="screen-head">
        <h1>Tribe</h1>
      </div>
      <p className="hint tip">
        Add your videos as usual and pick Tribe for them. They&rsquo;re made, never posted, and kept here with their recording until you mark them approved -
        edit again whenever Tribe asks for a change.
      </p>
      {editing > 0 ? (
        <p className="hint">
          {editing} being edited on Videos{editing === 1 ? '' : ' now'}.
        </p>
      ) : null}
      {said ? <p className="hint warn-text">{said}</p> : null}
      {videos === null ? null : waiting.length === 0 ? (
        <p className="empty">Nothing waiting on Tribe.</p>
      ) : (
        <div className="group">
          <div className="group-title">
            Waiting on Tribe <span className="bank-count">{waiting.length}</span>
          </div>
          <ul className="tribe-list">{waiting.map(row)}</ul>
        </div>
      )}
      {approved.length > 0 ? (
        <div className="group">
          <button type="button" className="linkbtn" onClick={() => setShowApproved((s) => !s)}>
            {showApproved ? 'Hide' : 'Show'} approved ({approved.length})
          </button>
          {showApproved ? <ul className="tribe-list">{approved.map(row)}</ul> : null}
        </div>
      ) : null}

      {watching ? (
        <FullPage>
          <div className="var-viewer" role="dialog" aria-label={watching.name}>
            <div className="var-viewer-head">
              <span className="row-name">{watching.headline || watching.name}</span>
              <button type="button" className="clip-editor-close" aria-label="Close" onClick={() => setWatching(null)}>
                <CloseIcon />
              </button>
            </div>
            <div className="var-viewer-video">
              <Player id={watching.id} />
            </div>
          </div>
        </FullPage>
      ) : null}
    </section>
  )
}

/** A kept video's object URL while it is shown. */
function useHeldUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    void loadHeldVideo(id).then((blob) => {
      if (!alive || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
      setUrl(null)
    }
  }, [id])
  return url
}

function Still({ id }: { id: string }) {
  const url = useHeldUrl(id)
  return url ? <video className="var-still" src={`${url}#t=0.5`} muted playsInline preload="metadata" /> : <span className="var-still" />
}

function Player({ id }: { id: string }) {
  const url = useHeldUrl(id)
  return url ? <video key={url} src={url} autoPlay playsInline loop controls /> : <p className="hint">Getting it…</p>
}
