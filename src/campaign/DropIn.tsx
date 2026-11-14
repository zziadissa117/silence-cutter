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
import { addToQueue, checkedClip, clipsOfFormat, loadQueue, notEdited, QUEUE_EVENT, queueRecheck, sameRecording, suggestPlace, type ToCheck } from './dropQueue'
import type { AngleEffects } from './effects'
import { fingerprint } from './fingerprint'
import { cutName, dropSettings, prepareClip, type DropPhase } from './prepareDrop'
import { loadBankFile, saveBankFile } from './store'
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
  back?: boolean
  /** Times the copy for the phone failed to come down. */
  tries?: number
}

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
}

/** The + Add buttons of each open talking head format, edited here. */
const dropTargets = new Map<string, (files: File[], to: string) => void>()

/** His clips edited like a drop-in and checked, for a step's or the hooks'
 *  + Add - false when that format's drop-in isn't on screen. */
export function dropInto(formatId: string, files: File[], to: string): boolean {
  const run = dropTargets.get(formatId)
  if (!run) return false
  run(files, to)
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
}) {
  const [running, setRunning] = useState<{ at: number; of: number; name: string; phase: string } | null>(null)
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
  const toCheck = (name: string, clip: DropResult, { to, replaces }: { to?: string | null; replaces?: string }) => {
    const bank = getBank()
    const { place, sure, hint } = suggestPlace(bank, steps, clip.text, { to, replaces, hooks })
    setQueue(
      addToQueue(formatId, { file: clip.file, name, text: clip.text, words: clip.words, place, sure, ...(hint ? { hint } : {}), ...(replaces ? { replaces } : {}) }),
    )
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
        if (item.blob) {
          fileId = talkFileId('t', id)
          await upload(fileId, item.blob, item.name, item.blob.type || 'video/quicktime', (p) => say(`Sending to your server ${Math.round(p * 100)}%`))
        } else if (!fileId) throw new Error('not on this phone')
        await orderDrop({ id, fileId, outId: crypto.randomUUID(), outName: cutName(item.name), from: item.from, ...how, names })
        setWaiting([...waitingRef.current, { id, name: item.name, from: item.from, ...(item.to !== undefined ? { to: item.to } : {}), ...(item.replaces ? { replaces: item.replaces.id } : {}) }])
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
          cut: how,
          from: item.from,
          onPhase: (phase, p) => setRunning({ at: i + 1, of: items.length, name: item.name, phase: `${PHASE[phase]}${p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : ''}` }),
        })
        toCheck(item.name, clip, { to: item.to, replaces: item.replaces?.id })
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

  /** Recordings he picked: each edited, in place of the same one in the
   *  batch when it is there already. */
  const run = async (files: File[], to?: string) => {
    setFailed([])
    const items: Item[] = []
    for (const file of files) {
      const from = await fingerprint(file)
      if (onItsWay(from) || items.some((x) => x.from === from)) {
        fail(file.name, 'already on its way to your check')
        continue
      }
      const bank = getBank()
      const same = bank ? sameRecording(bank, formatId, from) : null
      items.push({ blob: file, name: file.name, from, ...(to !== undefined ? { to } : {}), ...(same ? { replaces: same } : {}) })
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
      items.push({ blob, replaces: file, name: file.name, from })
    }
    await go(items)
  }

  // A step's or the hooks' + Add, edited here.
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    const target = (files: File[], to: string) => void runRef.current(files, to)
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
          next = next.filter((x) => x.id !== w.id)
        } else if (rec.state === 'made' && rec.dropped) {
          toCheck(w.name, rec.dropped, { to: w.to, replaces: w.replaces })
          next = next.map((x) => (x.id === w.id ? { ...x, back: true } : x))
          copies.push([{ ...w, back: true }, rec.dropped.file.id])
        } else if (rec.state === 'failed') {
          fail(w.name, rec.error ?? 'failed on the server')
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
      ) : canDrop ? (
        <VideoPicker className={`btn small${queue.length > 0 ? '' : ' primary'}`} label="Drop in all videos" onFiles={(files) => files.length > 0 && void run(files)}>
          Drop in all videos
        </VideoPicker>
      ) : null}
      {cutting > 0 ? (
        <p className="hint">
          Your server is editing {cutting} more clip{cutting === 1 ? '' : 's'}
          {running ? '' : ' - you can close the app; they wait here for your check'}.
        </p>
      ) : null}
      {queue.length > 0 && !running ? <p className="hint">Each one: where it goes and its captions. It is in your videos once you approve it.</p> : null}
      {!running && queue.length === 0 && cutting === 0 && canDrop ? (
        <p className="hint">
          Pick all your clips at once: each is cut like your talking videos, zoomed, captioned and put in the step whose name you say in it
          {hooks ? ' - one that says no step is a hook' : ''}. Then you check every one.
        </p>
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
