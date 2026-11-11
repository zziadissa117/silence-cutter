// More -> Warm-ups (his ask, 2026-11-11): ideas for short warm-up posts that
// anyone using the Cutter can film in a few seconds - each with its example (a
// post on Instagram or TikTok, or a video), how to film it, its headline, its
// sound and its length. Anyone adds one; the owner's own (and his partners')
// go up at once, anyone else's wait for his OK - he can change them first.
// The same for a new category. See warmups.ts.

import { useMemo, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { HeadlineLook } from './JobRow'
import type { HeadlineStyle } from './look'
import { BackToMore } from './MoreView'
import { isVideoFile, songFile, soundOf, songName, useMusicBank } from './musicBank'
import { PlayButton } from './TrackPlayer'
import {
  addCategory,
  approveCategory,
  approveWarmup,
  newWarmupId,
  removeWarmup,
  saveWarmup,
  sendWarmupFile,
  useWarmups,
  warmupFile,
  WARMUP_SECONDS,
  dropMade,
  madeFile,
  useMade,
  type MadeWarmup,
  type WarmupCategory,
  type WarmupIdea,
} from './warmups'
import { WarmupFilm } from './WarmupFilm'

const where = (link: string) => (/tiktok\.com/i.test(link) ? 'TikTok' : 'Instagram')

/** How many in one go of "Film several": a couple of minutes' filming. */
const IN_ONE_GO = 5

export function WarmupView({ onBack }: { onBack?: () => void }) {
  const { list, refresh, problem } = useWarmups()
  const [category, setCategory] = useState<string>('all')
  const [editing, setEditing] = useState<WarmupIdea | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filming, setFilming] = useState<WarmupIdea[] | null>(null)
  const made = useMade()
  const ready = made.filter((m) => !m.posted)
  const onFilm = (ideas: WarmupIdea[]) => setFilming(ideas)
  const approved = list.categories.filter((c) => c.status === 'approved')
  const nameOf = (id: string) => list.categories.find((c) => c.id === id)?.name ?? id
  const shown = list.ideas.filter((i) => i.status === 'approved' && (category === 'all' || i.category === category))
  const waiting = list.ideas.filter((i) => i.status === 'waiting')
  const waitingCats = list.categories.filter((c) => c.status === 'waiting')

  const run = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await work()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const suggestCategory = () => {
    const name = window.prompt(list.owner ? 'New category' : 'New category - the owner says yes or no first')
    if (name?.trim()) void run('Adding the category…', () => addCategory(name.trim()))
  }

  if (filming) return <WarmupFilm ideas={filming} onClose={() => setFilming(null)} />

  if (editing) {
    return (
      <IdeaForm
        start={editing === 'new' ? null : editing}
        categories={approved}
        owner={list.owner}
        firstCategory={category === 'all' ? approved[0]?.id : category}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void refresh()
        }}
      />
    )
  }

  return (
    <section className="screen warmups" aria-label="Warm-ups">
      {onBack ? <BackToMore onBack={onBack} /> : null}
      <div className="screen-head">
        <h1>Warm-ups</h1>
        <button type="button" className="btn small primary" onClick={() => setEditing('new')}>
          + Idea
        </button>
      </div>
      <p className="lede">
        Short posts that warm an account up between its videos: a set headline, a set sound, about 7 seconds, no talking.
        Read how to film it, film it, done.
      </p>
      {shown.length > 0 ? (
        <button
          type="button"
          className="btn primary wide"
          onClick={() => {
            // The ones he has filmed least first, a couple of minutes' worth.
            const times = (id: string) => made.filter((m) => m.ideaId === id).length
            onFilm([...shown].sort((a, b) => times(a.id) - times(b.id)).slice(0, IN_ONE_GO))
          }}
        >
          Film {Math.min(IN_ONE_GO, shown.length)} in one go
        </button>
      ) : null}
      {ready.length > 0 ? <ReadyList ready={ready} /> : null}
      {problem ? <p className="hint warn-text">{problem}</p> : null}
      {error ? <div className="error">{error}</div> : null}
      {busy ? <p className="hint">{busy}</p> : null}

      {list.owner && (waiting.length > 0 || waitingCats.length > 0) ? (
        <div className="group warmup-waiting">
          <div className="group-title">Waiting for your OK · {waiting.length + waitingCats.length}</div>
          {waitingCats.map((c) => (
            <div key={c.id} className="setting">
              <div className="setting-text">
                <span className="row-line">Category: {c.name}</span>
              </div>
              <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void run('Approving…', () => approveCategory(c.id, true))}>
                Approve
              </button>
              <button type="button" className="btn small" disabled={busy !== null} onClick={() => void run('Refusing…', () => approveCategory(c.id, false))}>
                Refuse
              </button>
            </div>
          ))}
          {waiting.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} category={nameOf(idea.category)}>
              <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void run('Approving…', () => approveWarmup(idea.id, true))}>
                Approve
              </button>
              <button type="button" className="btn small" disabled={busy !== null} onClick={() => setEditing(idea)}>
                Change it
              </button>
              <button
                type="button"
                className="btn small danger"
                disabled={busy !== null}
                onClick={() => window.confirm(`Refuse "${idea.title}"? It is taken out.`) && void run('Refusing…', () => approveWarmup(idea.id, false))}
              >
                Refuse
              </button>
            </IdeaCard>
          ))}
        </div>
      ) : null}

      <div className="seg warmup-cats" role="tablist" aria-label="Category">
        {[{ id: 'all', name: 'All' } as Pick<WarmupCategory, 'id' | 'name'>, ...approved].map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={category === c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}>
            {c.name}
          </button>
        ))}
        <button type="button" className="linkbtn" onClick={suggestCategory}>
          + Category
        </button>
      </div>

      {!list.owner && waiting.length > 0 ? (
        <p className="hint">
          {waiting.length} of yours waiting for the owner's OK: {waiting.map((i) => i.title).join(', ')}.
        </p>
      ) : null}
      {shown.length === 0 ? <p className="empty">No warm-up ideas here yet. Add the first with + Idea.</p> : null}
      {shown.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} category={nameOf(idea.category)}>
          <button type="button" className="btn small primary" onClick={() => onFilm([idea])}>
            Film it
          </button>
          {list.owner ? (
            <>
              <button type="button" className="btn small" onClick={() => setEditing(idea)}>
                Change it
              </button>
              <button
                type="button"
                className="btn small danger"
                disabled={busy !== null}
                onClick={() => window.confirm(`Take "${idea.title}" out for everyone?`) && void run('Taking it out…', () => removeWarmup(idea.id))}
              >
                Take out
              </button>
            </>
          ) : null}
        </IdeaCard>
      ))}
    </section>
  )
}

/** The warm-ups filmed on this phone, waiting to go out. */
function ReadyList({ ready }: { ready: MadeWarmup[] }) {
  const [watching, setWatching] = useState<{ id: string; url: string } | null>(null)
  const watch = async (m: MadeWarmup) => {
    if (watching) URL.revokeObjectURL(watching.url)
    const file = await madeFile(m)
    setWatching(file ? { id: m.id, url: URL.createObjectURL(file) } : null)
  }
  return (
    <div className="group">
      <div className="group-title">Ready to post · {ready.length}</div>
      <p className="hint">Each goes out once, on a campaign you turned warm-ups on for.</p>
      {ready.map((m) => (
        <div key={m.id} className="setting">
          <div className="setting-text">
            <span className="row-line">{m.title}</span>
            <span className="row-line hint">{m.headline || 'No headline'}</span>
          </div>
          <button type="button" className="btn small" onClick={() => void watch(m)}>
            Watch
          </button>
          <button type="button" className="btn small danger" onClick={() => window.confirm(`Throw away this "${m.title}"?`) && void dropMade(m.id)}>
            ✕
          </button>
        </div>
      ))}
      {watching ? <video className="warmup-example" src={watching.url} controls playsInline autoPlay /> : null}
    </div>
  )
}

/** One idea: what it is, its example, how to film it, its headline, sound and length. */
function IdeaCard({ idea, category, children }: { idea: WarmupIdea; category: string; children?: React.ReactNode }) {
  const [example, setExample] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const showExample = async () => {
    if (!idea.example || !('video' in idea.example)) return
    setLoading(true)
    const file = await warmupFile(idea.example.video)
    setLoading(false)
    if (file) setExample(URL.createObjectURL(file))
  }
  return (
    <div className="warmup-card">
      <div className="warmup-head">
        <span className="row-name">{idea.title}</span>
        <span className="hint">
          {category} · {idea.seconds} s{idea.byName ? ` · ${idea.byName}` : ''}
        </span>
      </div>
      {idea.example && 'link' in idea.example ? (
        <a className="btn small" href={idea.example.link} target="_blank" rel="noreferrer">
          See it on {where(idea.example.link)}
        </a>
      ) : idea.example && 'video' in idea.example ? (
        example ? (
          <video className="warmup-example" src={example} controls playsInline />
        ) : (
          <button type="button" className="btn small" disabled={loading} onClick={() => void showExample()}>
            {loading ? 'Getting it…' : 'See the example'}
          </button>
        )
      ) : null}
      {idea.script ? <p className="warmup-script">{idea.script}</p> : null}
      {idea.headline ? (
        <p className="hint">
          Headline: <strong>{idea.headline}</strong>
        </p>
      ) : null}
      {idea.sound ? (
        <div className="warmup-sound">
          <PlayButton name={idea.sound.name} load={() => warmupFile(idea.sound!)} />
          <span className="hint">{idea.sound.name}</span>
        </div>
      ) : null}
      {children ? <div className="actions-row">{children}</div> : null}
    </div>
  )
}

/** Adding an idea, or changing one. */
function IdeaForm({
  start,
  categories,
  owner,
  firstCategory,
  onCancel,
  onSaved,
}: {
  start: WarmupIdea | null
  categories: WarmupCategory[]
  owner: boolean
  firstCategory?: string
  onCancel: () => void
  onSaved: () => void
}) {
  const songs = useMusicBank('all')
  const [title, setTitle] = useState(start?.title ?? '')
  const [category, setCategory] = useState(start?.category ?? firstCategory ?? categories[0]?.id ?? '')
  const [script, setScript] = useState(start?.script ?? '')
  const [headline, setHeadline] = useState(start?.headline ?? '')
  const [style, setStyle] = useState<HeadlineStyle>(start?.headlineStyle ?? 'box')
  const [seconds, setSeconds] = useState(start?.seconds ?? WARMUP_SECONDS.usual)
  const [link, setLink] = useState(start?.example && 'link' in start.example ? start.example.link : '')
  const [video, setVideo] = useState<File | null>(null)
  const [sound, setSound] = useState<{ file: File; name: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const soundPicker = useRef<HTMLInputElement>(null)
  const keptSound = start?.sound ?? null
  const keptVideo = start?.example && 'video' in start.example ? start.example.video : null
  const ready = title.trim() && category && !busy
  const linkOk = useMemo(() => !link.trim() || /^https:\/\/([\w-]+\.)*(instagram|tiktok)\.com\//i.test(link.trim()), [link])

  const save = async () => {
    if (!ready || !linkOk) return
    setError(null)
    try {
      setBusy('Sending the sound…')
      const soundFile = sound ? await sendWarmupFile(sound.file, sound.name) : keptSound
      setBusy(video ? 'Sending the example…' : 'Saving…')
      const videoFile = video ? await sendWarmupFile(video, video.name) : null
      const example = link.trim() ? { link: link.trim() } : videoFile ? { video: videoFile } : keptVideo ? { video: keptVideo } : null
      setBusy('Saving…')
      await saveWarmup({
        id: start?.id ?? newWarmupId(),
        title: title.trim(),
        category,
        script: script.trim(),
        headline: headline.trim(),
        headlineStyle: style === 'box' || style === 'outline' || style === 'snap' ? style : 'box',
        seconds,
        sound: soundFile,
        example,
        addedAt: start?.addedAt ?? Date.now(),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const pickSound = async (file: File) => {
    setBusy(isVideoFile(file) ? `Taking the sound out of ${file.name}…` : null)
    try {
      const audio = isVideoFile(file) ? await soundOf(file) : file
      setSound({ file: audio, name: songName(file.name) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="screen warmups" aria-label={start ? 'Change the warm-up idea' : 'New warm-up idea'}>
      <div className="screen-head">
        <h1>{start ? 'Change the idea' : 'New warm-up idea'}</h1>
      </div>
      {!owner && !start ? <p className="lede">It goes up for everyone once the owner says yes.</p> : null}
      <label className="field">
        <span className="label">Title</span>
        <input type="text" value={title} maxLength={80} placeholder="Point at the text" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="label">Example</span>
        <input type="text" inputMode="url" autoCapitalize="none" value={link} placeholder="A link to the post on Instagram or TikTok" onChange={(e) => setLink(e.target.value)} />
        {!linkOk ? <span className="hint warn-text">Only a link to Instagram or TikTok.</span> : null}
        {!link.trim() ? (
          <VideoPicker className="btn small" label="Or a video" onFiles={(files) => setVideo(files[0] ?? null)}>
            {video ? `Video: ${video.name}` : keptVideo ? 'Change the video' : 'Or a video'}
          </VideoPicker>
        ) : null}
      </div>
      <label className="field">
        <span className="label">How to film it</span>
        <textarea rows={4} value={script} maxLength={1500} placeholder="Phone on the table, look at it, point up when the text comes in." onChange={(e) => setScript(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Headline</span>
        <input type="text" value={headline} maxLength={120} placeholder="POV: you started training" onChange={(e) => setHeadline(e.target.value)} />
        <span className="hint">Whoever films it can change it for their video.</span>
      </label>
      <HeadlineLook value={style} onPick={setStyle} />
      <div className="field">
        <span className="label">Sound</span>
        <select
          value=""
          onChange={(e) => {
            const song = songs.find((s) => s.id === e.target.value)
            if (song) void songFile(song).then((file) => file && setSound({ file, name: song.name }))
          }}
        >
          <option value="">{sound ? sound.name : keptSound ? keptSound.name : 'From the music bank…'}</option>
          {songs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn small" onClick={() => soundPicker.current?.click()}>
          Or a sound from my phone
        </button>
        <input
          ref={soundPicker}
          type="file"
          hidden
          accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.mp4,.mov"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void pickSound(file)
          }}
        />
        <span className="hint">The trend or the music - the video's own sound is left out.</span>
      </div>
      <div className="field">
        <span className="label">Length</span>
        <div className="stepper">
          <button type="button" className="btn small icon-btn" aria-label="Shorter" disabled={seconds <= WARMUP_SECONDS.min} onClick={() => setSeconds(seconds - 1)}>
            −
          </button>
          <span className="stepper-value">{seconds} s</span>
          <button type="button" className="btn small icon-btn" aria-label="Longer" disabled={seconds >= WARMUP_SECONDS.max} onClick={() => setSeconds(seconds + 1)}>
            +
          </button>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {busy ? <p className="hint">{busy}</p> : null}
      <div className="actions-row">
        <button type="button" className="btn primary" disabled={!ready || !linkOk} onClick={() => void save()}>
          {start ? 'Save' : owner ? 'Add it' : 'Send it for OK'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}
