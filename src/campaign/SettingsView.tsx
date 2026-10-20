// The Settings tab: the few things set once and rarely touched - sharing,
// posting, how tight the cut is, whether "um"s go too, and the voice.

import { useEffect, useState } from 'react'

import type { PresetName } from '../media/silenceMath'
import type { Session, SyncState } from './cloud'
import { savedTheme, savedTips, setTheme, setTips, type Theme } from '../theme'
import { cleanEngineUrl, engineStatus, engineUrl, setEngineUrl } from './engine'
import { bringBack, connectServer, serverStatus, serverUrl, setServerUrl } from './serverLink'
import { loadBatchBank } from './store'
import { DEFAULT_WINDOW } from '../../supabase/functions/postiz/window.ts'
import { onFixedTimes, switchToRandom, windowLabel, type LocalPosting, type Profile } from './posting'
import {
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  defaultCaptionPosition,
  defaultCaptionSize,
  setDefaultCaptionPosition,
  setDefaultCaptionSize,
  type CaptionPosition,
  type CaptionSize,
} from './captions'
import { PRESET_EFFECTS, defaultEffects, presetOf, setDefaultEffects, type DefaultPreset } from './defaultEffects'
import type { AngleEffects, EffectLevel } from './effects'
import { cutNoiseOn, setCutNoise } from './noiseSetting'
import { LANDSCAPE_MODES, landscapeMode, setLandscapeMode, type LandscapeMode } from './framing916'
import { PostingLimits, PostingLimitsRow } from './PostingLimits'
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

const EFFECT_LEVELS: EffectLevel[] = ['off', 'subtle', 'strong']
const PRESET_NAMES: DefaultPreset[] = ['off', 'subtle', 'strong']

function DefaultEffectsSetting() {
  const [effects, setEffects] = useState<AngleEffects>(defaultEffects)
  const change = (next: AngleEffects) => {
    setDefaultEffects(next)
    setEffects(next)
  }
  const preset = presetOf(effects)
  const level = (key: 'cutPunch' | 'hookPush' | 'brandHit', label: string) => (
    <label className="field inline">
      <span className="label">{label}</span>
      <select value={effects[key]} onChange={(e) => change({ ...effects, [key]: e.target.value as EffectLevel })}>
        {EFFECT_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l[0].toUpperCase() + l.slice(1)}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <>
      <div className="list-title">Default effects</div>
      <div className="seg full" role="radiogroup" aria-label="Default effects">
        {PRESET_NAMES.map((name) => (
          <button key={name} type="button" role="radio" aria-checked={preset === name} className={preset === name ? 'active' : ''} onClick={() => change(PRESET_EFFECTS[name])}>
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      <p className="hint tip">
        Applied to every video whose angle has no effects of its own{preset === null ? ' (custom mix below)' : ''}. Turn them off for one video in its row. Applies to videos you make next.
      </p>
      <div className="card-group">
        {level('cutPunch', 'Punch-in at cuts')}
        {level('hookPush', 'Push-in under the hook')}
        {level('brandHit', 'Punch when you say the brand')}
        <label className="toggle">
          <input type="checkbox" checked={effects.logoPop} onChange={(e) => change({ ...effects, logoPop: e.target.checked })} />
          <span className="label">Logo and pictures spring in</span>
        </label>
      </div>
    </>
  )
}

function NoiseCutting() {
  const [on, setOn] = useState(cutNoiseOn)
  return (
    <>
      <div className="list-title">Noises</div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setCutNoise(e.target.checked)
            setOn(e.target.checked)
          }}
        />
        <span>
          <span className="label">Also cut sounds that aren't speech (off by default)</span>
          <span className="hint tip" style={{ display: 'block' }}>
            Coughs, bumps and room noise go as well as the pauses. Leave it off for the plain cut that always worked. It never
            cuts a word it heard, listens a second time to anything it is unsure about, and lists what it cut so you can
            listen and put it back. Takes a little longer: every video is listened to.
          </span>
        </span>
      </label>
    </>
  )
}

function CaptionPlace() {
  const [position, setPosition] = useState<CaptionPosition>(defaultCaptionPosition)
  const [size, setSize] = useState<CaptionSize>(defaultCaptionSize)
  return (
    <>
      <div className="seg full" role="radiogroup" aria-label="Where captions sit">
        {CAPTION_POSITIONS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={position === p.id}
            className={position === p.id ? 'active' : ''}
            onClick={() => {
              setDefaultCaptionPosition(p.id)
              setPosition(p.id)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="seg full" role="radiogroup" aria-label="How big captions are" style={{ marginTop: 8 }}>
        {CAPTION_SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={size === s.id}
            className={size === s.id ? 'active' : ''}
            onClick={() => {
              setDefaultCaptionSize(s.id)
              setSize(s.id)
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="hint tip">Where and how big captions start on each video. You can change both for one video while checking its captions.</p>
    </>
  )
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
      <p className="hint tip">
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
  campaigns,
  onPlacesChanged,
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
  campaigns: readonly { id: string; name: string }[]
  /** Campaigns were switched to random times; the saved profile changed. */
  onPlacesChanged: () => void
}) {
  const used = useSpaceUsed()
  const [limitsOpen, setLimitsOpen] = useState(false)
  if (limitsOpen && posting) {
    return <PostingLimits profile={posting.profile} onChanged={onLimitsChanged} onBack={() => setLimitsOpen(false)} />
  }
  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Settings</h1>
      </div>

      <Appearance />

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
          <div className="card-group">
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
              <span className="hint tip" style={{ display: 'block' }}>
                Each one goes to Postiz with a caption, for the campaigns with accounts picked.
              </span>
            </span>
          </label>
          <RandomForAll profile={posting.profile} campaigns={campaigns} onChanged={onPlacesChanged} />
          <PostingLimitsRow profile={posting.profile} onOpen={() => setLimitsOpen(true)} />
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

      {posting ? <ServerSetting campaignIds={Object.keys(posting.profile.settings.campaigns ?? {})} /> : null}
      {/* Le plateau's engine: only for a phone that already uses it - the
          Cutter server above makes the same batches as this phone. */}
      {posting && engineUrl() ? <EngineSetting /> : null}

      <NoiseCutting />

      <div className="list-title">Pacing</div>
      <div className="seg full" role="radiogroup" aria-label="Pacing">
        {PRESET_ORDER.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={preset === p} className={preset === p ? 'active' : ''} onClick={() => onPreset(p)}>
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      <p className="hint tip">{PRESET_HINT[preset]} Applies to videos you add next.</p>

      <DefaultEffectsSetting />

      <WideClips />

      <div className="list-title">Captions</div>
      <CaptionPlace />
      <div className="card-group">
      <label className="toggle">
        <input type="checkbox" checked={captions} onChange={(e) => onCaptions(e.target.checked)} />
        <span>
          <span className="label">Captions on the videos</span>
          <span className="hint tip" style={{ display: 'block' }}>
            One word at a time as you say it. You check them before each video is made.
          </span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={bareCaptions} disabled={!captions} onChange={(e) => onBareCaptions(e.target.checked)} />
        <span>
          <span className="label">Leave out punctuation</span>
          <span className="hint tip" style={{ display: 'block' }}>
            No ? or ! either - commas and full stops are always left off. "Don't" and "2.5" stay as they are.
          </span>
        </span>
      </label>
      </div>

      <div className="list-title">Speech</div>
      <div className="card-group">
      <label className="toggle">
        <input type="checkbox" checked={voice} onChange={(e) => onVoice(e.target.checked)} />
        <span>
          <span className="label">Make my voice louder and clearer</span>
          <span className="hint tip" style={{ display: 'block' }}>
            Evens it out and brings it to normal TikTok loudness, never past a safe level.
          </span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={cleanSpeech} onChange={(e) => onCleanSpeech(e.target.checked)} />
        <span>
          <span className="label">Also cut "um"s and stumbles</span>
          <span className="hint tip" style={{ display: 'block' }}>
            Uses more memory. If a video keeps stopping the page, turn it off.
          </span>
        </span>
      </label>
      </div>

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


/** The Cutter server's address (server/ on Railway): once connected, every
 *  batch is made there (serverLink.ts). */
function ServerSetting({ campaignIds }: { campaignIds: string[] }) {
  const [url, setUrl] = useState(() => serverUrl() ?? '')
  const [line, setLine] = useState<{ text: string; bad: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const connected = Boolean(serverUrl())
  useEffect(() => {
    if (!serverUrl()) return
    let alive = true
    void serverStatus()
      .then((status) => {
        if (!alive) return
        const making = Object.values(status.page?.making ?? {}).reduce((n, m) => n + m.queued + (m.now ? 1 : 0), 0)
        setLine({
          text: `Connected · ${status.freeGB ?? '?'} GB free · ${making > 0 ? `making ${making}` : status.chrome === 'running' ? 'waiting for the next days' : 'starting'}`,
          bad: false,
        })
      })
      .catch((error: unknown) => alive && setLine({ text: error instanceof Error ? error.message : String(error), bad: true }))
    return () => {
      alive = false
    }
  }, [])
  const connect = async () => {
    const clean = cleanEngineUrl(url)
    if (!clean) {
      setLine({ text: "That isn't a web address - paste the one Railway gives the server (https://…).", bad: true })
      return
    }
    setBusy(true)
    setUrl(clean)
    const before = serverUrl()
    setServerUrl(clean)
    try {
      const done = await connectServer()
      setLine({ text: `Connected · ${done.freeGB ?? '?'} GB free. Your batches are made there from now on - the clips go up while the app is open.`, bad: false })
    } catch (error) {
      setServerUrl(before)
      setLine({ text: error instanceof Error ? error.message : String(error), bad: true })
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    if (!window.confirm('Make the batches on this phone again? The server stops making them; what it already made stays in Posts.')) return
    setBusy(true)
    try {
      for (const id of campaignIds) {
        if ((await loadBatchBank(id))?.where === 'server') await bringBack(id, { jobs: () => [], removeJob: () => {} })
      }
      setServerUrl(null)
      setUrl('')
      setLine(null)
    } catch (error) {
      setLine({ text: `${error instanceof Error ? error.message : String(error)} Try again with signal.`, bad: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="list-title">Server</div>
      <div className="setting engine-setting">
        <div className="setting-text">
          <input
            type="url"
            className="find"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://your-cutter.up.railway.app"
            aria-label="Server address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {line ? <span className={`row-line wrap${line.bad ? ' warn-text' : ''}`}>{line.text}</span> : null}
          <span className="hint tip" style={{ display: 'block' }}>
            Makes your batches on a server, day and night, with the phone closed - the same videos as here.
          </span>
        </div>
        <button type="button" className="btn small primary" disabled={busy || !url.trim()} onClick={() => void connect()}>
          {busy ? 'Checking…' : connected ? 'Check' : 'Connect'}
        </button>
      </div>
      {connected ? (
        <button type="button" className="linkbtn" disabled={busy} onClick={() => void disconnect()}>
          Make batches on this phone again
        </button>
      ) : null}
    </>
  )
}

/** The engine's address (engine/ on Railway), checked against it with this login. */
function EngineSetting() {
  const [url, setUrl] = useState(() => engineUrl() ?? '')
  const [line, setLine] = useState<{ text: string; bad: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    const clean = cleanEngineUrl(url)
    if (!clean) {
      setLine({ text: "That isn't a web address - paste the one Railway gives the engine (https://…).", bad: true })
      return
    }
    setBusy(true)
    setEngineUrl(clean)
    setUrl(clean)
    try {
      const status = await engineStatus()
      setLine({
        text: `Connected · ${status.disk.freeGB} GB free · ${status.claude ? 'Claude rewords hooks' : 'no Claude key, hooks as written'}`,
        bad: false,
      })
    } catch (error) {
      setLine({ text: error instanceof Error ? error.message : String(error), bad: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="list-title">Engine</div>
      <div className="setting engine-setting">
        <div className="setting-text">
          <input
            type="url"
            className="find"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://your-engine.up.railway.app"
            aria-label="Engine address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {line ? <span className={`row-line wrap${line.bad ? ' warn-text' : ''}`}>{line.text}</span> : null}
          <span className="hint tip" style={{ display: 'block' }}>
            Makes big batches on a server, with the phone closed - Batch, On the engine.
          </span>
        </div>
        <button type="button" className="btn small primary" disabled={busy || !url.trim()} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </div>
      {engineUrl() ? (
        <button
          type="button"
          className="linkbtn"
          onClick={() => {
            setEngineUrl(null)
            setUrl('')
            setLine(null)
          }}
        >
          Disconnect the engine
        </button>
      ) : null}
    </>
  )
}

/** Light or dark (or as the phone is), and whether the explanations show. */
function Appearance() {
  const [theme, setThemeState] = useState<Theme>(savedTheme)
  const [tips, setTipsState] = useState(savedTips)
  return (
    <>
      <div className="list-title">Appearance</div>
      <div className="seg full" role="radiogroup" aria-label="Appearance">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            className={theme === t.id ? 'active' : ''}
            onClick={() => {
              setTheme(t.id)
              setThemeState(t.id)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={tips}
          onChange={(e) => {
            setTips(e.target.checked)
            setTipsState(e.target.checked)
          }}
        />
        <span className="label">Show tips</span>
      </label>
    </>
  )
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'Automatic' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

/** Every campaign posts at random unless he gave it fixed times; this
 *  switches the ones he did, in one tap. */
function RandomForAll({
  profile,
  campaigns,
  onChanged,
}: {
  profile: Profile
  campaigns: readonly { id: string; name: string }[]
  onChanged: () => void
}) {
  const fixed = onFixedTimes(profile, campaigns)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="row-name">Random times for every campaign</span>
        <span className={`row-line wrap${problem ? ' error' : ''}`}>
          {problem ??
            (fixed.length === 0
              ? 'Every campaign posts at a different random time each day, inside its own window.'
              : `${fixed.map((c) => c.name).join(', ')} still ${fixed.length === 1 ? 'uses' : 'use'} your own times. Others post at random (${windowLabel(DEFAULT_WINDOW)} unless you change it in their Posting).`)}
        </span>
      </div>
      {fixed.length > 0 ? (
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Switch ${fixed.map((c) => c.name).join(', ')} to random times? Each gets ${windowLabel(DEFAULT_WINDOW)} unless it already had a window. Change any of them in its Posting.`)) return
            setBusy(true)
            setProblem(null)
            switchToRandom(profile, campaigns)
              .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
              .finally(() => {
                setBusy(false)
                onChanged()
              })
          }}
        >
          {busy ? 'Switching...' : 'Switch all'}
        </button>
      ) : null}
    </div>
  )
}
