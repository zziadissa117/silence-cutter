// "Add music" on a post in Posts: pick a track (the music bank's, an angle's
// or the batch bank's), and it is mixed under the finished video and sent as
// a new version, approved - see musicAfterSend.ts.

import { useEffect, useState } from 'react'

import type { Campaign } from './look'
import { loadBankFile, loadBatchBank } from './store'
import { loadMusicBank, songFile } from './musicBank'
import { PlayButton } from './TrackPlayer'
import { sendWithMusic } from './musicAfterSend'
import type { ServerPost } from './posting'

interface Option {
  id: string
  name: string
  load: () => Promise<Blob | null>
}

export function MusicAfter({
  post,
  campaigns,
  caption,
  onDone,
  onClose,
}: {
  post: ServerPost
  campaigns: Campaign[]
  /** His caption as it is in the box now. */
  caption?: string
  /** Said to him when it finishes. */
  onDone: (message: string) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<Option[]>([])
  const [choice, setChoice] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const found: Option[] = []
      const names = new Set<string>()
      const add = (o: Option) => {
        if (names.has(o.name)) return
        names.add(o.name)
        found.push(o)
      }
      for (const song of await loadMusicBank()) add({ id: `bank:${song.id}`, name: song.name, load: () => songFile(song) })
      for (const c of campaigns) {
        for (const a of c.angles) {
          const track = a.music
          if (track) add({ id: `angle:${c.id}:${a.id}`, name: track.name, load: async () => track.audio })
        }
      }
      const bank = await loadBatchBank(post.campaignId).catch(() => null)
      for (const file of bank?.music ?? []) add({ id: `bank:${file.id}`, name: file.name, load: () => loadBankFile(file) })
      if (alive) {
        setOptions(found)
        setChoice(found[0]?.id ?? '')
      }
    })()
    return () => {
      alive = false
    }
  }, [campaigns, post.campaignId])

  const busy = progress !== null
  const picked = options.find((o) => o.id === choice) ?? null
  // "Approve, post later" stays his to post; a brand's post waits for the brand.
  const approve = !post.ready && post.approval !== 'brand'

  const run = async () => {
    setError(null)
    setProgress(0)
    try {
      const audio = await picked?.load()
      if (!audio) throw new Error('That track is no longer on this phone.')
      const campaign = campaigns.find((c) => c.id === post.campaignId)
      const message = await sendWithMusic({ post, campaign, music: { audio, level: 'normal' }, caption, approve, onProgress: setProgress })
      onDone(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    }
  }

  const label = approve && post.status === 'waiting' ? 'Add music & approve' : 'Add music'
  return (
    <div className="music-after">
      {options.length > 0 ? (
        <div className="music-pick">
          <select aria-label="Track" value={choice} disabled={busy} onChange={(e) => setChoice(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {picked ? <PlayButton name={picked.name} load={picked.load} disabled={busy} /> : null}
        </div>
      ) : (
        <p className="hint">No songs yet - add some in Bank, Music.</p>
      )}
      {error ? <p className="hint warn-text">{error}</p> : null}
      <div className="post-actions">
        <button type="button" className="btn small primary" disabled={busy || !picked} onClick={() => void run()}>
          {busy ? `Adding music… ${Math.round((progress ?? 0) * 100)}%` : label}
        </button>
        <button type="button" className="linkbtn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
