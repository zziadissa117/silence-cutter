// Settings, People: the logins he makes with a one-time sign-in link (his ask,
// 2026-10-29). Only the main login sees this - the server answers "people"
// for it alone. A link works once, within 48 hours; the person who opens it
// chooses a password and has their own campaigns, videos and posts.

import { useEffect, useState } from 'react'

import { CloudError, inviteLink, listPeople, makeInvite, type Person } from './cloud'

function untilLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function People() {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<{ name: string; link: string; until: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void listPeople().then(setPeople)
  }, [])

  // Not the main login (or no connection): nothing to show.
  if (people === null) return null

  const make = async () => {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const login = name.trim().toLowerCase()
      const { code, until } = await makeInvite(login)
      setMade({ name: login, link: inviteLink(code), until })
      setName('')
      setPeople(await listPeople())
    } catch (err) {
      setError(err instanceof CloudError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!made) return
    const text = `Your Cutter login is "${made.name}". Open this link once to choose your password: ${made.link}`
    if (typeof navigator.share === 'function') {
      await navigator.share({ text }).catch(() => {})
      return
    }
    await navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <>
      <div className="list-title">People</div>
      <div className="card-group">
        {people.map((p) => (
          <div key={p.name} className="setting">
            <div className="setting-text">
              <span className="row-name">{p.name}</span>
              <span className="row-line">
                {p.status === 'invited'
                  ? p.until && Date.parse(p.until) > Date.now()
                    ? `Link not opened yet · works until ${untilLabel(p.until)}`
                    : 'Link expired - make a new one with the same name'
                  : p.status === 'paused'
                    ? 'Paused'
                    : 'Signed up · their own campaigns and videos'}
              </span>
            </div>
          </div>
        ))}
        <div className="setting">
          <div className="setting-text">
            <span className="row-name">A sign-in link for someone new</span>
            <span className="row-line wrap">
              Their login name. The link works once, within 48 hours; they choose their own password and get their own
              Cutter, empty - nothing of yours.
            </span>
            <input
              type="text"
              value={name}
              placeholder="login name, e.g. jake"
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Login name"
              onChange={(e) => setName(e.target.value)}
            />
            {error ? <span className="row-line warn-text">{error}</span> : null}
          </div>
          <button type="button" className="btn small primary" disabled={busy || name.trim().length < 3} onClick={() => void make()}>
            {busy ? 'Making…' : 'Make link'}
          </button>
        </div>
        {made ? (
          <div className="setting">
            <div className="setting-text">
              <span className="row-name">Link for {made.name}</span>
              <span className="row-line wrap">Works once, until {untilLabel(made.until)}. Send it only to them.</span>
              <span className="row-line wrap" style={{ userSelect: 'all', wordBreak: 'break-all' }}>
                {made.link}
              </span>
            </div>
            <button type="button" className="btn small" onClick={() => void send()}>
              {copied ? 'Copied' : 'Send'}
            </button>
          </div>
        ) : null}
      </div>
    </>
  )
}
