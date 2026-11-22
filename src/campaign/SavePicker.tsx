// Saving the videos waiting for his approval to the phone, many at once (his
// ask, 2026-11-22: "save all videos that are up for approval at the same
// time ... Or I can just click Select ... select all the videos I want to
// save, and then save them all"). Every one is ticked to start - the whole
// campaign he is looking at, or all of them; untick what he doesn't want.
//
// The iPhone opens its share sheet only straight from a tap, and only with
// the videos already in memory, so they come in groups: Get reads a group,
// Save hands it to the share sheet ("Save N Videos"), then the next group.
// A group is kept small enough for the phone's memory.

import { useMemo, useState } from 'react'

import { localVideo } from './outbox'
import type { ServerPost } from './posting'
import { hasShareSheet, shareName } from './shareFile'

/** Videos read and shared at once: about what an iPhone holds in memory
 *  for the share sheet without trouble. */
export const SAVE_GROUP = 8

/** A post's video, from the phone's own copy or Postiz's. Null when neither
 *  can be had. */
async function videoOf(post: ServerPost): Promise<File | null> {
  let blob = await localVideo(post.key).catch(() => null)
  if ((!blob || blob.size === 0) && post.videoUrl) {
    const response = await fetch(post.videoUrl).catch(() => null)
    blob = response?.ok ? await response.blob().catch(() => null) : null
  }
  if (!blob || blob.size === 0) return null
  const base = (post.fileName ?? 'video').replace(/\.[^./]+$/, '')
  const tag = post.campaignName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
  return new File([await blob.arrayBuffer()], shareName(`${base}_${tag || 'post'}.mp4`), { type: 'video/mp4' })
}

export function SavePicker({ posts, onClose }: { posts: ServerPost[]; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(posts.map((p) => p.id)))
  /** The group being saved: its videos in memory, ready for the share sheet. */
  const [ready, setReady] = useState<File[] | null>(null)
  const [getting, setGetting] = useState<{ done: number; of: number } | null>(null)
  /** How many of the picked are saved (handed to the share sheet) so far. */
  const [savedCount, setSavedCount] = useState(0)
  const [missing, setMissing] = useState<string[]>([])
  const [said, setSaid] = useState<string | null>(null)

  const campaigns = useMemo(() => {
    const out = new Map<string, { name: string; ids: string[] }>()
    for (const p of posts) {
      const entry = out.get(p.campaignId) ?? { name: p.campaignName, ids: [] }
      entry.ids.push(p.id)
      out.set(p.campaignId, entry)
    }
    return [...out.entries()].map(([id, c]) => ({ id, ...c }))
  }, [posts])

  const chosen = posts.filter((p) => picked.has(p.id))
  const started = savedCount > 0 || ready !== null || getting !== null
  const group = chosen.slice(savedCount, savedCount + SAVE_GROUP)
  const groups = Math.ceil(chosen.length / SAVE_GROUP)
  const groupNo = Math.floor(savedCount / SAVE_GROUP) + 1
  const range = chosen.length > SAVE_GROUP ? ` (${savedCount + 1}-${savedCount + group.length} of ${chosen.length})` : ''

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

  /** This group's videos into memory. */
  const get = async () => {
    setSaid(null)
    setGetting({ done: 0, of: group.length })
    const files: File[] = []
    const lost: string[] = []
    for (const [i, post] of group.entries()) {
      const file = await videoOf(post)
      if (file) files.push(file)
      else lost.push(post.fileName ?? post.campaignName)
      setGetting({ done: i + 1, of: group.length })
    }
    setGetting(null)
    setMissing((m) => [...m, ...lost])
    if (files.length === 0) {
      setSavedCount((n) => n + group.length)
      setSaid("None of these could be fetched - they're no longer on this phone or in Postiz.")
      return
    }
    setReady(files)
  }

  /** The group to the share sheet (straight from his tap), or downloaded on a computer. */
  const save = async () => {
    if (!ready) return
    if (hasShareSheet()) {
      try {
        await navigator.share({ files: ready })
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setSaid("The phone couldn't open them all at once. Tap Save again, or untick some and try fewer.")
          return
        }
      }
    } else {
      for (const file of ready) {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
    }
    setReady(null)
    setSavedCount((n) => n + group.length)
  }

  const done = started && savedCount >= chosen.length && !ready && !getting

  return (
    <div className="stop-picker save-picker">
      {said ? (
        <div className="error" role="alert">
          {said}
        </div>
      ) : null}
      {started ? null : (
        <>
          <div className="hint tip">Every video waiting for your approval is ticked. Untick any you don&rsquo;t want, then Save.</div>
          <div className="seg chips" role="group" aria-label="Tick a whole campaign">
            <button type="button" className={allOf(posts.map((p) => p.id)) ? 'active' : ''} aria-pressed={allOf(posts.map((p) => p.id))} onClick={() => toggleAll(posts.map((p) => p.id))}>
              All {posts.length}
            </button>
            {campaigns.length > 1
              ? campaigns.map((c) => (
                  <button key={c.id} type="button" className={allOf(c.ids) ? 'active' : ''} aria-pressed={allOf(c.ids)} onClick={() => toggleAll(c.ids)}>
                    {c.name} {c.ids.length}
                  </button>
                ))
              : null}
          </div>
          <ul className="rows" aria-label="Videos to save">
            {posts.map((p) => (
              <li key={p.id}>
                <label className="toggle">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span>
                    <span className="label">{p.headline?.trim() || p.fileName || p.campaignName}</span>
                    <span className="hint" style={{ display: 'block' }}>
                      {p.campaignName}
                      {p.fileName ? ` · ${p.fileName}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {done ? (
        <p className="hint">
          {chosen.length - missing.length} saved{missing.length > 0 ? ` · ${missing.length} couldn't be fetched: ${missing.join(', ')}` : ''}. They&rsquo;re
          still waiting for your approval here.
        </p>
      ) : getting ? (
        <p className="hint">
          Getting video {getting.done + 1 > getting.of ? getting.of : getting.done + 1} of {getting.of}
          {groups > 1 ? ` (group ${groupNo} of ${groups})` : ''}…
        </p>
      ) : null}

      <div className="actions-row">
        {done ? null : ready ? (
          <button type="button" className="btn primary" onClick={() => void save()}>
            Save {ready.length} to my phone{range}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={chosen.length === 0 || getting !== null} onClick={() => void get()}>
            {getting ? 'Getting them…' : savedCount > 0 ? `Get the next ${group.length}${range}` : `Save ${chosen.length}`}
          </button>
        )}
        <button type="button" className="btn" disabled={getting !== null} onClick={onClose}>
          {done ? 'Done' : 'Cancel'}
        </button>
      </div>
      {!started && chosen.length > SAVE_GROUP ? (
        <p className="hint">They come {SAVE_GROUP} at a time, so the phone has room: a tap to get them, a tap to save, then the next ones.</p>
      ) : null}
    </div>
  )
}
