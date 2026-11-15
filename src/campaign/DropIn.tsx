// The clips of a talking head format, edited the way the Cutter edits his
// talking videos (prepareDrop.ts) and then checked by him one by one
// (DropCheck.tsx) before any video uses them.
//
// - "Drop in all videos" (his ask, 2026-11-13): all his short clips at once.
// - A clip he adds to a step with its + Add, or to his hooks (unless he keeps
//   them as filmed - BatchFormat.rawHooks), goes the same way (his report,
//   2026-11-13: "if I add a video in the product steps manually myself, it
//   should get edited too").
// - Clips he added before as filmed: "Edit the clips added as filmed".
// - The same recording again: edited again, in place of the one in the batch.
//
// With his Cutter server up, the clips go there (his ask, 2026-11-13: "move it
// to the server"): the phone only sends them, the server hears and cuts
// several at once, and each comes back to the check - a copy downloaded for
// the phone too. What is still on the server is remembered, so he can close
// the app. With no server, the phone does it all.

import { useEffect, useMemo, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { BankFile, BatchBank, BatchStep } from './batch'
import { addToQueue, checkedClip, clipsOfFormat, loadQueue, notEdited, QUEUE_EVENT, queueRecheck, sameRecording, suggestPlace, type ClipSource, type DropChoices, type ToCheck } from './dropQueue'
import type { AngleEffects } from './effects'
import { fingerprint } from './fingerprint'
import { NO_EFFECTS } from './effects'
import { cutName, dropSettings, hasZooms, prepareClip, type DropPhase } from './prepareDrop'
import { loadBankFile, retireBankFiles, saveBankFile } from './store'
import { keptWords } from './talkCaptions'
import { downloadFile, dropTalk, orderDrop, serverLetDown, talkNow, talkServerUp, upload } from './talkLink'
import { talkFileId, type DropResult } from './talkOrder'

export { HOOK } from './dropQueue'

/** A clip on the server, not back yet - or back, its copy for the phone
 *  still to come down (`back`). */
interface Waiting {
  id: string
  name: string
  from: string
  progress?: number
  /** Where he asked it to go, and the clip it takes the place of. */
  to?: string | null
  replaces?: string
  /** Dropped in with "Captions" unticked, or "Mirror them" ticked, or "Zoom" unticked. */
  noCaptions?: boolean
  mirror?: boolean
  noZoom?: boolean
  /** The recording, kept on the phone for the clip's timeline on the check. */
  source?: KeptRecording
  back?: boolean
  /** Times the copy for the phone failed to come down. */
  tries?: number
}

/** A dropped recording kept on the phone for its clip's timeline. */
type KeptRecording = Pick<ClipSource, 'fileId' | 'size' | 'type'>

/** After this many failed downloads the phone stops asking: the clip waits
 *  for his check all the same, and is fetched again when he opens it. */
const MOST_TRIES = 5

const WAITING_KEY = 'batch.dropping:'

function loadWaiting(formatId: string): Waiting[] {
  try {
    const raw = localStorage.getItem(WAITING_KEY + formatId)
    return raw ? (JSON.parse(raw) as Waiting[]) : []
  } catch {
    return []
  }
}

function saveWaiting(formatId: string, list: Waiting[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(WAITING_KEY + formatId)
    else localStorage.setItem(WAITING_KEY + formatId, JSON.stringify(list))
  } catch {
    // Kept for this visit only.
  }
}

const LOOK_EVERY_MS = 3000

/** One clip to edit: a recording he picked, or a clip already in the batch. */
interface Item {
  /** The recording, when it is on this phone. */
  blob: Blob | null
  /** The clip in the batch it is (edited in place), when it is one. */
  replaces?: BankFile
  name: string
  from: string
  /** Where he asked it to go (a step's or the hooks' + Add). */
  to?: string | null
  /** "Cut the clips" unticked: only heard, kept as he cut it. */
  asFilmed?: boolean
  /** "Zoom" unticked: none of the Cutter's zooms. */
  noZoom?: boolean
  /** "Captions" unticked: it goes in with none. */
  noCaptions?: boolean
  /** "Mirror them" ticked: flipped left to right in every video. */
  mirror?: boolean
}

/** The checklist's lines: what each does, in his words. */
const CHOICES: { key: keyof DropChoices; name: string; on: string; off: string }[] = [
  { key: 'cut', name: 'Cut the clips', on: 'Silences and ums out.', off: 'Kept exactly as you cut them.' },
  { key: 'zoom', name: 'Zoom', on: 'In and out between your phrases, a push-in at the start.', off: 'No zooms - the shot stays still.' },
  { key: 'captions', name: 'Captions', on: 'What you say, as captions.', off: 'No captions on these clips.' },
  { key: 'music', name: 'Music', on: 'A song under the videos.', off: 'No song - your voice and the clips’ own sound.' },
  { key: 'headline', name: 'Headline', on: 'The hook words over the start.', off: 'No words over the start.' },
  { key: 'mirror', name: 'Mirror them', on: 'Left and right swapped - a paper you hold up reads the right way.', off: 'As you filmed them.' },
]

/** The + Add buttons of each open talking head format, edited here. */
const dropTargets = new Map<string, (files: File[], to: string, replaces?: BankFile) => void>()

/** His clips edited like a drop-in and checked, for a step's or the hooks'
 *  + Add - or in place of a clip of the batch (`replaces`, the quick check's
 *  Replace) - false when that format's drop-in isn't on screen. */
export function dropInto(formatId: string, files: File[], to: string, replaces?: BankFile): boolean {
  const run = dropTargets.get(formatId)
  if (!run) return false
  run(files, to, replaces)
  return true
}

const PHASE: Record<DropPhase, string> = { model: 'Getting the listening ready', listening: 'Listening', cutting: 'Cutting' }

export function DropIn({
  formatId,
  steps,
  hookFiles,
  hooks,
  rawHooks,
  names,
  effects,
  brandWords,
  getBank,
  onCheck,
  choices,
  onChoices,
  onWatch,
}: {
  formatId: string
  /** This format's product steps. */
  steps: BatchStep[]
  /** This format's hooks (the clips of him). */
  hookFiles: BankFile[]
  /** A clip that says no step's name is a hook (BatchFormat.dropHooks). */
  hooks: boolean
  /** His hooks kept as filmed (BatchFormat.rawHooks). */
  rawHooks: boolean
  /** The campaign's brand words, heard right. */
  names: string[]
  /** The zooms his talking videos get, and the words the brand hit fires on. */
  effects: AngleEffects
  brandWords: string[]
  getBank: () => BatchBank | null
  /** Opens the check of the clips waiting for it. */
  onCheck: () => void
  /** The drop-in checklist as he last left it for this format (dropQueue.choicesOf). */
  choices: DropChoices
  /** His picks, kept on the format - music and the headline are its videos'. */
  onChoices: (choices: DropChoices) => void
  /** Every clip of the format (ClipEditor.tsx opens them). */
  onWatch?: () => void
}) {
  const [running, setRunning] = useState<{ at: number; of: number; name: string; phase: string } | null>(null)
  /** Clips he just picked, waiting on the checklist - ticked as he last left it. */
  const [picked, setPicked] = useState<File[] | null>(null)
  /** The checklist open on its own, to set it before dropping anything in. */
  const [setting, setSetting] = useState(false)
  const [draft, setDraft] = useState<DropChoices>(choices)
  const [failed, setFailed] = useState<{ name: string; why: string }[]>([])
  const stop = useRef(false)
  const [queue, setQueue] = useState<ToCheck[]>(() => loadQueue(formatId))
  const [waiting, setWaitingState] = useState<Waiting[]>(() => loadWaiting(formatId))
  const waitingRef = useRef(waiting)
  const setWaiting = (next: Waiting[]) => {
    waitingRef.current = next
    saveWaiting(formatId, next)
    setWaitingState(next)
  }
  useEffect(() => {
    const onQueue = (event: Event) => {
      if ((event as CustomEvent<{ formatId: string }>).detail.formatId === formatId) setQueue(loadQueue(formatId))
    }
    window.addEventListener(QUEUE_EVENT, onQueue)
    return () => window.removeEventListener(QUEUE_EVENT, onQueue)
  }, [formatId])

  const cut = () => dropSettings({ effects, brandWords })
  const fail = (name: string, why: unknown) => setFailed((f) => [...f, { name, why: why instanceof Error ? why.message : String(why) }])

  /** A clip back, edited: waiting for his check, where it would go worked
   *  out (dropQueue.suggestPlace). */
  const toCheck = (
    name: string,
    clip: DropResult,
    { to, replaces, noCaptions, mirror, source }: { to?: string | null; replaces?: string; noCaptions?: boolean; mirror?: boolean; source?: ClipSource },
  ) => {
    const bank = getBank()
    const { place, sure, hint } = suggestPlace(bank, steps, clip.text, { to, replaces, hooks })
    setQueue(
      addToQueue(formatId, {
        file: mirror ? { ...clip.file, mirror: true } : clip.file,
        name,
        text: clip.text,
        words: clip.words,
        place,
        sure,
        ...(hint ? { hint } : {}),
        ...(replaces ? { replaces } : {}),
        ...(noCaptions ? { noCaptions: true } : {}),
        ...(source ? { source } : {}),
      }),
    )
  }

  /** The recording kept on this phone for the clip's timeline - nothing
   *  when it can't be (no room): the clip is checked without one. */
  const keepSource = async (blob: Blob | null): Promise<KeptRecording | undefined> => {
    if (!blob) return undefined
    const kept = { fileId: `src-${crypto.randomUUID()}`, size: blob.size, type: blob.type || 'video/quicktime' }
    return saveBankFile(kept.fileId, blob).then(
      () => kept,
      () => undefined,
    )
  }
  /** Its recording and cut, with how it was made, for the check's timeline. */
  const sourceOf = (kept: KeptRecording | undefined, clip: DropResult, noZoom: boolean | undefined, from: string): ClipSource | undefined => {
    if (!kept || !clip.plan) return undefined
    const how = cut()
    return {
      ...kept,
      ...clip.plan,
      effects: noZoom ? NO_EFFECTS : (how.effects ?? NO_EFFECTS),
      brandWords: how.brandWords ?? [],
      voice: how.voice,
      seed: from,
    }
  }

  /** Already on its way or waiting for his check: not edited twice. */
  const onItsWay = (from: string) => waitingRef.current.some((w) => w.from === from) || loadQueue(formatId).some((q) => q.file.from === from)

  /** Each clip up to the server with its order; the server does the rest.
   *  The server failing to take one: that one and the rest done here. */
  const sendAll = async (items: Item[]) => {
    const how = cut()
    for (const [i, item] of items.entries()) {
      if (stop.current) break
      const say = (phase: string) => setRunning({ at: i + 1, of: items.length, name: item.name, phase })
      say('Sending to your server')
      try {
        const id = `d${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
        // A clip of the batch that isn't on this phone is cut from the
        // server's own copy.
        let fileId = item.replaces?.id ?? ''
        const source = await keepSource(item.blob)
        if (item.blob) {
          fileId = talkFileId('t', id)
          await upload(fileId, item.blob, item.name, item.blob.type || 'video/quicktime', (p) => say(`Sending to your server ${Math.round(p * 100)}%`))
        } else if (!fileId) throw new Error('not on this phone')
        await orderDrop({
          id,
          fileId,
          outId: crypto.randomUUID(),
          outName: cutName(item.name),
          inName: item.name,
          from: item.from,
          ...how,
          ...(item.noZoom ? { effects: NO_EFFECTS } : {}),
          names,
          ...(item.asFilmed ? { asFilmed: true } : {}),
        })
        setWaiting([
          ...waitingRef.current,
          {
            id,
            name: item.name,
            from: item.from,
            ...(item.to !== undefined ? { to: item.to } : {}),
            ...(item.replaces ? { replaces: item.replaces.id } : {}),
            ...(item.noCaptions ? { noCaptions: true } : {}),
            ...(item.mirror ? { mirror: true } : {}),
            ...(item.noZoom ? { noZoom: true } : {}),
            ...(source ? { source } : {}),
          },
        ])
      } catch {
        serverLetDown()
        return onPhone(items.slice(i))
      }
    }
    setRunning(null)
  }

  /** All on this phone: no server, or it stopped taking them. */
  const onPhone = async (items: Item[]) => {
    const how = cut()
    for (const [i, item] of items.entries()) {
      if (stop.current) break
      setRunning({ at: i + 1, of: items.length, name: item.name, phase: PHASE.listening })
      try {
        const blob = item.blob ?? (item.replaces ? await loadBankFile(item.replaces) : null)
        if (!blob) throw new Error('not on this phone')
        const clip = await prepareClip(blob, {
          name: item.name,
          names,
          cut: item.noZoom ? { ...how, effects: NO_EFFECTS } : how,
          from: item.from,
          asFilmed: item.asFilmed,
          onPhase: (phase, p) => setRunning({ at: i + 1, of: items.length, name: item.name, phase: `${PHASE[phase]}${p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : ''}` }),
        })
        const kept = await keepSource(blob)
        toCheck(item.name, clip, {
          to: item.to,
          replaces: item.replaces?.id,
          noCaptions: item.noCaptions,
          mirror: item.mirror,
          source: sourceOf(kept, clip, item.noZoom, item.from),
        })
      } catch (error) {
        fail(item.name, error)
      }
    }
    setRunning(null)
  }

  const go = async (items: Item[]) => {
    stop.current = false
    if (items.length === 0) return
    // His server up: it does the listening and cutting, several at once.
    if (await talkServerUp().catch(() => false)) return sendAll(items)
    return onPhone(items)
  }

  /** Recordings he picked: each edited as the checklist says - for a step's
   *  + Add, as he last left it - in place of the same one in the batch when
   *  it is there already. */
  const run = async (files: File[], to?: string, how: DropChoices = choices, instead?: BankFile) => {
    setFailed([])
    const asked = {
      ...(how.cut ? {} : { asFilmed: true }),
      ...(how.zoom ? {} : { noZoom: true }),
      ...(how.captions ? {} : { noCaptions: true }),
      ...(how.mirror ? { mirror: true } : {}),
    }
    const items: Item[] = []
    for (const file of files) {
      const from = await fingerprint(file)
      if (onItsWay(from) || items.some((x) => x.from === from)) {
        fail(file.name, 'already on its way to your check')
        continue
      }
      const bank = getBank()
      const same = instead ?? (bank ? sameRecording(bank, formatId, from) : null)
      items.push({ blob: file, name: file.name, from, ...asked, ...(to !== undefined ? { to } : {}), ...(same ? { replaces: same } : {}) })
    }
    await go(items)
  }

  /** Clips already in the batch as he filmed them, edited now - each back
   *  where it is, unless its words say another step (dropQueue.suggestPlace). */
  const editOld = async (files: BankFile[]) => {
    setFailed([])
    const items: Item[] = []
    for (const file of files) {
      const blob = await loadBankFile(file).catch(() => null)
      const from = file.from ?? file.fp ?? (blob ? await fingerprint(blob) : file.id)
      if (onItsWay(from)) continue
      // Flipped as it was.
      items.push({
        blob,
        replaces: file,
        name: file.name,
        from,
        ...(choices.zoom ? {} : { noZoom: true }),
        ...(choices.captions ? {} : { noCaptions: true }),
        ...(file.mirror ? { mirror: true } : {}),
      })
    }
    await go(items)
  }

  // A step's or the hooks' + Add, edited here.
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    // undefined: the checklist as it is now, not as it was when this was set up.
    const target = (files: File[], to: string, replaces?: BankFile) => void runRef.current(files, to, undefined, replaces)
    dropTargets.set(formatId, target)
    return () => {
      if (dropTargets.get(formatId) === target) dropTargets.delete(formatId)
    }
  }, [formatId])

  /** The copy for the phone, down from the server. Done with the order
   *  there once it is here. */
  const fetching = useRef(new Set<string>())
  const fetchCopy = (w: Waiting, fileId: string) => {
    if (fetching.current.has(w.id)) return
    fetching.current.add(w.id)
    const finish = (change: Partial<Waiting> | null) => {
      fetching.current.delete(w.id)
      const list = waitingRef.current
      setWaiting(change ? list.map((x) => (x.id === w.id ? { ...x, ...change } : x)) : list.filter((x) => x.id !== w.id))
    }
    void downloadFile(fileId)
      .then(async (blob) => {
        await saveBankFile(fileId, blob)
        void dropTalk(w.id)
        finish(null)
      })
      .catch(() => {
        const tries = (w.tries ?? 0) + 1
        if (tries >= MOST_TRIES) void dropTalk(w.id)
        finish(tries >= MOST_TRIES ? null : { tries })
      })
  }

  // What the server has finished, to his check as it comes back - also
  // after he closed the app and came back here.
  const looking = useRef(false)
  const look = async () => {
    if (looking.current) return
    looking.current = true
    try {
      const there = await talkNow().catch(() => null)
      if (!there) return
      let next = waitingRef.current
      const copies: [Waiting, string][] = []
      for (const w of waitingRef.current) {
        const rec = there[w.id]
        if (w.back) {
          const fileId = rec?.dropped?.file.id ?? loadQueue(formatId).find((q) => q.file.from === w.from)?.file.id
          if (fileId) copies.push([w, fileId])
          else next = next.filter((x) => x.id !== w.id)
          continue
        }
        if (!rec) {
          fail(w.name, 'the server lost it - drop it in again')
          if (w.source) void retireBankFiles([w.source.fileId]).catch(() => {})
          next = next.filter((x) => x.id !== w.id)
        } else if (rec.state === 'made' && rec.dropped) {
          toCheck(w.name, rec.dropped, {
            to: w.to,
            replaces: w.replaces,
            noCaptions: w.noCaptions,
            mirror: w.mirror,
            source: sourceOf(w.source, rec.dropped, w.noZoom, w.from),
          })
          next = next.map((x) => (x.id === w.id ? { ...x, back: true } : x))
          copies.push([{ ...w, back: true }, rec.dropped.file.id])
        } else if (rec.state === 'failed') {
          fail(w.name, rec.error ?? 'failed on the server')
          if (w.source) void retireBankFiles([w.source.fileId]).catch(() => {})
          void dropTalk(w.id)
          next = next.filter((x) => x.id !== w.id)
        } else next = next.map((x) => (x.id === w.id ? { ...x, progress: rec.progress } : x))
      }
      setWaiting(next)
      for (const [w, fileId] of copies) fetchCopy(w, fileId)
    } finally {
      looking.current = false
    }
  }
  const lookRef = useRef(look)
  lookRef.current = look
  useEffect(() => {
    if (waiting.length === 0) return
    void lookRef.current()
    const timer = window.setInterval(() => void lookRef.current(), LOOK_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [waiting.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const cutting = waiting.filter((w) => !w.back).length
  const asFilmed = notEdited(steps, rawHooks ? [] : hookFiles)
  const canDrop = steps.length > 0 || hooks

  // Where every clip is (his ask, 2026-11-14: "let's say there was a video
  // that was in the wrong product step. How do I know?"): the ones he hasn't
  // looked at yet, those whose words sound like another step first - his
  // hooks too when dropped clips can be hooks.
  const looked = JSON.stringify([
    steps.map((st) => [st.id, st.name, st.heard, st.files.map((f) => [f.id, checkedClip(f)])]),
    hooks ? hookFiles.map((f) => [f.id, checkedClip(f)]) : 0,
  ])
  // Worked out again only when a clip, a step or what it heard changes.
  const clips = useMemo(() => clipsOfFormat(steps, hooks ? hookFiles : [], keptWords), [looked]) // eslint-disable-line react-hooks/exhaustive-deps
  const queued = new Set(queue.map((q) => q.file.id))
  const unchecked = clips.filter((c) => !checkedClip(c.file) && !queued.has(c.file.id))
  const elsewhere = unchecked.filter((c) => c.elsewhere).length
  const recheck = (list: typeof clips) => {
    setQueue(queueRecheck(formatId, list))
    onCheck()
  }

  return (
    <div className="drop-in">
      {queue.length > 0 ? (
        <button type="button" className="btn primary wide drop-check-btn" onClick={onCheck}>
          Check {queue.length} clip{queue.length === 1 ? '' : 's'}
        </button>
      ) : null}
      {running ? (
        <div className="drop-in-running">
          <span className="row-name">
            {running.at} of {running.of} · {running.phase}
          </span>
          <span className="hint">{running.name}</span>
          <div className="bar">
            <div style={{ width: `${Math.round(((running.at - 1) / running.of) * 100)}%` }} />
          </div>
          <button type="button" className="linkbtn" onClick={() => (stop.current = true)}>
            Stop after this one
          </button>
        </div>
      ) : picked ? (
        <DropChecklist
          count={picked.length}
          zooms={hasZooms(effects)}
          value={draft}
          onChange={setDraft}
          onStart={() => {
            const files = picked
            setPicked(null)
            onChoices(draft)
            void run(files, undefined, draft)
          }}
          onCancel={() => setPicked(null)}
        />
      ) : setting ? (
        <DropChecklist
          count={null}
          zooms={hasZooms(effects)}
          value={draft}
          onChange={setDraft}
          onStart={() => {
            setSetting(false)
            onChoices(draft)
          }}
          onCancel={() => setSetting(false)}
        />
      ) : canDrop ? (
        <VideoPicker
          className={`btn wide${queue.length > 0 ? '' : ' primary'}`}
          label="Drop in all videos"
          onFiles={(files) => {
            if (files.length === 0) return
            setDraft(choices)
            setPicked(files)
          }}
        >
          + Drop in clips
        </VideoPicker>
      ) : null}
      {/* What it will do with them, in sight before he drops anything in (his
          report, 2026-11-14: "I'm trying to look for the place where I can
          choose to include music or not, or choose to cut things or not"). */}
      {!running && !picked && !setting && canDrop ? (
        <div className="drop-summary">
          <span className="drop-summary-chips" aria-label="What the Cutter does with your clips">
            {CHOICES.map((c) => (
              <span key={c.key} className={`drop-chip${choices[c.key] ? ' on' : ''}`}>
                {choices[c.key] ? '✓' : '✕'} {c.name}
              </span>
            ))}
          </span>
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              setDraft(choices)
              setSetting(true)
            }}
          >
            Change
          </button>
        </div>
      ) : null}
      {cutting > 0 ? (
        <p className="hint">
          Your server is editing {cutting} more clip{cutting === 1 ? '' : 's'}
          {running ? '' : ' - you can close the app; they wait here for your check'}.
        </p>
      ) : null}
      {!running && !picked && !setting && queue.length === 0 && cutting === 0 && canDrop ? (
        <p className="hint">Pick all your clips at once. Each goes in the step you name in it{hooks ? ' (or the hooks)' : ''}; you check every one after.</p>
      ) : null}
      {unchecked.length > 0 && !running ? (
        <div className={`drop-in-recheck${elsewhere > 0 ? ' warn' : ''}`}>
          <span className="row-name">
            {elsewhere > 0
              ? `${elsewhere} clip${elsewhere === 1 ? '' : 's'} may be in the wrong step`
              : `${unchecked.length} clip${unchecked.length === 1 ? '' : 's'} you haven't checked`}
          </span>
          <span className="row-line">
            {elsewhere > 0
              ? `What you say in ${elsewhere === 1 ? 'it' : 'them'} sounds like another step.${unchecked.length > elsewhere ? ` ${unchecked.length} you haven't checked in all.` : ''}`
              : 'Added before the one-by-one check: see where each one is.'}
          </span>
          <button type="button" className="btn small primary" onClick={() => recheck(unchecked)}>
            Check {unchecked.length === 1 ? 'it' : `the ${unchecked.length}`}
          </button>
        </div>
      ) : null}
      {/* A quick look at every clip, playing whole (his ask, 2026-11-15). */}
      {onWatch && clips.length > 0 && !running && !picked && !setting ? (
        <button type="button" className="btn small drop-in-watch" onClick={onWatch}>
          Watch every clip ({clips.length})
        </button>
      ) : null}
      {clips.length > 0 && unchecked.length === 0 && queue.length === 0 && !running ? (
        <button type="button" className="linkbtn drop-in-again" onClick={() => recheck(clips)}>
          Check where every clip is again
        </button>
      ) : null}
      {asFilmed.length > 0 && !running ? (
        <button type="button" className="btn small" onClick={() => void editOld(asFilmed)}>
          Edit the {asFilmed.length} clip{asFilmed.length === 1 ? '' : 's'} added as filmed
        </button>
      ) : null}
      {failed.length > 0 ? (
        <ul className="drop-in-failed">
          {failed.map((f, k) => (
            <li key={`${f.name}-${k}`} className="hint warn-text">
              {f.name}: {f.why === 'already on its way to your check' ? f.why : `couldn't edit it (${f.why})`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** What the Cutter does with the clips he just dropped in: the switches,
 *  ticked as he last left them, and Start - or, opened with Change before
 *  any clip (`count` null), Save. */
function DropChecklist({
  count,
  zooms,
  value,
  onChange,
  onStart,
  onCancel,
}: {
  count: number | null
  /** The campaign has zooms on: off, "Zoom" has nothing to add. */
  zooms: boolean
  value: DropChoices
  onChange: (value: DropChoices) => void
  onStart: () => void
  onCancel: () => void
}) {
  return (
    <div className="drop-choices" role="group" aria-label="What the Cutter does with these clips">
      <span className="row-name">{count === null ? 'What the Cutter does with your clips' : `${count} clip${count === 1 ? '' : 's'} - what should the Cutter do?`}</span>
      {CHOICES.map((c) => (
        <label key={c.key} className="toggle drop-choice">
          <input type="checkbox" checked={value[c.key]} aria-label={c.name} onChange={(e) => onChange({ ...value, [c.key]: e.target.checked })} />
          <span className="setting-text">
            <span className="row-name">{c.name}</span>
            <span className="row-line">{c.key === 'zoom' && value.zoom && !zooms ? "This campaign's zooms are off - nothing to add." : value[c.key] ? c.on : c.off}</span>
          </span>
        </label>
      ))}
      <span className="hint">Music and the headline are for every video of this format. You can still mirror or un-mirror each clip on its check.</span>
      <div className="actions-row">
        <button type="button" className="btn small primary" onClick={onStart}>
          {count === null ? 'Save' : 'Start'}
        </button>
        <button type="button" className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

