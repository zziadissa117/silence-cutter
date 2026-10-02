// Signing in to the shared login - the same name and password on his phone
// and his friend's. Once in, it stays in until he signs out.

import { useState } from 'react'

import { CloudError, signIn, type Session } from './cloud'

export function SignIn({ onSignedIn, onCancel }: { onSignedIn: (session: Session) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offerCreate, setOfferCreate] = useState(false)

  const go = async (create: boolean) => {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await signIn(name, password, create))
    } catch (err) {
      const message = err instanceof CloudError ? err.message : String(err)
      if (message === 'no-such-login') {
        setOfferCreate(true)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const ready = name.trim().length > 0 && password.length >= 6

  return (
    <section className="editor">
      <div className="editor-head">
        <h2>Shared login</h2>
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="hint">
        The same login on your phone and your friend's, so your campaigns, angles and picture bank are the same on both
        - and backed up. Videos stay on the phone unless you set up posting. You stay signed in until you sign out.
      </div>
      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) void go(false)
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
            onChange={(e) => {
              setName(e.target.value)
              setOfferCreate(false)
            }}
          />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => {
              setPassword(e.target.value)
              setOfferCreate(false)
            }}
          />
          <span className="hint">At least 6 characters.</span>
        </label>
        {offerCreate ? (
          <div className="notice">
            <span>
              There's no login called "{name.trim().toLowerCase()}" yet. Create it with this password? Your friend then
              signs in with the same two.
            </span>
          </div>
        ) : null}
        {error ? <div className="error">{error}</div> : null}
        <div className="editor-foot">
          <span />
          {offerCreate ? (
            <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void go(true)}>
              {busy ? 'Creating…' : 'Create it'}
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={busy || !ready}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
