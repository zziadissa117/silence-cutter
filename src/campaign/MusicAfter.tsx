// "Add music" on a post waiting in Posts: pick a track (an angle's, one from
// the batch bank, or one from the phone), how loud, and it is mixed under the
// finished video and sent as a new version - see musicAfterSend.ts.

import { useEffect, useState } from 'react'

import type { Campaign } from './look'
import type { MusicLevel } from './music'
import { loadBankFile, loadBatchBank } from './store'
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
  onDone,
  onClose,
}: {
  post: ServerPost
  campaigns: Campaign[]
  /** Said to him when it finishes. */
  onDone: (message: string) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<Option[]>([])
  const [choice, setChoice] = useState('')
  const [phone, setPhone] = useState<File | null>(null)
  const [level, setLevel] = useState<MusicLevel>('normal')
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
  const ready = phone !== null || options.some((o) => o.id === choice)

  const run = async () => {
    setError(null)
    setProgress(0)
    try {
      const audio = phone ?? (await options.find((o) => o.id === choice)?.load())
      if (!audio) throw new Error('That track is no longer on this phone.')
      const campaign = campaigns.find((c) => c.id === post.campaignId)
      const message = await sendWithMusic({ post, campaign, music: { audio, level }, onProgress: setProgress })
      onDone(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    }
  }

  return (
    <div className="music-after">
      <div className="group-title">Add music to this video</div>
      <p className="hint">
        The picture is not touched - only the sound. The track goes under the video's own sound. If it already has music, this adds a second track on top; to swap it, make the video
        again with Edit again.
      </p>
      {options.length > 0 ? (
        <label className="field">
          <span className="label">Track</span>
          <select
            value={phone ? '' : choice}
            disabled={busy}
            onChange={(e) => {
              setChoice(e.target.value)
              setPhone(null)
            }}
          >
            {phone ? <option value="">{phone.name}</option> : null}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="btn small picker">
        {phone ? `From my phone: ${phone.name}` : 'From my phone'}
        <input
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.aac"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null
            e.target.value = ''
            if (file) setPhone(file)
          }}
        />
      </label>
      <div className="seg full" role="radiogroup" aria-label="Music level">
        {(['normal', 'low'] as const).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={level === l} className={level === l ? 'active' : ''} disabled={busy} onClick={() => setLevel(l)}>
            {l === 'normal' ? 'Normal' : 'Quieter'}
          </button>
        ))}
      </div>
      {error ? <p className="hint warn-text">{error}</p> : null}
      <div className="post-actions">
        <button type="button" className="btn small primary" disabled={busy || !ready} onClick={() => void run()}>
          {busy ? `Adding music… ${Math.round((progress ?? 0) * 100)}%` : 'Add music'}
        </button>
        <button type="button" className="linkbtn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
