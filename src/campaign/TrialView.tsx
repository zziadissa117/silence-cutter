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

import { useEffect, useMemo, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { todayHere } from './batch'
import { startOver, takeOutHook, withPerDay } from './batchRun'
import { filmingOf } from './filming'
import { fingerprint } from './fingerprint'
import type { Job } from './jobs'
import type { Campaign } from './look'
import { BackToMore } from './MoreView'
import { listPosts, placeFor, readViralReel, type LocalPosting, type ServerPost } from './posting'
import { BATCH_BANK_SAVED, loadBatchBank, retireBankFiles, saveBankFile, saveBatchBank } from './store'
import {
  FIRST_PER_DAY,
  NOT_ALLOWED,
  activeSources,
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
              <span className="row-name">{bank.running ? `Making ${limit !== null ? Math.min(limit, perDay) : perDay} a day` : 'Stopped'}</span>
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
