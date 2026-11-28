// "Share with students" on the Batch tab (batchShare.ts): only on the main
// login, which is the one that has students. Tick who gets it, Share: each of
// them finds the campaign and its batch on their phone the next time they
// open the app - they film their own clips, drop them in and Start.

import { useEffect, useState } from 'react'

import type { BatchBank } from './batch'
import { shareBatch } from './batchShare'
import { listPeople, type Person } from './cloud'
import type { Campaign } from './look'
import { loadBank } from './store'

export function ShareBatch({ campaign, bank }: { campaign: Campaign; bank: BatchBank }) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    void listPeople().then((list) => alive && setPeople(list))
    return () => {
      alive = false
    }
  }, [])

  // Not the main login, or no students yet: nothing to share with.
  const students = (people ?? []).filter((p) => p.status === 'active' && p.only !== 'trial')
  if (!people || students.length === 0) return null

  const send = async () => {
    setSaid(null)
    setBusy('Getting it ready…')
    try {
      const sentTo = await shareBatch(campaign, bank, await loadBank(), [...picked], setBusy)
      setSaid({ text: `Shared with ${sentTo.join(', ')}. It's on their Batch tab next time they open the Cutter - they film their clips, drop them in and Start.` })
      setPicked(new Set())
      setOpen(false)
    } catch (error) {
      setSaid({ text: error instanceof Error ? error.message : String(error), bad: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="group share-batch">
      <div className="setting">
        <div className="setting-text">
          <span className="row-name">Share with students</span>
          <span className="row-line wrap">
            They get this campaign and its batch - formats, steps, words, songs and your product clips - without your clips. They only film and drop in
            theirs.
          </span>
        </div>
        <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Share'}
        </button>
      </div>
      {open ? (
        <>
          <ul className="share-batch-people">
            {students.map((p) => (
              <li key={p.name}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={picked.has(p.name)}
                    disabled={busy !== null}
                    onChange={(e) =>
                      setPicked((now) => {
                        const next = new Set(now)
                        if (e.target.checked) next.add(p.name)
                        else next.delete(p.name)
                        return next
                      })
                    }
                  />
                  <span className="label">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="actions-row">
            <button type="button" className="btn small" disabled={busy !== null} onClick={() => setPicked(new Set(picked.size === students.length ? [] : students.map((p) => p.name)))}>
              {picked.size === students.length ? 'None' : 'Everyone'}
            </button>
            <button type="button" className="btn small primary" disabled={busy !== null || picked.size === 0} onClick={() => void send()}>
              Share with {picked.size === 0 ? '…' : picked.size === 1 ? [...picked][0] : `${picked.size} students`}
            </button>
          </div>
        </>
      ) : null}
      {busy ? <p className="hint">{busy}</p> : null}
      {said ? <p className={`hint${said.bad ? ' warn-text' : ''}`}>{said.text}</p> : null}
    </div>
  )
}
