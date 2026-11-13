// "Drop in all videos" on a talking head format (his ask, 2026-11-13): all
// his short clips at once - each heard, cut, captioned and put in the
// product step whose name he says in it (prepareDrop.ts, stepMatch.ts) - or,
// in a format he set to take hooks, a clip that says no step's name goes to
// his hooks. Then one quick list to check: what he says in each and where it
// went, the unsure ones first, somewhere else or "Leave out" in one tap.
// What he moves teaches the step his wording for next time. A recording
// dropped in before is not kept twice.
//
// With his Cutter server up, the clips go there (his ask, 2026-11-13: "move it
// to the server"): the phone only sends them, the server hears and cuts
// several at once, and the phone puts each in its step as it comes back - a
// copy downloaded for the phone too. What is still on the server is
// remembered, so he can close the app and find them sorted when he is back
// here. With no server, the phone does it all, as before.

import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { BankFile, BatchBank, BatchStep } from './batch'
import { fingerprint } from './fingerprint'
import { cutName, dropSettings, prepareClip, type DropPhase } from './prepareDrop'
import { learned, matchStep } from './stepMatch'
import { retireBankFiles, saveBankFile } from './store'
import { rememberWords } from './talkCaptions'
import { downloadFile, dropTalk, orderDrop, serverLetDown, talkNow, talkServerUp, upload } from './talkLink'
import { talkFileId, type DropResult } from './talkOrder'

/** A clip on the server, not back yet - or sorted in, its copy for the
 *  phone still to come down (`sorted`: its bank file's id). */
interface Waiting {
  id: string
  name: string
  from: string
  progress?: number
  sorted?: string
  /** Times the copy for the phone failed to come down. */
  tries?: number
}

/** After this many failed downloads the phone stops asking: the batch
 *  still has the clip on the server. */
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

/** Where a dropped clip goes: a step's id, his hooks, or nowhere yet. */
export const HOOK = 'hook'
const OUT = 'out'

interface Row {
  /** The clip as picked. */
  name: string
  /** The cut clip, kept - absent when it couldn't be used. */
  file?: BankFile
  text: string
  /** A step's id, HOOK, or null: not sure where, waiting for his pick. */
  place: string | null
  sure: boolean
  failed?: string
}

const PHASE: Record<DropPhase, string> = { model: 'Getting the listening ready', listening: 'Listening', cutting: 'Cutting' }

export function DropIn({
  formatId,
  steps,
  hooks,
  names,
  getBank,
  keep,
}: {
  formatId: string
  /** This format's product steps. */
  steps: BatchStep[]
  /** A clip that says no step's name is a hook (BatchFormat.dropHooks). */
  hooks: boolean
  /** The campaign's brand words, heard right. */
  names: string[]
  getBank: () => BatchBank | null
  keep: (bank: BatchBank) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState<{ at: number; of: number; name: string; phase: string } | null>(null)
  const stop = useRef(false)
  const ids = new Set(steps.map((s) => s.id))
  const [waiting, setWaitingState] = useState<Waiting[]>(() => loadWaiting(formatId))
  const waitingRef = useRef(waiting)
  const setWaiting = (next: Waiting[]) => {
    waitingRef.current = next
    saveWaiting(formatId, next)
    setWaitingState(next)
  }

  /** The bank with `file` taken out of every step and the hooks, and put in
   *  `to` (a step, HOOK, or null for nowhere). */
  const placed = (bank: BatchBank, file: BankFile, to: string | null): BatchBank => {
    const reactions = bank.reactions.filter((r) => r.id !== file.id)
    return {
      ...bank,
      reactions: to === HOOK ? [...reactions, { ...file, formats: [formatId], talks: true }] : reactions.length === bank.reactions.length ? bank.reactions : reactions,
      steps: (bank.steps ?? []).map((st) => {
        const without = st.files.filter((f) => f.id !== file.id)
        return st.id === to ? { ...st, files: [...without, file] } : without.length === st.files.length ? st : { ...st, files: without }
      }),
    }
  }

  /** Already in this batch, dropped in before - or on its way back from the server. */
  const droppedBefore = (bank: BatchBank, from: string) =>
    [...bank.reactions, ...(bank.steps ?? []).flatMap((s) => s.files)].some((f) => f.from === from) || waitingRef.current.some((w) => w.from === from)

  /** A cut clip in its step (or the hooks), and on the check list. */
  const sortIn = (name: string, clip: DropResult) => {
    const bank = getBank()
    if (!bank) return
    const file: BankFile = clip.file
    const match = matchStep(clip.text, (bank.steps ?? []).filter((s) => ids.has(s.id)))
    const place = match.stepId ?? (hooks ? HOOK : null)
    if (place) keep(placed(bank, file, place))
    setRows((r) => [...r, { name, file, text: clip.text, place, sure: match.sure && place !== null }])
  }

  /** Each clip up to the server with its order; the server does the rest.
   *  The server failing to take one: that one and the rest done here. */
  const sendAll = async (files: File[]) => {
    const cut = dropSettings()
    for (const [i, file] of files.entries()) {
      if (stop.current) break
      const say = (phase: string) => setRunning({ at: i + 1, of: files.length, name: file.name, phase })
      say('Sending to your server')
      const from = await fingerprint(file)
      const bank = getBank()
      if (bank && droppedBefore(bank, from)) {
        setRows((r) => [...r, { name: file.name, text: '', place: null, sure: true, failed: 'already in' }])
        continue
      }
      try {
        const id = `d${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
        const fileId = talkFileId('t', id)
        await upload(fileId, file, file.name, file.type || 'video/quicktime', (p) => say(`Sending to your server ${Math.round(p * 100)}%`))
        await orderDrop({ id, fileId, outId: crypto.randomUUID(), outName: cutName(file.name), from, ...cut, names })
        setWaiting([...waitingRef.current, { id, name: file.name, from }])
      } catch {
        serverLetDown()
        return onPhone(files.slice(i))
      }
    }
    setRunning(null)
  }

  /** The copy for the phone, down from the server - kept only while the
   *  batch still has the clip. Done with it there once it is here. */
  const fetching = useRef(new Set<string>())
  const fetchCopy = (w: Waiting) => {
    const fileId = w.sorted
    if (!fileId || fetching.current.has(w.id)) return
    fetching.current.add(w.id)
    const finish = (change: Partial<Waiting> | null) => {
      fetching.current.delete(w.id)
      const list = waitingRef.current
      setWaiting(change ? list.map((x) => (x.id === w.id ? { ...x, ...change } : x)) : list.filter((x) => x.id !== w.id))
    }
    void downloadFile(fileId)
      .then(async (blob) => {
        const bank = getBank()
        const used = bank && [...bank.reactions, ...(bank.steps ?? []).flatMap((st) => st.files)].some((f) => f.id === fileId)
        if (used) await saveBankFile(fileId, blob)
        void dropTalk(w.id)
        finish(null)
      })
      .catch(() => {
        const tries = (w.tries ?? 0) + 1
        if (tries >= MOST_TRIES) void dropTalk(w.id)
        finish(tries >= MOST_TRIES ? null : { tries })
      })
  }

  // What the server has finished, sorted in as it comes back - also after he
  // closed the app and came back here.
  const looking = useRef(false)
  const look = async () => {
    if (looking.current) return
    looking.current = true
    try {
      const there = await talkNow().catch(() => null)
      if (!there) return
      let next = waitingRef.current
      for (const w of waitingRef.current) {
        if (w.sorted) continue
        const rec = there[w.id]
        if (!rec) {
          setRows((r) => [...r, { name: w.name, text: '', place: null, sure: false, failed: 'the server lost it - drop it in again' }])
          next = next.filter((x) => x.id !== w.id)
        } else if (rec.state === 'made' && rec.dropped) {
          rememberWords(rec.dropped.file, rec.dropped.words)
          sortIn(w.name, rec.dropped)
          next = next.map((x) => (x.id === w.id ? { ...x, sorted: rec.dropped!.file.id } : x))
        } else if (rec.state === 'failed') {
          setRows((r) => [...r, { name: w.name, text: '', place: null, sure: false, failed: rec.error ?? 'failed on the server' }])
          void dropTalk(w.id)
          next = next.filter((x) => x.id !== w.id)
        } else next = next.map((x) => (x.id === w.id ? { ...x, progress: rec.progress } : x))
      }
      setWaiting(next)
      for (const w of next) fetchCopy(w)
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

  const run = async (files: File[]) => {
    stop.current = false
    // His server up: it does the listening and cutting, several at once.
    if (await talkServerUp().catch(() => false)) return sendAll(files)
    return onPhone(files)
  }

  /** All on this phone: no server, or it stopped taking them. */
  const onPhone = async (files: File[]) => {
    for (const [i, file] of files.entries()) {
      if (stop.current) break
      setRunning({ at: i + 1, of: files.length, name: file.name, phase: PHASE.listening })
      try {
        const from = await fingerprint(file)
        const before = getBank()
        if (before && droppedBefore(before, from)) {
          setRows((r) => [...r, { name: file.name, text: '', place: null, sure: true, failed: 'already in' }])
          continue
        }
        const clip = await prepareClip(file, {
          names,
          from,
          onPhase: (phase, p) => setRunning({ at: i + 1, of: files.length, name: file.name, phase: `${PHASE[phase]}${p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : ''}` }),
        })
        const bank = getBank()
        if (!bank) break
        const match = matchStep(clip.text, (bank.steps ?? []).filter((s) => ids.has(s.id)))
        const place = match.stepId ?? (hooks ? HOOK : null)
        if (place) keep(placed(bank, clip.file, place))
        setRows((r) => [...r, { name: file.name, file: clip.file, text: clip.text, place, sure: match.sure && place !== null }])
      } catch (error) {
        setRows((r) => [...r, { name: file.name, text: '', place: null, sure: false, failed: error instanceof Error ? error.message : String(error) }])
      }
    }
    setRunning(null)
  }

  /** A clip moved elsewhere, or left out. */
  const move = (row: Row, to: string) => {
    const bank = getBank()
    if (!bank || !row.file) return
    keep(placed(bank, row.file, to === OUT ? null : to))
    if (to === OUT) void retireBankFiles([row.file.id]).catch(() => {})
    setRows((all) => all.map((r) => (r === row ? { ...r, place: to === OUT ? null : to, sure: true, failed: to === OUT ? 'Left out' : undefined } : r)))
  }

  /** Checked: each step remembers how he said it; clips left nowhere go. */
  const done = () => {
    const bank = getBank()
    if (bank) {
      keep({
        ...bank,
        steps: (bank.steps ?? []).map((st) => {
          const said = rows.filter((r) => r.place === st.id && r.file && r.text)
          return said.length > 0 ? { ...st, heard: said.reduce((h, r) => learned(h, r.text), st.heard) } : st
        }),
      })
    }
    const loose = rows.filter((r) => r.file && !r.place && r.failed !== 'Left out').map((r) => r.file!.id)
    if (loose.length > 0) void retireBankFiles(loose).catch(() => {})
    setRows([])
  }

  if (steps.length === 0) return null
  const cutting = waiting.filter((w) => !w.sorted).length
  const toLook = (r: Row) => !r.failed && (!r.sure || !r.place)
  const unsure = rows.filter(toLook)
  const ordered = [...rows].sort((a, b) => Number(!toLook(a)) - Number(!toLook(b)))
  const nameOf = (place: string | null) => (place === HOOK ? 'a hook' : (steps.find((s) => s.id === place)?.name ?? 'no step'))
  const failedLine = (row: Row) =>
    row.failed === 'Left out' ? `${row.name}: left out` : row.failed === 'already in' ? `${row.name}: already in from before` : `${row.name}: couldn't use it (${row.failed})`

  return (
    <div className="drop-in">
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
      ) : (
        <VideoPicker className="btn small primary" label="Drop in all videos" onFiles={(files) => files.length > 0 && void run(files)}>
          Drop in all videos
        </VideoPicker>
      )}
      {cutting > 0 ? (
        <p className="hint">
          Your server is cutting {cutting} more clip{cutting === 1 ? '' : 's'}
          {running ? '' : ' - you can close the app; they are sorted into their steps when you are back here'}.
        </p>
      ) : null}
      {!running && rows.length === 0 ? (
        <p className="hint">
          Pick all your clips at once: each is cut, captioned and put in the step whose name you say in it
          {hooks ? ' - one that says no step is a hook' : ''}.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="drop-in-check">
          <div className="group-title">
            Check them · {rows.length} clip{rows.length === 1 ? '' : 's'}
            {unsure.length > 0 ? ` · ${unsure.length} to look at` : ' · all sure'}
          </div>
          <ul className="rows group">
            {ordered.map((row, k) => (
              <li key={`${row.name}-${k}`} className={`drop-in-row${toLook(row) ? ' unsure' : ''}`}>
                <div className="row-text">
                  <span className="row-line">{row.failed ? failedLine(row) : `“${row.text}”`}</span>
                  {toLook(row) ? <span className="hint warn-text">{row.place ? `Not sure - looks like ${nameOf(row.place)}` : 'Not sure where it goes'}</span> : null}
                </div>
                {row.file && row.failed !== 'Left out' ? (
                  <select value={row.place ?? ''} aria-label={`Where ${row.name} goes`} onChange={(e) => e.target.value && move(row, e.target.value)}>
                    {row.place ? null : <option value="">Pick where</option>}
                    {hooks ? <option value={HOOK}>Hook</option> : null}
                    {steps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value={OUT}>Leave out</option>
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
          {!running ? (
            <button type="button" className="btn primary wide" onClick={done}>
              {rows.some((r) => r.file && !r.place && r.failed !== 'Left out') ? 'Done - clips with nowhere to go are left out' : 'Looks good'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
