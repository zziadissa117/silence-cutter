// A one-time sign-in link opened: the new person chooses a password, and
// their own login is theirs (cutter function `accept-invite`). The link works
// once, within 48 hours; after that this says to ask for a new one.

import { useState } from 'react'

import { CloudError, acceptInvite, type Session } from './cloud'

export function AcceptInvite({ code, onSignedIn }: { code: string; onSignedIn: (session: Session) => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = password.length >= 6 && password === again

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const session = await acceptInvite(code, password)
      // The code is spent: out of the address, so a reload doesn't try it again.
      history.replaceState(null, '', window.location.pathname + window.location.hash)
      onSignedIn(session)
    } catch (err) {
      setError(err instanceof CloudError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="editor">
      <div className="editor-head">
        <h2>Welcome to the Cutter</h2>
      </div>
      <div className="hint tip">
        Choose a password for your login. This link works once: after this, sign in with your login name and this
        password. Your campaigns and videos are your own.
      </div>
      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !busy) void go()
        }}
      >
        <label className="field">
          <span className="label">Password (6 or more)</span>
          <input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">The same again</span>
          <input type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
        </label>
        {password && again && password !== again ? <div className="hint warn-text">The two don't match.</div> : null}
        {error ? <div className="error">{error}</div> : null}
        <div className="editor-foot">
          <span />
          <button type="submit" className="btn primary" disabled={busy || !ready}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </section>
  )
}
