// Trial reels (More, for the logins allowed them - his and the ones he turned
// on in People): the Trial loop (trialLoop.ts). He picks a viral reel and its
// clean clip - both at once - and taps Start; the app finds where the reel
// starts, takes its sound, has Claude read its words from one still, and
// makes so many a day of it with the words moved or a word changed, each an
// Instagram Trial Reel, never shown to his followers. The number a day
// changes everything ahead at once; Stop on a reel takes its videos not out
// yet back out, Stop everything all of them.
//
// "Easy to start, modify and cancel ... if I want to start it, it takes 2
// seconds" (2026-11-04).

import { useEffect, useMemo, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { todayHere } from './batch'
import { startOver, takeOutHook, withPerDay } from './batchRun'
import { filmingOf } from './filming'
import { fingerprint } from './fingerprint'
import type { Job } from './jobs'
import type { Campaign } from './look'
import { BackToMore } from './MoreView'
import { listPosts, placeFor, postAction, readViralReel, rewordTrial, whenLabel, type LocalPosting, type ServerPost } from './posting'
import { Watch } from './PostsView'
import { BATCH_BANK_SAVED, loadBankFile, loadBatchBank, retireBankFiles, saveBankFile, saveBatchBank } from './store'
import { measureSong } from './songLength'
import {
  FIRST_PER_DAY,
  NOT_ALLOWED,
  REWORD_CHECK,
  activeSources,
  sameWords,
  withCheckedWords,
  instagramLimit,
  newTrialBank,
  notAllowedOn,
  sourceId,
  trialDays,
  trialFileName,
  viralOf,
  withSource,
  withoutSource,
  type TrialRead,
  type TrialSource,
} from './trialLoop'
import { takeApart } from './viralReel'
import type { BankFile, BatchBank } from './batch'

/** As the server's batch.ts BATCH_TRUST: his 3rd yes on copies of one
 *  viral reel lets every copy of it after go by itself. */
const TRUST = 3

/** One trial video: its words, its time, and - while it isn't out - watch,
 *  approve or take it out. */
function TrialPost({ post, onChanged }: { post: ServerPost; onChanged: (post: ServerPost, message?: string) => void }) {
  const [watching, setWatching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const waiting = post.status === 'waiting'
  const out = post.status === 'posted'
  const act = async (action: 'approve' | 'reject' | 'unschedule') => {
    setBusy(true)
    setProblem(null)
    try {
      const next = await postAction(action, post.id, action === 'reject' ? { disliked: true } : {})
      onChanged(next, next.alsoApproved ? `Approved - and the ${next.alsoApproved} other copies of this reel waiting go by themselves.` : undefined)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const link = Object.values(post.links ?? {})[0]
  return (
    <li className="post trial-post">
      <div className="post-head">
        <span className={`dot ${waiting ? 'now' : out ? 'ok' : post.status === 'error' ? 'bad' : 'later'}`} aria-hidden />
        <span className="post-title">{waiting ? 'Waiting for you' : out ? 'Out' : post.status === 'error' ? 'Instagram turned it down' : 'Going out'}</span>
        <span className="post-when">{whenLabel(post.postAt)}</span>
      </div>
      <div className="post-line wrap trial-words">{post.headline}</div>
      {post.error ? <div className="hint warn-text">{post.error}</div> : null}
      {watching ? <Watch post={post} /> : null}
      {problem ? <p className="hint warn-text">{problem}</p> : null}
      <div className="post-actions">
        {waiting ? (
          <button type="button" className="btn small primary" disabled={busy} onClick={() => void act('approve')}>
            {busy ? 'Sending…' : 'Approve'}
          </button>
        ) : null}
        <button type="button" className="linkbtn" onClick={() => setWatching((w) => !w)}>
          {watching ? 'Hide video' : 'Watch'}
        </button>
        {out && link ? (
          <a className="linkbtn" href={link} target="_blank" rel="noreferrer">
            On Instagram
          </a>
        ) : null}
        {!out && post.status !== 'error' ? (
          <button
            type="button"
            className="linkbtn danger"
            disabled={busy}
            onClick={() =>
              window.confirm(waiting ? 'Reject this copy? Another is made in its place.' : 'Take this one out? It won\'t be posted.') &&
              void act(waiting ? 'reject' : 'unschedule')
            }
          >
            {waiting ? 'Reject' : 'Take out'}
          </button>
        ) : null}
      </div>
    </li>
  )
}

/** Every trial video, by where it is: being made, waiting for his yes, going
 *  out at its time, out. */
function TrialVideos({
  posts,
  campaignId,
  jobs,
  onChanged,
}: {
  posts: ServerPost[]
  campaignId: string
  jobs: Job[]
  onChanged: (post: ServerPost, message?: string) => void
}) {
  const [showOut, setShowOut] = useState(false)
  const mine = posts.filter((p) => p.campaignId === campaignId && p.batch?.trial && p.status !== 'rejected' && p.status !== 'failed')
  const byTime = (a: ServerPost, b: ServerPost) => (a.postAt ?? '').localeCompare(b.postAt ?? '')
  const waiting = mine.filter((p) => p.status === 'waiting').sort(byTime)
  const going = mine.filter((p) => p.status !== 'waiting' && p.status !== 'posted').sort(byTime)
  const out = mine.filter((p) => p.status === 'posted').sort((a, b) => byTime(b, a))
  const making = jobs.filter((j) => j.campaignId === campaignId && j.batch?.trial && j.status !== 'done' && j.status !== 'failed')
  const working = making.find((j) => j.status === 'working')
  return (
    <>
      <div className="list-title">The videos</div>
      <div className="card-group">
        {making.length > 0 ? (
          <div className="setting">
            <div className="setting-text">
              <span className="row-name">Being made: {making.length}</span>
              <span className="row-line">
                {working ? `Now ${Math.round((working.progress ?? 0) * 100)}% - ` : ''}keep the app open; each then waits here for you.
              </span>
            </div>
          </div>
        ) : null}
        {mine.length === 0 && making.length === 0 ? (
          <p className="hint">None yet - they are made as soon as the app is open, and show up here.</p>
        ) : null}
      </div>
      {waiting.length > 0 ? (
        <>
          <div className="list-title">To approve · {waiting.length}</div>
          <p className="hint">Watch a few: once you approve {TRUST} copies of a reel, every copy of it after goes by itself.</p>
          <ul className="posts">
            {waiting.map((p) => (
              <TrialPost key={p.id} post={p} onChanged={onChanged} />
            ))}
          </ul>
        </>
      ) : null}
      {going.length > 0 ? (
        <>
          <div className="list-title">Going out · {going.length}</div>
          <ul className="posts">
            {going.map((p) => (
              <TrialPost key={p.id} post={p} onChanged={onChanged} />
            ))}
          </ul>
        </>
      ) : null}
      {out.length > 0 ? (
        <>
          <button type="button" className="list-title linkbtn" onClick={() => setShowOut((s) => !s)}>
            Out · {out.length} {showOut ? '▾' : '▸'}
          </button>
          {showOut ? (
            <ul className="posts">
              {out.slice(0, 20).map((p) => (
                <TrialPost key={p.id} post={p} onChanged={onChanged} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </>
  )
}

const isInstagram = (platform: string) => platform === 'instagram' || platform === 'instagram-standalone'

async function hasSound(file: File): Promise<boolean> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    return (await input.getPrimaryAudioTrack()) !== null
  } catch {
    return false
  } finally {
    input.dispose()
  }
}

async function keep(file: File): Promise<BankFile> {
  const id = crypto.randomUUID()
  const fp = await fingerprint(file)
  await saveBankFile(id, file)
  const isVideo = file.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(file.name)
  const seconds = isVideo ? (await filmingOf(file).catch(() => null))?.seconds : undefined
  return {
    id,
    name: file.name,
    type: file.type || (isVideo ? 'video/mp4' : 'audio/mp4'),
    size: file.size,
    fp,
    ...(seconds ? { seconds } : {}),
  }
}

export function TrialView({
  campaigns,
  posting,
  jobs,
  onBack,
  onCreate,
  onRun,
  removeJob,
}: {
  campaigns: Campaign[]
  posting: LocalPosting | null
  jobs: Job[]
  onBack: () => void
  /** Makes the Trial reels campaign, posting to this Instagram account. */
  onCreate: (accountId: string) => Promise<Campaign>
  /** Runs the loops now: tops up or trims to the number a day. */
  onRun: () => void
  removeJob: (id: string) => void
}) {
  const profile = posting?.profile ?? null
  const campaign = campaigns.find((c) => c.trial) ?? null
  const accounts = (profile?.accounts ?? []).filter((a) => isInstagram(a.platform) && !a.disabled)
  const place = profile && campaign ? placeFor(profile, campaign.id) : null
  const [bank, setBank] = useState<BatchBank | null>(null)
  const [posts, setPosts] = useState<ServerPost[]>([])
  const [account, setAccount] = useState('')
  const [picked, setPicked] = useState<File[] | null>(null)
  const [viralName, setViralName] = useState<string | null>(null)
  const [hook, setHook] = useState('')
  const [askHook, setAskHook] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [perDayDraft, setPerDayDraft] = useState<string | null>(null)

  // The loop's bank, as it is saved - by this screen, the top-ups or the server's progress.
  useEffect(() => {
    if (!campaign) return
    let alive = true
    const read = () => void loadBatchBank(campaign.id).then((b) => alive && setBank(b))
    read()
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<string>).detail === campaign.id) read()
    }
    window.addEventListener(BATCH_BANK_SAVED, onSaved)
    return () => {
      alive = false
      window.removeEventListener(BATCH_BANK_SAVED, onSaved)
    }
  }, [campaign?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Its posts, for today's numbers and what Instagram turned down.
  useEffect(() => {
    if (!campaign || !profile) return
    let alive = true
    const read = () => void listPosts().then((p) => alive && setPosts(p)).catch(() => {})
    read()
    const timer = window.setInterval(read, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [campaign?.id, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reels started before their rewordings were checked: checked now, once -
  // a wording that doesn't sound right ("the most starving I've ever been")
  // replaced, and its copies not out yet taken out, made again by the loop.
  const checking = useRef(false)
  const tried = useRef(new Set<string>())
  useEffect(() => {
    if (!campaign || !bank || checking.current) return
    const due = activeSources(bank).filter((s) => (s.read.checked ?? 0) < REWORD_CHECK && s.read.rewordings.length > 0 && !tried.current.has(s.id))
    if (due.length === 0) return
    checking.current = true
    void (async () => {
      let current = bank
      let taken = 0
      for (const source of due) {
        tried.current.add(source.id)
        try {
          const answer = await rewordTrial(source.read.text, source.read.rewordings)
          const { bank: next, dropped } = withCheckedWords(current, source.id, answer.rewordings, answer.checked)
          const out =
            dropped.length === 0
              ? null
              : await takeOutHook({
                  bank: current,
                  campaignId: campaign.id,
                  jobs,
                  matches: ({ post, job }) =>
                    job
                      ? job.montage?.bank?.trial?.sourceId === source.id && dropped.some((d) => sameWords(d, job.headlineText))
                      : Boolean(post?.batch?.trial && dropped.some((d) => sameWords(d, post.headline))),
                  change: () => next,
                  removeJob,
                  save: saveBatchBank,
                })
          current = out?.bank ?? next
          taken += out?.taken ?? 0
          if (!out) await saveBatchBank(current)
        } catch {
          // Checked again next time the screen opens.
        }
      }
      setBank(current)
      checking.current = false
      if (taken > 0) {
        setSaid(`${taken} cop${taken === 1 ? 'y' : 'ies'} with a wording that didn't sound right ${taken === 1 ? 'was' : 'were'} taken out - new ones are made with better words.`)
        onRun()
      }
    })()
  }, [bank, campaign?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // A reel whose sound came out shorter than its clip (its start found too
  // far in, before 2026-11-06): said, so he starts it again.
  const [short, setShort] = useState<Record<string, number>>({})
  const sourceKey = bank ? activeSources(bank).map((s) => s.id).join(',') : ''
  useEffect(() => {
    if (!bank) return
    let alive = true
    void (async () => {
      const out: Record<string, number> = {}
      for (const s of activeSources(bank)) {
        const clip = bank.reactions.find((f) => f.id === s.clip)
        const sound = s.sound ? bank.music.find((f) => f.id === s.sound) : null
        if (!clip || !sound) continue
        const [clipFile, soundFile] = await Promise.all([loadBankFile(clip).catch(() => null), loadBankFile(sound).catch(() => null)])
        const [clipSec, soundSec] = await Promise.all([clipFile ? measureSong(clipFile) : null, soundFile ? measureSong(soundFile) : null])
        if (clipSec && soundSec && clipSec - soundSec > 1) out[s.id] = Math.round(clipSec - soundSec)
      }
      if (alive) setShort(out)
    })()
    return () => {
      alive = false
    }
  }, [sourceKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayHere()
  const days = useMemo(() => (campaign ? trialDays(posts, campaign.id, today) : null), [posts, campaign, today])
  const sources = bank ? activeSources(bank) : []
  const loopAccounts = place?.accounts ?? []
  const limit = instagramLimit(profile?.settings.trial, loopAccounts)
  const blocked = notAllowedOn(profile?.settings.trial, loopAccounts)
  const accountNames = loopAccounts.map((id) => profile?.accounts.find((a) => a.id === id)?.name ?? 'your account').join(', ')
  const making = jobs.filter((j) => campaign && j.campaignId === campaign.id && j.batch?.trial).length

  const save = async (next: BatchBank) => {
    await saveBatchBank(next)
    setBank(next)
  }

  /** Both picked at once: the one with sound went viral. */
  const pick = async (files: File[]) => {
    setProblem(null)
    setSaid(null)
    setAskHook(false)
    setHook('')
    const videos = files.slice(0, 2)
    if (videos.length < 2) {
      setPicked(videos)
      setViralName(null)
      return
    }
    setPicked(videos)
    const told = viralOf(await Promise.all(videos.map(async (file) => ({ file, sound: await hasSound(file) }))))
    setViralName(told ? told.viral.name : null)
  }

  const addMore = (files: File[]) => void pick([...(picked ?? []), ...files])

  const start = async () => {
    if (!profile || !picked || picked.length !== 2) return
    const viral = picked.find((f) => f.name === viralName)
    const clean = picked.find((f) => f !== viral)
    if (!viral || !clean) return
    setProblem(null)
    setSaid(null)
    try {
      // The Trial reels campaign, the first time: his Instagram account.
      let owner = campaign
      if (!owner) {
        const to = account || (accounts.length === 1 ? accounts[0].id : '')
        if (!to) {
          setProblem('Pick the Instagram account the trial reels go to.')
          return
        }
        setBusy('Setting up Trial reels…')
        owner = await onCreate(to)
      }
      const parts = await takeApart(viral, clean, setBusy)
      if (!parts.still && !hook.trim()) {
        setAskHook(true)
        setProblem("The reel's picture couldn't be read on this phone. Type the hook and tap Start again.")
        return
      }
      setBusy('Claude is reading its words…')
      const { read, error } = await readViralReel(parts.still, hook.trim())
      if (!read || !read.text) {
        setAskHook(true)
        setProblem(error ?? "Claude couldn't read its words. Type the hook and tap Start again.")
        return
      }
      setBusy('Keeping the clip and the sound on this phone…')
      const clip = await keep(clean)
      const sound = parts.sound ? await keep(parts.sound) : null
      const source: TrialSource = {
        id: sourceId(),
        name: viral.name,
        clip: clip.id,
        sound: sound?.id ?? null,
        read: read as TrialRead,
        addedAt: Date.now(),
      }
      const current = (await loadBatchBank(owner.id)) ?? newTrialBank(owner.id, owner.angles[0].id)
      await save(withSource(current.layout === 'trial' ? current : newTrialBank(owner.id, owner.angles[0].id, current.perDay), source, clip, sound))
      setPicked(null)
      setViralName(null)
      setHook('')
      setAskHook(false)
      setSaid(
        `Started: "${read.text}"${read.rewordings.length > 0 ? ` and ${read.rewordings.length} rewordings` : ''}${parts.start > 0.05 ? ` - the reel starts ${parts.start.toFixed(1)} s in, the sound is taken from there` : ''}${parts.sound ? '' : ' - it had no sound, so the videos have none'}.`,
      )
      onRun()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const setPerDay = async (n: number) => {
    if (!bank) return
    const next = withPerDay(bank, Math.max(0, Math.min(48, Math.round(n))), today)
    await save(next)
    setPerDayDraft(null)
    onRun()
  }

  /** One viral reel stopped: its videos not out yet come out, the rest go on. */
  const stopSource = async (source: TrialSource) => {
    if (!bank || !campaign) return
    if (!window.confirm(`Stop "${source.read.text}"? Its videos not out yet are taken out.`)) return
    setBusy('Stopping it…')
    setProblem(null)
    try {
      const clip = bank.reactions.find((f) => f.id === source.clip)
      const fileName = clip ? trialFileName(clip) : null
      let retire: string[] = []
      const out = await takeOutHook({
        bank,
        campaignId: campaign.id,
        jobs,
        matches: ({ post, job }) => (job ? job.montage?.bank?.trial?.sourceId === source.id : Boolean(fileName && post?.fileName === fileName)),
        change: (b) => {
          const gone = withoutSource(b, source.id)
          retire = gone.retire
          return gone.bank
        },
        removeJob,
        save: saveBatchBank,
      })
      setBank(out.bank)
      if (retire.length > 0) await retireBankFiles(retire)
      setSaid(`Stopped: ${out.taken} video${out.taken === 1 ? '' : 's'} taken out${out.failed > 0 ? `, ${out.failed} couldn't be (${out.reason ?? 'already going out'})` : ''}.`)
      onRun()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  /** Everything stopped: every video not out yet comes out. */
  const stopAll = async () => {
    if (!bank || !campaign) return
    if (!window.confirm('Stop every Trial loop? Every video not out yet is taken out.')) return
    setBusy('Stopping everything…')
    setProblem(null)
    try {
      const out = await startOver({ bank, campaignId: campaign.id, jobs, removeJob, save: saveBatchBank })
      const retire = out.bank.trial?.sources.flatMap((s) => [s.clip, ...(s.sound ? [s.sound] : [])]) ?? []
      const next = { ...out.bank, reactions: [], music: [], trial: { sources: [] }, made: [], running: false }
      await save(next)
      if (retire.length > 0) await retireBankFiles(retire)
      setSaid(`Stopped: ${out.taken} video${out.taken === 1 ? '' : 's'} taken out${out.failed > 0 ? `, ${out.failed} couldn't be (${out.reason ?? 'already going out'})` : ''}.`)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (!profile) {
    return (
      <section className="screen trial">
        <BackToMore onBack={onBack} />
        <div className="screen-head">
          <h1>Trial reels</h1>
        </div>
        <p className="lede">Set up posting first (Settings, Posting): the trial reels go out through your Postiz.</p>
      </section>
    )
  }

  const perDay = bank?.perDay ?? FIRST_PER_DAY
  const ready = picked?.length === 2 && viralName !== null
  const needsAccount = !campaign && accounts.length > 1

  return (
    <section className="screen trial">
      <BackToMore onBack={onBack} />
      <div className="screen-head">
        <h1>Trial reels</h1>
      </div>
      <p className="lede tip">
        A reel that went viral, made again and again - its words moved or a word changed - and posted as Instagram Trial Reels: shown to people
        who don&rsquo;t follow you, never to your followers.
      </p>

      {campaign && bank && sources.length > 0 ? (
        <div className="card-group">
          <div className="setting">
            <div className="setting-text">
              <span className="row-name">{bank.running ? `On · ${limit !== null ? Math.min(limit, perDay) : perDay} copies a day` : 'Stopped'}</span>
              <span className="row-line wrap">
                Each copy is your clean clip with the reel&rsquo;s sound and its words - moved, or a word changed, a touch brighter or darker.
                They&rsquo;re made a few days ahead and spread around the clock; the first {TRUST} of each reel wait below for your OK.
              </span>
              <span className="row-line">
                On {accountNames || 'your account'}
                {days ? ` · today ${days.outToday} out, ${days.toGoToday} to go · ${days.ahead} ready for the next days` : ''}
                {making > 0 ? ` · ${making} being made` : ''}
              </span>
              {limit !== null && limit < perDay ? (
                <span className="row-line">Instagram takes {limit} trial reels a day on this account, so that&rsquo;s the most made.</span>
              ) : null}
              {blocked.length > 0 || bank.runProblem === NOT_ALLOWED ? <span className="row-line warn-text">{NOT_ALLOWED}</span> : null}
              {bank.runProblem && bank.runProblem !== NOT_ALLOWED ? <span className="row-line warn-text">{bank.runProblem}</span> : null}
            </div>
          </div>
          <div className="setting">
            <div className="setting-text">
              <span className="row-name">Videos a day</span>
              <span className="row-line">Changes every day ahead at once - fewer takes the extra out.</span>
            </div>
            <div className="trial-perday">
              <button type="button" className="btn small" aria-label="Fewer a day" disabled={busy !== null || perDay <= 0} onClick={() => void setPerDay(perDay - 5)}>
                −5
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={48}
                aria-label="Videos a day"
                value={perDayDraft ?? String(perDay)}
                onChange={(e) => setPerDayDraft(e.target.value)}
                onBlur={() => perDayDraft !== null && void setPerDay(Number(perDayDraft) || 0)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <button type="button" className="btn small" aria-label="More a day" disabled={busy !== null || perDay >= 48} onClick={() => void setPerDay(perDay + 5)}>
                +5
              </button>
            </div>
          </div>
          {sources.map((s) => (
            <div key={s.id} className="setting">
              <div className="setting-text">
                <span className="row-name wrap">&ldquo;{s.read.text}&rdquo;</span>
                <span className="row-line">
                  {s.name} · {bank.used[s.id] ?? 0} made · {s.read.rewordings.length} rewordings
                </span>
                {short[s.id] ? (
                  <span className="row-line warn-text wrap">
                    Its sound is {short[s.id]} s shorter than the clip - the start was found too late. Stop it and start it again with the same two videos.
                  </span>
                ) : null}
              </div>
              <button type="button" className="btn small" disabled={busy !== null} onClick={() => void stopSource(s)}>
                Stop
              </button>
            </div>
          ))}
          <div className="setting">
            <div className="setting-text">
              <span className="row-line">Stop every loop and take out every video not out yet.</span>
            </div>
            <button type="button" className="linkbtn danger" disabled={busy !== null} onClick={() => void stopAll()}>
              Stop everything
            </button>
          </div>
          {days && days.refused.length > 0 ? (
            <div className="setting">
              <div className="setting-text">
                <span className="row-name">Instagram turned down</span>
                {days.refused.map((r) => (
                  <span key={r} className="row-line warn-text wrap">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {campaign && (sources.length > 0 || posts.some((p) => p.campaignId === campaign.id)) ? (
        <TrialVideos
          posts={posts}
          campaignId={campaign.id}
          jobs={jobs}
          onChanged={(post, message) => {
            setPosts((list) => list.map((p) => (p.id === post.id ? post : p)))
            if (message) setSaid(message)
            // His 3rd yes approved others too: read them again.
            void listPosts().then(setPosts).catch(() => {})
          }}
        />
      ) : null}

      <div className="list-title">{sources.length > 0 ? 'Another viral reel' : 'Start a Trial loop'}</div>
      <div className="card-group">
        <div className="setting">
          <div className="setting-text">
            <span className="row-line wrap">
              Pick both at once: the viral reel (saved, or a screen recording) and the same video with no text and no sound.
            </span>
            {picked && picked.length > 0 ? (
              <span className="row-line wrap">
                {picked.map((f) => f.name).join(' + ')}
                {picked.length === 1 ? ' - now pick the other one.' : ''}
              </span>
            ) : null}
          </div>
          <VideoPicker className="btn small primary" label="Pick the viral reel and its clean clip" onFiles={(files) => (picked?.length === 1 ? addMore(files) : void pick(files))}>
            {picked && picked.length > 0 ? 'Pick again' : 'Pick videos'}
          </VideoPicker>
        </div>
        {picked?.length === 2 ? (
          <div className="setting">
            <div className="setting-text">
              <span className="row-line">Which one went viral?</span>
              <div className="trial-which">
                {picked.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    className={`btn small${viralName === f.name ? ' primary' : ''}`}
                    aria-pressed={viralName === f.name}
                    onClick={() => setViralName(f.name)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {needsAccount ? (
          <div className="setting">
            <div className="setting-text">
              <span className="row-line">The Instagram account they go to</span>
              <select value={account} aria-label="Instagram account" onChange={(e) => setAccount(e.target.value)}>
                <option value="">Pick one</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
        {!campaign && accounts.length === 0 ? (
          <p className="hint warn-text">No Instagram account in your Postiz yet: connect one there, then come back.</p>
        ) : null}
        {askHook ? (
          <div className="setting">
            <div className="setting-text">
              <span className="row-line">The hook, as it is on the reel</span>
              <input type="text" value={hook} aria-label="The hook" placeholder="e.g. POV: you found the hack" onChange={(e) => setHook(e.target.value)} />
            </div>
          </div>
        ) : null}
        <div className="setting">
          <div className="setting-text">
            {busy ? <span className="row-line">{busy}</span> : null}
            {problem ? <span className="row-line warn-text wrap">{problem}</span> : null}
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || busy !== null || (needsAccount && !account) || (!campaign && accounts.length === 0) || (askHook && !hook.trim())}
            onClick={() => void start()}
          >
            Start
          </button>
        </div>
      </div>
      {said ? <p className="notice">{said}</p> : null}
    </section>
  )
}
