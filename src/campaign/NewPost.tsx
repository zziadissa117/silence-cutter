// New post, on the Posts screen: videos that are already finished, posted
// as they are for the campaign he picks, with no cutting and no approving.
// Pick one or a whole batch; Claude writes each caption from stills of that
// video (the hook written on screen, what it shows) as soon as it is added,
// for him to read and change. One goes straight away or at a time he picks;
// several are spread over the campaign's times, or all go now.
//
// A video that isn't an MP4 - a .mov from Photos - is put into one first:
// Postiz takes nothing else. Each then goes up through the same queue as
// every made video, so no signal or the app closing never loses it.

import { useEffect, useRef, useState } from 'react'

import { forgetCut } from '../media/outputSink'
import { VideoPicker } from '../VideoPicker'
import { pickArrived, pickSaved } from '../pickWatch'
import { filmingOf } from './filming'
import { formatTime } from './jobs'
import { NO_POSTING, type Campaign } from './look'
import { fingerprint, handPostKey, newOnes, skippedNotice } from './fingerprint'
import { fingerprintsFor, isQueued, queueSend } from './outbox'
import { PostingError, accountLabel, localInput, placeFor, timeLabel, whenLabel, writeCaptionFor, type Profile } from './posting'
import { stillsOf } from './stills'
import { asMp4 } from './toMp4'

const LAST_KEY = 'posts.newCampaign'
/** Captions written at once - enough to get a batch done quickly. */
const WRITING_AT_ONCE = 3

function lastCampaign(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

function keepCampaign(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    // Just won't be picked first next time.
  }
}

interface Picked {
  key: string
  file: File
  /** What is in the file (fingerprint.ts): the same recording is never added
   *  twice, and it is what makes its send key the same every time. */
  fp: string
  seconds?: number
  caption: string
  /** Who wrote what is in the box - his words are never replaced. */
  by: 'claude' | 'him' | null
  writing: boolean
  note: string | null
}

type When = 'now' | 'at' | 'spread'

let nextKey = 0

/** Today as YYYY-MM-DD on this phone. */
function localDay(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function NewPost({
  campaigns,
  profile,
  onDone,
  onCancel,
}: {
  campaigns: Campaign[]
  profile: Profile
  onDone: () => void
  onCancel: () => void
}) {
  // Only campaigns that post somewhere from this phone.
  const choices = campaigns.filter((c) => placeFor(profile, c.id).accounts.length > 0)
  const [campaignId, setCampaignId] = useState(() => {
    const last = lastCampaign()
    return choices.find((c) => c.id === last)?.id ?? choices[0]?.id ?? ''
  })
  const campaign = choices.find((c) => c.id === campaignId) ?? null
  const [items, setItems] = useState<Picked[]>([])
  const [about, setAbout] = useState('')
  const [when, setWhen] = useState<When>('now')
  const [at, setAt] = useState(() => localInput(null))
  const [sending, setSending] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  // Read by captions being written, so each uses what is there when it goes
  // - set the moment things change, not when the screen next draws.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const campaignRef = useRef(campaign)
  campaignRef.current = campaign
  const files = useRef(new Map<string, File>())
  const stillsFor = useRef(new Map<string, string[]>())
  const aboutRef = useRef(about)
  aboutRef.current = about
  const waiting = useRef<string[]>([])
  const active = useRef(0)
  /** Each ask gets a number; only the latest ask's caption is kept. */
  const tickets = useRef(new Map<string, number>())

  const change = (key: string, fields: Partial<Picked>) =>
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...fields } : i)))

  const writeOne = async (key: string) => {
    const ticket = tickets.current.get(key)
    const file = files.current.get(key)
    const owner = campaignRef.current
    if (!file || !owner) {
      change(key, { writing: false })
      return
    }
    let stills = stillsFor.current.get(key)
    if (!stills) {
      stills = await stillsOf(file)
      stillsFor.current.set(key, stills)
    }
    if (!alive.current) return
    let caption = ''
    let note: string | null = null
    try {
      const written = await writeCaptionFor({ id: owner.id, name: owner.name, posting: owner.posting ?? NO_POSTING }, aboutRef.current, stills)
      caption = written.caption
      if (!caption) note = written.error ?? "Claude didn't write one."
    } catch (error) {
      note = error instanceof PostingError ? error.message : String(error)
    }
    if (!alive.current || tickets.current.get(key) !== ticket) return
    setItems((current) =>
      current.map((i) =>
        i.key !== key
          ? i
          : i.by === 'him'
            ? { ...i, writing: false }
            : caption
              ? { ...i, caption, by: 'claude', writing: false, note: null }
              : { ...i, writing: false, note: `${note} Write it here, or leave it and Claude writes it as it goes up.` },
      ),
    )
  }

  const pump = () => {
    while (active.current < WRITING_AT_ONCE && waiting.current.length > 0) {
      const key = waiting.current.shift()!
      active.current++
      void writeOne(key).finally(() => {
        active.current--
        pump()
      })
    }
  }

  const write = (keys: string[]) => {
    for (const key of keys) {
      tickets.current.set(key, (tickets.current.get(key) ?? 0) + 1)
      if (!waiting.current.includes(key)) waiting.current.push(key)
    }
    setItems((current) => current.map((i) => (keys.includes(i.key) ? { ...i, writing: true, note: null } : i)))
    pump()
  }

  const posting = campaign?.posting ?? NO_POSTING
  const paste = posting.caption === 'paste'
  const times = campaign ? placeFor(profile, campaign.id).times : []
  const many = items.length > 1

  // Several at once spread over the campaign's times unless he says otherwise.
  const wasMany = useRef(false)
  useEffect(() => {
    if (many && !wasMany.current) setWhen(times.length > 0 ? 'spread' : 'now')
    if (!many && wasMany.current) setWhen('now')
    wasMany.current = many
  }, [many, times.length])

  if (!campaign) {
    return (
      <div className="chooser new-post">
        <div className="chooser-head">
          <span className="label">New post</span>
          <button type="button" className="linkbtn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p className="hint">No campaign posts anywhere yet. Pick its accounts first: Campaigns, open the campaign, then Posting.</p>
      </div>
    )
  }

  const accounts = placeFor(profile, campaign.id).accounts
    .map((id) => profile.accounts.find((a) => a.id === id))
    .filter((a) => a !== undefined)
  const whenChoices: { value: When; label: string }[] = many
    ? times.length > 0
      ? [
          { value: 'spread', label: 'Spread them' },
          { value: 'now', label: 'All now' },
        ]
      : [{ value: 'now', label: 'All now' }]
    : [
        { value: 'now', label: 'Post now' },
        { value: 'at', label: 'Pick a time' },
      ]
  const chosen: When = whenChoices.some((c) => c.value === when) ? when : whenChoices[0].value
  const atIso = chosen === 'at' && at ? new Date(at).toISOString() : null
  const gone = atIso !== null && Date.parse(atIso) <= Date.now() + 2 * 60_000
  const writingCount = items.filter((i) => i.writing).length
  const missingPaste = paste && items.some((i) => !i.caption.trim())
  const ready = items.length > 0 && writingCount === 0 && !missingPaste && sending === null

  const add = async (picked: File[]) => {
    const problemPicking = pickArrived(picked)
    if (problemPicking) {
      setProblem(problemPicking)
      return
    }
    // Never the same recording twice: not already in this post, not already in
    // line or sent for this campaign, and not repeated within the pick.
    const prints = await Promise.all(picked.map(async (file) => ({ file, name: file.name, fp: await fingerprint(file) })))
    if (!alive.current) return
    const known = new Set([...itemsRef.current.map((i) => i.fp), ...(await fingerprintsFor(campaignRef.current?.id ?? ''))])
    const { fresh, skipped } = newOnes(prints, known)
    setNotice(skippedNotice(skipped, 'in this post or already sent'))
    if (fresh.length === 0) {
      pickSaved()
      return
    }
    const added: Picked[] = fresh.map(({ file, fp }) => ({ key: `np-${nextKey++}`, file, fp, caption: '', by: null, writing: false, note: null }))
    for (const item of added) files.current.set(item.key, item.file)
    setItems((current) => [...current, ...added])
    setProblem(null)
    pickSaved()
    for (const item of added) {
      void filmingOf(item.file).then(({ seconds }) => alive.current && seconds !== undefined && change(item.key, { seconds }))
    }
    if (!paste) write(added.map((i) => i.key))
  }

  const pickCampaign = (id: string) => {
    setCampaignId(id)
    setProblem(null)
    // Claude's captions were for the other campaign: written again for this
    // one. His own stay.
    const next = choices.find((c) => c.id === id) ?? null
    campaignRef.current = next
    if (next && (next.posting ?? NO_POSTING).caption !== 'paste') {
      write(itemsRef.current.filter((i) => i.by !== 'him').map((i) => i.key))
    }
  }

  const post = async () => {
    if (!ready) return
    keepCampaign(campaign.id)
    setNotice(null)
    const list = [...items]
    const skipped: string[] = []
    for (const [n, item] of list.entries()) {
      const counting = list.length > 1 ? ` ${n + 1} of ${list.length}` : ''
      setSending(`Getting${counting} ready…`)
      try {
        // The same video for the same campaign on the same day is the same
        // post, so tapping again - or coming back to this screen and picking
        // it again - finds it already in line instead of making a second one.
        const key = handPostKey(item.fp, campaign.id, localDay())
        if (await isQueued(key)) {
          skipped.push(item.file.name)
          if (alive.current) setItems((current) => current.filter((i) => i.key !== item.key))
          continue
        }
        const mp4 = await asMp4(item.file, (p) => alive.current && setSending(`Making${counting} an MP4… ${Math.round(p * 100)}%`))
        const result = await queueSend(
          {
            key,
            fp: item.fp,
            profileId: profile.id,
            campaign: { id: campaign.id, name: campaign.name, posting },
            meta: {
              transcript: '',
              headline: '',
              duration: item.seconds ?? 0,
              fileName: mp4.file.name,
              byHand: {
                at: chosen === 'at' && !gone ? atIso : null,
                caption: item.caption.trim(),
                about: about.trim(),
                ...(chosen === 'spread' ? { spread: true } : {}),
              },
            },
          },
          mp4.file,
        )
        if (result === 'duplicate') skipped.push(item.file.name)
        // The send queue keeps its own copy.
        if (mp4.storedAs) void forgetCut(mp4.storedAs)
        if (alive.current) setItems((current) => current.filter((i) => i.key !== item.key))
      } catch (error) {
        if (!alive.current) return
        const why = error instanceof Error ? error.message : String(error)
        setProblem(`${item.file.name} couldn't be sent: ${why}${n > 0 ? ' The ones before it are on their way.' : ''}`)
        setSending(null)
        return
      }
    }
    if (!alive.current) return
    // Said, never silent: what was already sent is named, and the screen stays
    // so he sees it.
    const said = skippedNotice(skipped, 'sent or on its way')
    if (said) {
      setNotice(said)
      setSending(null)
      return
    }
    onDone()
  }

  const postLabel =
    sending ??
    (writingCount > 0
      ? `Claude is writing ${writingCount === 1 ? 'the caption' : `${writingCount} captions`}…`
      : many
        ? chosen === 'spread'
          ? `Post ${items.length} - spread out`
          : `Post all ${items.length} now`
        : chosen === 'at' && atIso && !gone
          ? `Post ${whenLabel(atIso)}`
          : 'Post now')

  return (
    <div className="chooser new-post">
      <div className="chooser-head">
        <span className="label">New post · finished videos</span>
        <button type="button" className="linkbtn" disabled={sending !== null} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <select aria-label="Campaign" value={campaign.id} disabled={sending !== null} onChange={(e) => pickCampaign(e.target.value)}>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <p className="hint new-post-to">To {accounts.map(accountLabel).join(', ')}</p>

      {paste ? null : (
        <input
          type="text"
          aria-label="Anything Claude should know"
          value={about}
          maxLength={2000}
          placeholder="Anything Claude should know? (optional)"
          onChange={(e) => setAbout(e.target.value)}
          onBlur={() => {
            // A note added after the captions were written: they are written
            // again with it. His own stay.
            const again = itemsRef.current.filter((i) => i.by === 'claude').map((i) => i.key)
            if (about.trim() && again.length > 0) write(again)
          }}
        />
      )}

      {items.length > 0 ? (
        <ol className="np-list" aria-label="Videos to post">
          {items.map((item) => (
            <li key={item.key} className="np-item">
              <div className="np-head">
                <span className="np-name">{item.file.name}</span>
                <span className="hint">{item.seconds !== undefined ? formatTime(item.seconds) : ''}</span>
                <button
                  type="button"
                  className="btn small icon-btn"
                  aria-label={`Take out ${item.file.name}`}
                  disabled={sending !== null}
                  onClick={() => setItems((current) => current.filter((i) => i.key !== item.key))}
                >
                  ✕
                </button>
              </div>
              <textarea
                className="post-caption"
                rows={3}
                value={item.caption}
                aria-label={`Caption for ${item.file.name}`}
                placeholder={
                  paste ? 'Paste the tracking caption' : item.writing ? 'Claude is writing it…' : 'Caption - or leave it empty and Claude writes it'
                }
                onChange={(e) => change(item.key, { caption: e.target.value, by: e.target.value.trim() ? 'him' : null })}
              />
              {item.note ? <span className="hint warn-text">{item.note}</span> : null}
              {!paste && !item.writing && sending === null ? (
                <button
                  type="button"
                  className="linkbtn np-again"
                  onClick={() => {
                    // Asked for by name, so it replaces even his own words.
                    change(item.key, { by: null })
                    write([item.key])
                  }}
                >
                  {item.caption.trim() ? 'Write it again with Claude' : 'Write it with Claude'}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      <VideoPicker
        className={items.length > 0 ? 'btn add-more' : 'btn add-more primary'}
        label={items.length > 0 ? 'Add more videos' : 'Choose the videos'}
        onFiles={add}
      >
        {items.length > 0 ? '+ Add more videos' : '+ Choose the videos'}
      </VideoPicker>

      {items.length > 0 ? (
        <>
          <div className="seg full" role="radiogroup" aria-label="When they post">
            {whenChoices.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={chosen === o.value}
                className={chosen === o.value ? 'active' : ''}
                onClick={() => setWhen(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {chosen === 'at' ? (
            <label className="field">
              <span className="label">Posts at</span>
              <input type="datetime-local" aria-label="Posts at" value={at} onChange={(e) => setAt(e.target.value)} />
              {gone ? <span className="hint warn-text">That time has gone - it would go straight away.</span> : null}
            </label>
          ) : null}
          {many ? (
            <p className="hint new-post-to">
              {chosen === 'spread'
                ? `On ${campaign.name}'s times (${times.map(timeLabel).join(', ')}), and once those have gone, spread evenly to midnight - like videos made late.`
                : times.length > 0
                  ? 'All of them go out at once.'
                  : `${campaign.name} has no posting times, so they all go at once. Add times in its Posting to spread them.`}
            </p>
          ) : null}
        </>
      ) : null}

      {problem ? <p className="error">{problem}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <button type="button" className="btn primary" disabled={!ready} onClick={() => void post()}>
        {postLabel}
      </button>
      <p className="hint new-post-to">
        {sending !== null
          ? 'Keep the app open until they are on their way.'
          : missingPaste
            ? 'Paste each caption first.'
            : 'No approving - they go up as soon as there is signal, and show below on their way.'}
      </p>
    </div>
  )
}
