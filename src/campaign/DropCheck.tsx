// His check of a talking head format's edited clips, one by one (his report,
// 2026-11-13: "Make sure you point out to me every single video and add a way
// to check with me if that video goes in the right place" and "The captions
// must be editable. And claude must check them EXACTLY like the cutter
// already does: Meaning I should also be able to approve, edit captions and
// choose the style").
//
// Each clip is the Cutter's own caption check (CaptionReview.tsx) - the clip
// playing with its captions, Claude reading them by itself, every phrase to
// retype, the caption style and size - with where it goes above the video:
// the step it was put in (marked when it wasn't sure), any other step, his
// hooks, or Leave out. Approve puts it in the batch with its captions; only
// then do videos use it (dropQueue.ts).
//
// Clips already in the batch are looked at here again the same way (his ask,
// 2026-11-14: "recheck if everything is in the right place"): each where it
// is, the step its words sound like pointed out when that is another one;
// Approve keeps it there or moves it, Take out takes it out of the batch.

import { useEffect, useState } from 'react'

import { batchCaptionLook, type BankFile, type BatchBank, type BatchFormat, type BatchStep } from './batch'
import { CaptionReview } from './CaptionReview'
import { defaultCaptionPosition, defaultCaptionSize, defaultCaptionStyle, type CaptionWord } from './captions'
import { checkOrder, fileIn, HOOK, loadQueue, placed, placeOf, saveQueue, soundsElsewhere, type ToCheck } from './dropQueue'
import type { Campaign } from './look'
import { ChevronLeft } from './icons'
import { postingHere, recheckCaptions } from './posting'
import { dropSettings } from './prepareDrop'
import { learned } from './stepMatch'
import { loadBankFile, retireBankFiles, saveBankFile } from './store'
import { talkWords } from './talkCaptions'
import { downloadFile } from './talkLink'

/** Left out of the batch. */
const OUT = 'out'

/** Clips being heard now, so one is never heard twice at once. */
const hearing = new Map<string, Promise<CaptionWord[] | null>>()

/** What he says in a clip of the batch never heard: heard once, kept with
 *  the clip's words (talkCaptions), null when it can't be. */
function hear(file: BankFile, blob: Blob, names: string[]): Promise<CaptionWord[] | null> {
  const going = hearing.get(file.id)
  if (going) return going
  const words = talkWords(file, blob, { settings: dropSettings().settings, names })
    .catch(() => null)
    .finally(() => hearing.delete(file.id))
  hearing.set(file.id, words)
  return words
}

/** His "no punctuation" captions setting (CampaignApp's). */
function bareCaptions(): boolean {
  try {
    return localStorage.getItem('campaign.bareCaptions') === 'true'
  } catch {
    return false
  }
}

export function DropCheck({
  format,
  steps,
  campaign,
  getBank,
  keep,
  onFormat,
  onClose,
}: {
  format: BatchFormat
  /** This format's product steps. */
  steps: BatchStep[]
  campaign: Campaign
  getBank: () => BatchBank | null
  keep: (bank: BatchBank) => void
  /** The format's caption look, picked here for every video of it. */
  onFormat: (patch: Partial<BatchFormat>) => void
  onClose: () => void
}) {
  /** The queue, without clips looked at again that are out of the batch by now. */
  const live = () => {
    const bank = getBank()
    const list = loadQueue(format.id)
    return bank ? list.filter((q) => !q.recheck || placeOf(bank, q.file.id) !== null) : list
  }
  const [queue, setQueue] = useState<ToCheck[]>(() => checkOrder(live()))
  const [done, setDone] = useState(0)
  const item = queue[0] ?? null
  const [place, setPlace] = useState<string | null>(item?.place ?? null)
  const [pickFirst, setPickFirst] = useState(false)
  const [file, setFile] = useState<Blob | null>(null)
  const [missing, setMissing] = useState(false)
  /** A clip whose words were never heard: heard here first ('failed': it
   *  couldn't be - it is checked without touching its captions). */
  const [heard, setHeard] = useState<CaptionWord[] | 'failed' | null>(null)
  const [hint, setHint] = useState<string | null>(item?.hint ?? null)

  // The ones out of the batch by now are out of the check for good.
  useEffect(() => {
    if (queue.length !== loadQueue(format.id).length) saveQueue(format.id, queue)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The clip itself: on the phone, or fetched from the Cutter server when
  // its copy hasn't come down yet - and heard, when it never was.
  useEffect(() => {
    if (!item) return
    let alive = true
    setFile(null)
    setMissing(false)
    setPlace(item.place)
    setPickFirst(false)
    setHeard(null)
    setHint(item.hint ?? null)
    document.querySelector('.drop-check-screen')?.scrollTo?.({ top: 0 })
    void (async () => {
      let blob: Blob | null = await loadBankFile(item.file).catch(() => null)
      if (!blob) {
        blob = await downloadFile(item.file.id).catch(() => null)
        if (blob) await saveBankFile(item.file.id, blob).catch(() => {})
      }
      if (!alive) return
      if (blob) setFile(blob)
      else setMissing(true)
      if (item.unheard) {
        const words = blob ? await hear(item.file, blob, campaign.brandWords ?? []) : null
        if (!alive) return
        setHeard(words ?? 'failed')
        if (words && item.place) setHint(soundsElsewhere(words.map((w) => w.text).join(' '), steps, item.place))
      }
      // The next one heard while he looks at this one: no wait on it.
      const after = queue[1]
      if (alive && after?.unheard) {
        const next = await loadBankFile(after.file).catch(() => null)
        if (next) void hear(after.file, next, campaign.brandWords ?? [])
      }
    })()
    return () => {
      alive = false
    }
  }, [item?.file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!item) onClose()
  }, [item]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null

  /** Done with this clip: out of the check, on to the next. */
  const next = () => {
    // Read again: clips the server finished meanwhile come into the check too.
    const rest = loadQueue(format.id).filter((q) => q.file.id !== item.file.id)
    saveQueue(format.id, rest)
    setDone((n) => n + 1)
    setQueue(checkOrder(rest))
  }

  const listening = Boolean(item.unheard) && heard === null
  /** What he says in it: as it came, or heard here. */
  const said = item.unheard ? (Array.isArray(heard) ? heard : []) : item.words
  const text = item.unheard ? said.map((w) => w.text).join(' ') : item.text

  /** Approved: in the batch where he says, with its captions as he left them. */
  const approve = (words: CaptionWord[]) => {
    if (listening) return
    if (place === null) {
      setPickFirst(true)
      document.querySelector('.drop-check-screen')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const bank = getBank()
    if (!bank) return
    // Looked at again: the clip as it is in the batch now.
    const now = item.recheck ? fileIn(bank, item.file.id) : item.file
    if (!now) return next()
    if (place === OUT) {
      if (item.recheck) keep(placed(bank, format.id, now, null))
      void retireBankFiles([item.file.id]).catch(() => {})
      next()
      return
    }
    // Its captions left as they were when it couldn't be heard.
    const captions = heard === 'failed' ? {} : { captions: words }
    const clip = { ...now, ...(item.recheck ? {} : { edited: true }), ...captions, checked: true }
    let after = placed(bank, format.id, clip, place, item.replaces)
    // Its step learns how he says it, for the next drop-in.
    if (place !== HOOK && text) {
      after = { ...after, steps: (after.steps ?? []).map((st) => (st.id === place ? { ...st, heard: learned(st.heard, text) } : st)) }
    }
    keep(after)
    if (item.replaces) void retireBankFiles([item.replaces]).catch(() => {})
    next()
  }

  // Full phrases unless he picked another look for this format.
  const look = batchCaptionLook(format, null, { style: defaultCaptionStyle(), size: defaultCaptionSize() })
  const total = done + queue.length
  // Kept short: it stays on screen with the video while he reads the captions.
  const where = (
    <div className={`drop-check-place${place === null || pickFirst ? ' unsure' : ''}${place === OUT ? ' out' : ''}`}>
      <div className="drop-check-line">
        <span className="row-name">
          Clip {done + 1} of {total}
        </span>
        {(!item.sure || hint) && place === item.place && place !== null ? (
          <span className="drop-check-unsure">{hint ? 'Maybe the wrong step' : 'Not sure - check it'}</span>
        ) : null}
        <button type="button" className={`linkbtn drop-check-out${place === OUT ? ' active' : ''}`} aria-pressed={place === OUT} onClick={() => setPlace(place === OUT ? item.place : OUT)}>
          {place === OUT ? 'Keep it' : item.recheck ? 'Take out' : 'Leave out'}
        </button>
      </div>
      {/* The step it goes in is the one lit below; said in words only when
          there is something to do. */}
      {place === null || place === OUT || pickFirst ? (
        <span className="hint">
          {place === OUT
            ? item.recheck
              ? 'Taken out of the batch.'
              : 'Left out of the batch.'
            : pickFirst
              ? 'Pick where it goes, then Approve.'
              : 'No step fits what it says - pick where it goes.'}
        </span>
      ) : null}
      {listening ? <span className="hint">Listening to what you say in it…</span> : null}
      {/* The step its words sound like, one tap away. */}
      {hint && place !== hint && place !== OUT ? (
        <button type="button" className="drop-check-hint" onClick={() => setPlace(hint)}>
          <span>Sounds like</span>
          <span className="step-num">{steps.findIndex((st) => st.id === hint) + 1}</span>
          <b>{steps.find((st) => st.id === hint)?.name ?? ''}</b>
          <span className="drop-check-move">Move it</span>
        </button>
      ) : null}
      <div className="drop-check-steps" role="radiogroup" aria-label="Where this clip goes">
        {steps.map((st, i) => (
          <button
            key={st.id}
            type="button"
            role="radio"
            aria-checked={place === st.id}
            className={place === st.id ? 'active' : ''}
            ref={(el) => {
              if (el && place === st.id) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
            }}
            onClick={() => setPlace(st.id)}
          >
            <span className="step-num">{i + 1}</span>
            {st.name}
          </button>
        ))}
        {format.dropHooks || item.place === HOOK || steps.length === 0 ? (
          <button type="button" role="radio" aria-checked={place === HOOK} className={place === HOOK ? 'active' : ''} onClick={() => setPlace(HOOK)}>
            Hook
          </button>
        ) : null}
      </div>
    </div>
  )

  // Over the whole screen, tab bar and all, like the Cutter's own check.
  if (listening) {
    return (
      <div className="drop-check-screen">
        <section className="screen review">
          <button type="button" className="back" onClick={onClose}>
            <ChevronLeft /> Batch
          </button>
          {where}
        </section>
      </div>
    )
  }
  return (
    <div className="drop-check-screen">
    <CaptionReview
      key={item.file.id}
      name={item.name}
      file={file}
      missing={missing}
      initial={said}
      top={where}
      backLabel="Batch"
      approveLabel={place === OUT ? (item.recheck ? 'Take it out' : 'Leave it out') : queue.length > 1 ? 'Approve & next clip' : 'Approve'}
      bare={bareCaptions()}
      position={format.captionY ?? defaultCaptionPosition()}
      size={look.size}
      onSize={(size) => onFormat({ captionSize: size })}
      captionStyle={look.style}
      onCaptionStyle={(style) => onFormat({ captionStyle: style })}
      vocabulary={campaign.brandWords}
      onRecheck={
        postingHere()
          ? (phrases) =>
              recheckCaptions(phrases, campaign.brandWords, campaign.id, {
                campaign: campaign.name,
                brand: campaign.brandWords,
                about: campaign.posting?.rules ?? '',
                angle: '',
                headline: '',
              })
          : undefined
      }
      // Claude reads each clip's captions by itself, once.
      recheckKey={`drop:${item.file.fp ?? item.file.id}`}
      onChange={() => {}}
      onApprove={approve}
      // Approved without captions: the clip plays with none.
      onSkip={() => approve([])}
      onClose={onClose}
    />
    </div>
  )
}
