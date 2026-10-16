// Pausing a platform, and capping how many it gets a day. Each platform - and
// each account within it - has its own switch and its own limit, so slowing
// one never slows another. A paused or full account's posts are held, not
// dropped: they go out by themselves once it is free.
//
// Its own page, opened from one row in Settings: with every account listed it
// took most of the Settings screen.

import { useEffect, useState } from 'react'

import { ChevronLeft, ChevronRight } from './icons'
import { PostingError, handleOf, platformName, saveLimits, type Limit, type Limits, type PostizAccount, type Profile } from './posting'

/** One line for the Settings row: what is paused or capped, or that nothing is. */
export function limitsLine(profile: Profile): string {
  const limits = profile.settings.limits ?? {}
  const platforms = new Set(profile.accounts.map((a) => a.platform))
  const paused = [...platforms].filter((p) => limits.platforms?.[p]?.paused).map(platformName)
  const accounts = new Set(profile.accounts.map((a) => a.id))
  const pausedAccounts = Object.entries(limits.accounts ?? {}).filter(([id, l]) => accounts.has(id) && l.paused).length
  const capped =
    [...platforms].filter((p) => limits.platforms?.[p]?.perDay !== undefined).length +
    Object.entries(limits.accounts ?? {}).filter(([id, l]) => accounts.has(id) && l.perDay !== undefined).length
  const parts = [
    paused.length > 0 ? `${paused.join(', ')} paused` : '',
    pausedAccounts > 0 ? `${pausedAccounts} account${pausedAccounts === 1 ? '' : 's'} paused` : '',
    capped > 0 ? `${capped} with a daily limit` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing paused, no daily limits'
}

/** The row in Settings that opens the page. */
export function PostingLimitsRow({ profile, onOpen }: { profile: Profile; onOpen: () => void }) {
  if (profile.accounts.length === 0) return null
  const line = limitsLine(profile)
  return (
    <ul className="rows">
      <li>
        <button type="button" className="row-link" onClick={onOpen}>
          <span className="row-text">
            <span className="row-name">Pause and daily limits</span>
            <span className={`row-line${line.includes('paused') ? ' warn-text' : ''}`}>{line}</span>
          </span>
          <ChevronRight />
        </button>
      </li>
    </ul>
  )
}

/** "@kari.ugc" inside its platform's card - the platform is the card's title. */
function shortName(account: PostizAccount): string {
  const handle = handleOf(account)
  return handle ? `@${handle}` : account.name
}

export function PostingLimits({
  profile,
  onChanged,
  onBack,
}: {
  profile: Profile
  onChanged: (profile: Profile) => void
  onBack: () => void
}) {
  const [limits, setLimits] = useState<Limits>(profile.settings.limits ?? {})
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Opened from far down Settings: start at the top.
  useEffect(() => window.scrollTo(0, 0), [])

  const platforms = [...new Set(profile.accounts.map((a) => a.platform))]

  const put = async (next: Limits) => {
    setLimits(next)
    setProblem(null)
    setSaving(true)
    try {
      onChanged(await saveLimits(next))
    } catch (error) {
      setProblem(error instanceof PostingError || error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const change = (group: 'platforms' | 'accounts', key: string, patch: Limit) => {
    const current = limits[group]?.[key] ?? {}
    const merged: Limit = { ...current, ...patch }
    if (!merged.paused) delete merged.paused
    if (merged.perDay === undefined || Number.isNaN(merged.perDay)) delete merged.perDay
    const rest = { ...limits[group] }
    if (merged.paused || merged.perDay !== undefined) rest[key] = merged
    else delete rest[key]
    void put({ ...limits, [group]: rest })
  }

  const row = (group: 'platforms' | 'accounts', key: string, name: string, label: string) => {
    const here = limits[group]?.[key]
    return (
      <li key={key} className="limit-row">
        <span className="limit-name">
          <span className="limit-title">{name}</span>
          {here?.paused ? <span className="limit-state warn-text">Paused - its videos wait</span> : null}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={50}
          className="limit-input"
          aria-label={`${label} - most posts a day`}
          placeholder="-"
          defaultValue={here?.perDay ?? ''}
          onBlur={(e) => {
            const raw = e.target.value.trim()
            const n = raw === '' ? undefined : Number(raw)
            if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 50)) {
              setProblem('A limit is a whole number from 0 to 50, or empty for no limit.')
              return
            }
            if (n !== here?.perDay) change(group, key, { perDay: n })
          }}
        />
        <span className="limit-unit">a day</span>
        <label className="toggle limit-switch">
          <input
            type="checkbox"
            aria-label={`Pause ${label}`}
            checked={Boolean(here?.paused)}
            onChange={(e) => change(group, key, { paused: e.target.checked })}
          />
        </label>
      </li>
    )
  }

  return (
    <section className="screen">
      <button type="button" className="back" onClick={onBack}>
        <ChevronLeft /> Settings
      </button>
      <div className="screen-head">
        <h2>Pause and daily limits</h2>
      </div>
      <p className="lede">
        The switch pauses; the number is the most posts a day (empty: no limit). Held videos wait and go out by themselves once
        it is free - nothing is lost.
      </p>
      {problem ? <div className="error">{problem}</div> : null}
      {platforms.map((platform) => {
        const accounts = profile.accounts.filter((a) => a.platform === platform)
        return (
          <div key={platform} className="limit-group">
            <div className="list-title">{platformName(platform)}</div>
            <ul className="limit-card">
              {row('platforms', platform, `All of ${platformName(platform)}`, platformName(platform))}
              {accounts.length > 1 || accounts.some((a) => limits.accounts?.[a.id])
                ? accounts.map((account) => row('accounts', account.id, shortName(account), `${shortName(account)} on ${platformName(platform)}`))
                : null}
            </ul>
          </div>
        )
      })}
      {saving ? <p className="hint">Saving…</p> : null}
    </section>
  )
}
