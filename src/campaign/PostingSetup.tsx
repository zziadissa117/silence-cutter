// Setting posting up on this phone: this person's own Postiz key, and the
// Anthropic key Claude writes the captions with. Both go straight to the
// server and are kept there, encrypted - never on the phone. Pasting the
// same Postiz key again, on a new phone or after a reinstall, finds the
// same accounts and times.

import { useState } from 'react'

import { PostingError, connect, type Profile } from './posting'

export function PostingSetup({
  again,
  onDone,
  onCancel,
}: {
  /** Already set up: the Anthropic key can be left empty to keep it. */
  again: boolean
  onDone: (profile: Profile) => void
  onCancel: () => void
}) {
  const [postizKey, setPostizKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      onDone(await connect(postizKey, anthropicKey))
    } catch (err) {
      setError(err instanceof PostingError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = postizKey.trim().length > 0 && (again || anthropicKey.trim().length > 0)

  return (
    <section className="editor">
      <div className="editor-head">
        <h2>Posting</h2>
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="hint">
        Finished videos go to your own Postiz, with a caption Claude writes from what you say. Your keys are kept on the
        server, never on the phone - your friend uses his own.
      </div>
      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) void go()
        }}
      >
        <label className="field">
          <span className="label">Postiz API key</span>
          <input
            type="password"
            value={postizKey}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setPostizKey(e.target.value)}
          />
          <span className="hint">In Postiz: Settings, then Public API. Copy the key.</span>
        </label>
        <label className="field">
          <span className="label">Anthropic API key</span>
          <input
            type="password"
            value={anthropicKey}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={again ? 'Leave empty to keep the one you gave' : undefined}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
          <span className="hint">At console.anthropic.com: API keys, then Create key. Claude writes the captions with it.</span>
        </label>
        {error ? <div className="error">{error}</div> : null}
        <div className="editor-foot">
          <span />
          <button type="submit" className="btn primary" disabled={busy || !ready}>
            {busy ? 'Checking the keys…' : 'Connect'}
          </button>
        </div>
      </form>
    </section>
  )
}
