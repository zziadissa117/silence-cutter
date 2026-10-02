// The Settings tab: the few things set once and rarely touched - sharing,
// posting, how tight the cut is, whether "um"s go too, and the voice.

import { useEffect, useState } from 'react'

import type { PresetName } from '../media/silenceMath'
import type { Session, SyncState } from './cloud'
import type { LocalPosting, Profile } from './posting'
import { LANDSCAPE_MODES, landscapeMode, setLandscapeMode, type LandscapeMode } from './framing916'
import { PostingLimits } from './PostingLimits'
import type { PushState } from './push'

const PUSH_LINE: Record<PushState, string> = {
  on: 'On - posts to approve, and reminders to submit.',
  off: 'Posts to approve, and reminders to submit.',
  denied: 'Turned off for this app in the iPhone Settings, under Notifications.',
  unsupported: "This browser can't show them.",
  'home-screen': 'Add this app to your Home Screen to get them - iPhones only allow it there.',
}

const PRESET_ORDER: PresetName[] = ['natural', 'balanced', 'tight']
const PRESET_LABEL: Record<PresetName, string> = { natural: 'Natural', balanced: 'Balanced', tight: 'Tight' }
const PRESET_HINT: Record<PresetName, string> = {
  natural: 'Keeps short pauses, sounds conversational.',
  balanced: 'Takes out awkward pauses, keeps a natural rhythm.',
  tight: 'Fast TikTok pacing - almost every pause goes.',
}

export function syncLine(session: Session | null, state: SyncState): string {
  if (!session) return 'Not shared - setups are on this phone only'
  if (state.kind === 'syncing') return `Shared as ${session.name} · syncing…`
  if (state.kind === 'waiting') return `Shared as ${session.name} · not synced yet`
  return `Shared as ${session.name} · up to date`
}

function size(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** What this app keeps on the phone. A full phone is what stops the iPhone
 *  handing picked videos over, so it is shown rather than guessed at. */
function useSpaceUsed(): number | null {
  const [used, setUsed] = useState<number | null>(null)
  useEffect(() => {
    navigator.storage
      ?.estimate()
      .then(({ usage }) => setUsed(usage ?? null))
      .catch(() => {})
  }, [])
  return used
}

function WideClips() {
  const [mode, setMode] = useState<LandscapeMode>(landscapeMode)
  const pick = (next: LandscapeMode) => {
    setLandscapeMode(next)
    setMode(next)
  }
  return (
    <>
      <div className="list-title">Wide clips</div>
      <div className="seg full" role="radiogroup" aria-label="Wide clips">
        {LANDSCAPE_MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => pick(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="hint">
        {LANDSCAPE_MODES.find((m) => m.id === mode)?.note} Clips already 9:16 are never touched. Applies to videos you make next.
      </p>
    </>
  )
}

export function SettingsView({
  session,
  syncState,
  preset,
  cleanSpeech,
  onSignIn,
  onSignOut,
  onPreset,
  onCleanSpeech,
  captions,
  onCaptions,
  bareCaptions,
  onBareCaptions,
  voice,
  onVoice,
  posting,
  push,
  onSetUpPosting,
  onSendHere,
  onPush,
  onDisconnectPosting,
  onLimitsChanged,
}: {
  session: Session | null
  syncState: SyncState
  preset: PresetName
  cleanSpeech: boolean
  onSignIn: () => void
  onSignOut: () => void
  onPreset: (preset: PresetName) => void
  onCleanSpeech: (on: boolean) => void
  captions: boolean
  onCaptions: (on: boolean) => void
  bareCaptions: boolean
  onBareCaptions: (on: boolean) => void
  voice: boolean
  onVoice: (on: boolean) => void
  posting: LocalPosting | null
  push: PushState
  onSetUpPosting: () => void
  onSendHere: (on: boolean) => void
  onPush: () => void
  onDisconnectPosting: () => void
  /** The profile came back from saving pause / daily limits. */
  onLimitsChanged: (profile: Profile) => void
}) {
  const used = useSpaceUsed()
  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Settings</h1>
      </div>

      <div className="list-title">Sharing</div>
      <div className="setting">
        <div className="setting-text">
          <span className={`row-name${syncState.kind === 'waiting' ? ' warn-text' : ''}`}>{syncLine(session, syncState)}</span>
          <span className="row-line">
            {session
              ? syncState.kind === 'waiting'
                ? syncState.reason
                : 'Campaigns, angles and the picture bank are the same on every phone signed in.'
              : 'Sign in with the shared login to have the same setups as your friend, backed up.'}
          </span>
        </div>
        {session ? (
          <button type="button" className="btn small" onClick={onSignOut}>
            Sign out
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={onSignIn}>
            Sign in
          </button>
        )}
      </div>

      <div className="list-title">Posting</div>
      {posting ? (
        <>
          <div className="setting">
            <div className="setting-text">
              <span className="row-name">
                Postiz · {posting.profile.accounts.length} account{posting.profile.accounts.length === 1 ? '' : 's'}
              </span>
              <span className="row-line wrap">Pick each campaign's accounts and times under Campaigns, then Posting.</span>
            </div>
            <button type="button" className="btn small" onClick={onSetUpPosting}>
              Change keys
            </button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={posting.sendHere} onChange={(e) => onSendHere(e.target.checked)} />
            <span>
              <span className="label">Send finished videos from this phone</span>
              <span className="hint" style={{ display: 'block' }}>
                Each one goes to Postiz with a caption, for the campaigns with accounts picked.
              </span>
            </span>
          </label>
          <PostingLimits profile={posting.profile} onChanged={onLimitsChanged} />
          <div className="setting">
            <div className="setting-text">
              <span className="row-name">Notifications</span>
              <span className={`row-line wrap${push === 'denied' ? ' warn-text' : ''}`}>{PUSH_LINE[push]}</span>
            </div>
            {push === 'off' ? (
              <button type="button" className="btn small primary" onClick={onPush}>
                Turn on
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              if (window.confirm('Stop posting from this phone? Posts already in Postiz stay there.')) onDisconnectPosting()
            }}
          >
            Disconnect this phone
          </button>
        </>
      ) : (
        <div className="setting">
          <div className="setting-text">
            <span className="row-name">Not set up</span>
            <span className="row-line wrap">
              {session
                ? 'Send finished videos to your own Postiz, with a caption Claude writes, to approve here.'
                : 'Sign in with the shared login first.'}
            </span>
          </div>
          {session ? (
            <button type="button" className="btn small primary" onClick={onSetUpPosting}>
              Set up
            </button>
          ) : null}
        </div>
      )}

      <div className="list-title">Pacing</div>
      <div className="seg full" role="radiogroup" aria-label="Pacing">
        {PRESET_ORDER.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={preset === p} className={preset === p ? 'active' : ''} onClick={() => onPreset(p)}>
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      <p className="hint">{PRESET_HINT[preset]} Applies to videos you add next.</p>

      <WideClips />

      <div className="list-title">Captions</div>
      <label className="toggle">
        <input type="checkbox" checked={captions} onChange={(e) => onCaptions(e.target.checked)} />
        <span>
          <span className="label">Captions on the videos</span>
          <span className="hint" style={{ display: 'block' }}>
            One word at a time as you say it. You check them before each video is made.
          </span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={bareCaptions} disabled={!captions} onChange={(e) => onBareCaptions(e.target.checked)} />
        <span>
          <span className="label">Leave out punctuation</span>
          <span className="hint" style={{ display: 'block' }}>
            No ? or ! either - commas and full stops are always left off. "Don't" and "2.5" stay as they are.
          </span>
        </span>
      </label>

      <div className="list-title">Speech</div>
      <label className="toggle">
        <input type="checkbox" checked={voice} onChange={(e) => onVoice(e.target.checked)} />
        <span>
          <span className="label">Make my voice louder and clearer</span>
          <span className="hint" style={{ display: 'block' }}>
            Evens it out and brings it to normal TikTok loudness, never past a safe level.
          </span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={cleanSpeech} onChange={(e) => onCleanSpeech(e.target.checked)} />
        <span>
          <span className="label">Also cut "um"s and stumbles</span>
          <span className="hint" style={{ display: 'block' }}>
            Uses more memory. If a video keeps stopping the page, turn it off.
          </span>
        </span>
      </label>

      {used !== null ? (
        <>
          <div className="list-title">Space</div>
          <p className="hint">
            This app keeps {size(used)} on this phone - videos waiting to be made, finished ones still on the list and
            the speech model. If picked videos don't show up, check Settings, General, iPhone Storage.
          </p>
        </>
      ) : null}

      <p className="footnote">
        {posting?.sendHere
          ? 'Finished videos go to your Postiz; everything else stays on this phone.'
          : 'Videos stay on this phone.'}{' '}
        Only setups are shared, and error details are sent when something fails. Version{' '}
        {__APP_VERSION__}
      </p>
    </section>
  )
}

