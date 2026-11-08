// Setting posting up on this phone: this person's own Postiz key - or a
// Buffer key instead (his ask, 2026-11-08: "it can be a buffer api key too
// that works better, make it so he can put either one") - and the Anthropic
// key Claude writes the captions with. They go straight to the server and are
// kept there, encrypted - never on the phone. Pasting the same key again, on
// a new phone or after a reinstall, finds the same accounts and times.

import { useState } from 'react'

import { PostingError, connect, postingHere, type PostingService, type Profile } from './posting'

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
  // Buffer unless this login already posts through Postiz.
  const [service, setService] = useState<PostingService>(() => (again && postingHere()?.profile.settings.via !== 'buffer' ? 'postiz' : 'buffer'))
  const [postizKey, setPostizKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      onDone(await connect(postizKey, anthropicKey, service))
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
      <div className="hint tip">
        Finished videos go out through your own Buffer or Postiz, with a caption Claude writes from what you say. Your keys
        are kept on the server, never on the phone - use your own, not a friend's: it posts to that key's accounts.
      </div>
      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) void go()
        }}
      >
        <div className="field">
          <span className="label">Post through</span>
          <div className="seg full" role="radiogroup" aria-label="Post through">
            {(['buffer', 'postiz'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={service === s}
                className={service === s ? 'active' : ''}
                onClick={() => {
                  setService(s)
                  setError(null)
                }}
              >
                {s === 'buffer' ? 'Buffer' : 'Postiz'}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="label">{service === 'buffer' ? 'Buffer API key' : 'Postiz API key'}</span>
          <input
            type="password"
            value={postizKey}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setPostizKey(e.target.value)}
          />
          <span className="hint">
            {service === 'buffer'
              ? 'In Buffer: Settings, then API. Make a key and copy it. Your accounts are the channels connected in Buffer.'
              : 'In Postiz: Settings, then Public API. Copy the key.'}
          </span>
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
