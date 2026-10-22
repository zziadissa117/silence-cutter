// Buffer as a backup for Postiz, in Settings, Posting: paste a Buffer API key
// and the accounts it backs up are found by themselves (the same Instagram
// username in Buffer and Postiz). A video Postiz can't take goes through
// Buffer by itself; "Postiz is down" also hands Buffer the posts Postiz
// already holds (supabase/functions/postiz/buffer.ts).

import { useState } from 'react'

import { PostingError, handleOf, saveBackup, type Profile } from './posting'

export function BufferBackup({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  const backup = profile.backup ?? null
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  if (profile.accounts.length === 0) return null

  const run = async (change: Parameters<typeof saveBackup>[0]) => {
    setBusy(true)
    setSaid(null)
    try {
      await saveBackup(change)
      setKey('')
      onChanged()
    } catch (error) {
      setSaid(error instanceof PostingError ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const keys = backup?.keys ?? 0
  const backedUp = Object.entries(backup?.matched ?? {}).map(([id, channel]) => {
    const account = profile.accounts.find((a) => a.id === id)
    return account ? `@${handleOf(account) || account.name}` : channel
  })
  const instagram = (backup?.channels ?? []).filter((c) => c.service === 'instagram').map((c) => c.name)
  const line =
    keys === 0
      ? 'Not set up. Paste a Buffer API key (in Buffer: Settings, API) - the accounts it backs up are found by themselves.'
      : backedUp.length > 0
        ? `Backs up ${backedUp.join(', ')} on Instagram. A video Postiz can't take goes through Buffer by itself.`
        : instagram.length > 0
          ? `Buffer has ${instagram.join(', ')}, but none of them is one of your Instagram accounts in Postiz.`
          : 'This Buffer key has no Instagram account. Connect the Instagram account in Buffer, then add the key again.'

  return (
    <>
      <div className="setting buffer-backup">
        <div className="setting-text">
          <span className="row-name">Backup · Buffer{keys > 1 ? ` · ${keys} keys` : ''}</span>
          <span className={`row-line wrap${keys > 0 && backedUp.length === 0 ? ' warn-text' : ''}`}>{line}</span>
          {backup?.problem ? <span className="row-line wrap warn-text">{backup.problem}</span> : null}
        </div>
      </div>
      <div className="actions-row buffer-key">
        <input
          type="password"
          className="find"
          aria-label="Buffer API key"
          placeholder={keys > 0 ? 'Another Buffer API key' : 'Buffer API key'}
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="button" className="btn small primary" disabled={busy || !key.trim()} onClick={() => void run({ bufferKey: key })}>
          {busy ? 'Checking…' : 'Add'}
        </button>
      </div>
      {keys > 0 ? (
        <label className="toggle">
          <input type="checkbox" checked={Boolean(backup?.active)} disabled={busy} onChange={(e) => void run({ active: e.target.checked })} />
          <span>
            <span className="label">Postiz is down: post through Buffer</span>
            <span className="hint" style={{ display: 'block' }}>
              The posts Postiz already holds for these accounts go through Buffer instead, a few hours before their time, and come out of
              Postiz so none goes twice. Turn it off when Postiz is back.
            </span>
          </span>
        </label>
      ) : null}
      {said ? <p className="hint warn-text">{said}</p> : null}
      {keys > 0 ? (
        <button
          type="button"
          className="linkbtn"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Take the Buffer keys out? Posts already in Buffer stay there.')) void run({ removeKeys: true })
          }}
        >
          Take the Buffer key{keys > 1 ? 's' : ''} out
        </button>
      ) : null}
    </>
  )
}
