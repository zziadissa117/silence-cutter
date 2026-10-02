// Signing in to the shared login - the same name and password on his phone
// and his friend's. Once in, it stays in until he signs out.
//
// This is the first thing anyone sees: LoginGate shows it full screen, with no
// way to cancel, until there is a session. There is no "create a login" step -
// the server does not make them, so a name that does not exist gets the same
// "Wrong login or password" as a wrong password, and nothing here says which.

import { useState } from 'react'

import { CloudError, signIn, type Session } from './cloud'

export function SignIn({ onSignedIn, onCancel }: { onSignedIn: (session: Session) => void; onCancel?: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await signIn(name, password))
    } catch (err) {
      setError(err instanceof CloudError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = name.trim().length > 0 && password.length >= 6

  return (
    <section className="editor">
      <div className="editor-head">
        <h2>Sign in</h2>
        {onCancel ? (
          <button type="button" className="linkbtn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <div className="hint">
        Private. Your campaigns, angles and picture bank are kept on this login and backed up. You stay signed in until
        you sign out.
      </div>
      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !busy) void go()
        }}
      >
        <label className="field">
          <span className="label">Login</span>
          <input
            type="text"
            value={name}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="username"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
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
