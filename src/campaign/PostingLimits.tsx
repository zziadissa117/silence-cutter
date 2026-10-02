// Pausing a platform, and capping how many it gets a day. Each platform - and
// each account within it - has its own switch and its own limit, so slowing
// one never slows another. A paused or full account's posts are held, not
// dropped: they go out by themselves once it is free.

import { useState } from 'react'

import { PostingError, accountLabel, platformName, saveLimits, type Limit, type Limits, type Profile } from './posting'

export function PostingLimits({ profile, onChanged }: { profile: Profile; onChanged: (profile: Profile) => void }) {
  const [limits, setLimits] = useState<Limits>(profile.settings.limits ?? {})
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const platforms = [...new Set(profile.accounts.map((a) => a.platform))]
  if (profile.accounts.length === 0) return null

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
    const rest = { ...(limits[group] ?? {}) }
    if (merged.paused || merged.perDay !== undefined) rest[key] = merged
    else delete rest[key]
    void put({ ...limits, [group]: rest })
  }

  const dayInput = (group: 'platforms' | 'accounts', key: string, label: string) => (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={50}
      className="limit-input"
      aria-label={label}
      placeholder="no limit"
      defaultValue={limits[group]?.[key]?.perDay ?? ''}
      onBlur={(e) => {
        const raw = e.target.value.trim()
        const n = raw === '' ? undefined : Number(raw)
        if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 50)) {
          setProblem('A limit is a whole number from 0 to 50, or empty for no limit.')
          return
        }
        if (n !== limits[group]?.[key]?.perDay) change(group, key, { perDay: n })
      }}
    />
  )

  return (
    <div className="posting-limits">
      <div className="row-name">Pause and daily limits</div>
      <span className="row-line wrap">
        Pause a platform or cap its posts a day. Its videos wait and go out by themselves once it is free - nothing is lost. The other
        platforms keep their own pace.
      </span>
      {platforms.map((platform) => {
        const accounts = profile.accounts.filter((a) => a.platform === platform)
        const here = limits.platforms?.[platform]
        return (
          <div key={platform} className="limit-group">
            <div className="limit-row">
              <label className="toggle">
                <input type="checkbox" checked={Boolean(here?.paused)} onChange={(e) => change('platforms', platform, { paused: e.target.checked })} />
                <span className="label">{here?.paused ? `${platformName(platform)} paused` : `Pause ${platformName(platform)}`}</span>
              </label>
              <span className="hint">max a day</span>
              {dayInput('platforms', platform, `${platformName(platform)} posts a day`)}
            </div>
            {accounts.length > 1 || accounts.some((a) => limits.accounts?.[a.id]) ? (
              <div className="limit-accounts">
                {accounts.map((account) => (
                  <div key={account.id} className="limit-row">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(limits.accounts?.[account.id]?.paused)}
                        onChange={(e) => change('accounts', account.id, { paused: e.target.checked })}
                      />
                      <span className="label">{accountLabel(account)}</span>
                    </label>
                    <span className="hint">max a day</span>
                    {dayInput('accounts', account.id, `${accountLabel(account)} posts a day`)}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      {saving ? <span className="hint">Saving…</span> : null}
      {problem ? <div className="error">{problem}</div> : null}
    </div>
  )
}
