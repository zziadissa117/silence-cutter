// The time zone a login's posting times are in (his ask, 2026-11-28: "some
// people could be in other countries ... make it so the current posting
// hours are really specified to the time zone"). Each login has its own,
// set from its phone when it first connected. Here it is said plainly, any
// zone can be picked, and when the phone is somewhere else than the times it
// is offered in one tap - never changed by itself: two people on one Postiz
// in two countries would otherwise keep moving each other's times.

import { useState } from 'react'

import { PostingError, phoneZone, saveTimezone, type Profile } from './posting'

/** "Toronto", "Paris", "Sao Paulo": the city part of a zone, as a person says it. */
export function zoneLabel(zone: string): string {
  const city = zone.split('/').pop() ?? zone
  return city.replace(/_/g, ' ')
}

/** "UTC-5", "UTC+1", "UTC+5:30" at this moment in that zone. */
export function zoneOffset(zone: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')
    return (part?.value ?? 'GMT').replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0')
  } catch {
    return ''
  }
}

/** Every zone the phone knows, or a short list on an older one. */
export function allZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone')
    if (list && list.length > 0) return list
  } catch {
    // The short list below.
  }
  return ['America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Halifax', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Casablanca', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC']
}

/** The time now in a zone, "3:42 PM". */
function nowIn(zone: string): string {
  try {
    return new Date().toLocaleTimeString(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Two zones on the same clock right now (Toronto and New York): no need to ask. */
export function sameClock(a: string, b: string, at = new Date()): boolean {
  return zoneOffset(a, at) === zoneOffset(b, at)
}

export function TimeZoneCard({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const zone = profile.timezone || 'UTC'
  const here = phoneZone()
  const elsewhere = here !== zone && !sameClock(here, zone)

  const save = async (next: string) => {
    setBusy(true)
    setSaid(null)
    try {
      await saveTimezone(next)
      setPicking(false)
      onChanged()
    } catch (error) {
      setSaid(error instanceof PostingError ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setting time-zone">
      <div className="setting-text">
        <span className="row-name">Time zone</span>
        <span className="row-line wrap">
          Every posting time is {zoneLabel(zone)} time ({zoneOffset(zone)}, now {nowIn(zone)}).
        </span>
        {elsewhere ? (
          <span className="row-line wrap warn-text">
            This phone is on {zoneLabel(here)} time ({zoneOffset(here)}, now {nowIn(here)}).
          </span>
        ) : null}
        {said ? <span className="row-line wrap warn-text">{said}</span> : null}
        {picking ? (
          <select className="zone-pick" value={zone} disabled={busy} onChange={(e) => void save(e.target.value)} aria-label="Time zone">
            {(allZones().includes(zone) ? allZones() : [zone, ...allZones()]).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')} ({zoneOffset(z)})
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="actions-row">
        {elsewhere ? (
          <button type="button" className="btn small primary" disabled={busy} onClick={() => void save(here)}>
            Use {zoneLabel(here)} time
          </button>
        ) : null}
        {!picking ? (
          <button type="button" className="btn small" disabled={busy} onClick={() => setPicking(true)}>
            Change
          </button>
        ) : null}
      </div>
    </div>
  )
}
