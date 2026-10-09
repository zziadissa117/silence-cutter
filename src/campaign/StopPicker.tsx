// Picking posts to stop, on the Posts screen: a whole campaign in one tap, or
// any posts by hand, then one Stop. For a campaign that has ended with posts
// still lined up - a hundred of them is one tap, not a hundred.

import { useMemo, useState } from 'react'

import { stopPosts, whenLabel, type ServerPost } from './posting'

const STATUS_WORD: Record<string, string> = {
  uploading: 'Going up',
  writing: 'Caption being written',
  waiting: 'To approve',
  approved: 'Approved',
  scheduled: 'Scheduled',
}

export function StopPicker({
  posts,
  onDone,
  onCancel,
}: {
  /** Only the posts that can still be stopped. */
  posts: ServerPost[]
  /** After a stop, what it did in words. */
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Campaigns in the order their first post comes.
  const campaigns = useMemo(() => {
    const out = new Map<string, { name: string; ids: string[] }>()
    for (const p of posts) {
      const entry = out.get(p.campaignId) ?? { name: p.campaignName, ids: [] }
      entry.ids.push(p.id)
      out.set(p.campaignId, entry)
    }
    return [...out.entries()].map(([id, c]) => ({ id, ...c }))
  }, [posts])

  const allOf = (ids: string[]) => ids.length > 0 && ids.every((id) => picked.has(id))
  const toggleAll = (ids: string[]) =>
    setPicked((current) => {
      const next = new Set(current)
      if (allOf(ids)) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const stop = async () => {
    const ids = [...picked]
    if (ids.length === 0) return
    if (!window.confirm(`Stop ${ids.length} post${ids.length === 1 ? '' : 's'}? Ones scheduled in Postiz are taken out. They won't go out.`)) return
    setBusy(true)
    setProblem(null)
    try {
      const { stopped, unposting } = await stopPosts(ids)
      onDone(
        `Stopped ${stopped} post${stopped === 1 ? '' : 's'}.` +
          (unposting > 0 ? ` ${unposting} ${unposting === 1 ? 'is' : 'are'} being taken out of Postiz over the next few minutes.` : ''),
      )
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const everything = posts.map((p) => p.id)

  return (
    <div className="stop-picker">
      <div className="hint">Tick what to stop - a whole campaign, or posts one by one.</div>
      <div className="seg chips" role="group" aria-label="Tick a whole campaign">
        <button type="button" className={allOf(everything) ? 'active' : ''} aria-pressed={allOf(everything)} onClick={() => toggleAll(everything)}>
          All {everything.length}
        </button>
        {campaigns.map((c) => (
          <button key={c.id} type="button" className={allOf(c.ids) ? 'active' : ''} aria-pressed={allOf(c.ids)} onClick={() => toggleAll(c.ids)}>
            {c.name} {c.ids.length}
          </button>
        ))}
      </div>

      <ul className="rows" aria-label="Posts that can be stopped">
        {posts.map((p) => (
          <li key={p.id}>
            <label className="toggle">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span>
                <span className="label">{p.campaignName}</span>
                <span className="hint" style={{ display: 'block' }}>
                  {STATUS_WORD[p.status] ?? p.status}
                  {p.status === 'scheduled' || p.postAt ? ` · ${whenLabel(p.postAt)}` : ''}
                  {p.fileName ? ` · ${p.fileName}` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {problem ? <div className="error">{problem}</div> : null}

      <div className="editor-foot sticky">
        <button type="button" className="btn danger wide" disabled={busy || picked.size === 0} onClick={() => void stop()}>
          {busy ? 'Stopping…' : picked.size === 0 ? 'Tick posts to stop' : `Stop ${picked.size} post${picked.size === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="linkbtn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
