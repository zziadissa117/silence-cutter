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

import { useEffect, useState } from 'react'

import type { BatchBank, BatchFormat, BatchStep } from './batch'
import { CaptionReview } from './CaptionReview'
import { defaultCaptionPosition, defaultCaptionSize, defaultCaptionStyle, type CaptionWord } from './captions'
import { checkOrder, HOOK, loadQueue, placed, saveQueue, type ToCheck } from './dropQueue'
import type { Campaign } from './look'
import { postingHere, recheckCaptions } from './posting'
import { learned } from './stepMatch'
import { loadBankFile, retireBankFiles, saveBankFile } from './store'
import { downloadFile } from './talkLink'

/** Left out of the batch. */
const OUT = 'out'

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
  const [queue, setQueue] = useState<ToCheck[]>(() => checkOrder(loadQueue(format.id)))
  const [done, setDone] = useState(0)
  const item = queue[0] ?? null
  const [place, setPlace] = useState<string | null>(item?.place ?? null)
  const [pickFirst, setPickFirst] = useState(false)
  const [file, setFile] = useState<Blob | null>(null)
  const [missing, setMissing] = useState(false)

  // The clip itself: on the phone, or fetched from the Cutter server when
  // its copy hasn't come down yet.
  useEffect(() => {
    if (!item) return
    let alive = true
    setFile(null)
    setMissing(false)
    setPlace(item.place)
    setPickFirst(false)
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

  /** Approved: in the batch where he says, with its captions as he left them. */
  const approve = (words: CaptionWord[]) => {
    if (place === null) {
      setPickFirst(true)
      document.querySelector('.drop-check-screen')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const bank = getBank()
    if (!bank) return
    if (place === OUT) {
      void retireBankFiles([item.file.id]).catch(() => {})
      next()
      return
    }
    const clip = { ...item.file, edited: true, captions: words }
    let after = placed(bank, format.id, clip, place, item.replaces)
    // Its step learns how he says it, for the next drop-in.
    if (place !== HOOK && item.text) {
      after = { ...after, steps: (after.steps ?? []).map((st) => (st.id === place ? { ...st, heard: learned(st.heard, item.text) } : st)) }
    }
    keep(after)
    if (item.replaces) void retireBankFiles([item.replaces]).catch(() => {})
    next()
  }

  const total = done + queue.length
  // Kept short: it stays on screen with the video while he reads the captions.
  const where = (
    <div className={`drop-check-place${place === null || pickFirst ? ' unsure' : ''}${place === OUT ? ' out' : ''}`}>
      <div className="drop-check-line">
        <span className="row-name">
          Clip {done + 1} of {total}
        </span>
        {!item.sure && place === item.place && place !== null ? <span className="drop-check-unsure">Not sure - check it</span> : null}
        <button type="button" className={`linkbtn drop-check-out${place === OUT ? ' active' : ''}`} aria-pressed={place === OUT} onClick={() => setPlace(place === OUT ? item.place : OUT)}>
          {place === OUT ? 'Keep it' : 'Leave out'}
        </button>
      </div>
      {/* The step it goes in is the one lit below; said in words only when
          there is something to do. */}
      {place === null || place === OUT || pickFirst ? (
        <span className="hint">
          {place === OUT ? 'Left out of the batch.' : pickFirst ? 'Pick where it goes, then Approve.' : 'No step fits what it says - pick where it goes.'}
        </span>
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
  return (
    <div className="drop-check-screen">
    <CaptionReview
      key={item.file.id}
      name={item.name}
      file={file}
      missing={missing}
      initial={item.words}
      top={where}
      backLabel="Batch"
      approveLabel={place === OUT ? 'Leave it out' : queue.length > 1 ? 'Approve & next clip' : 'Approve'}
      bare={bareCaptions()}
      position={format.captionY ?? defaultCaptionPosition()}
      size={format.captionSize ?? defaultCaptionSize()}
      onSize={(size) => onFormat({ captionSize: size })}
      captionStyle={format.captionStyle ?? defaultCaptionStyle()}
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
