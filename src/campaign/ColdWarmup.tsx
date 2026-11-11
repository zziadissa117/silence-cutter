// An account that stopped getting views (postiz/deadAccounts.ts): an extra
// warm-up on it - only after his yes (his words, 2026-11-11: "confirm with me
// first to either say yes or no"). Asked once each time it goes cold; asked
// again a week on if it still is (TELL_AGAIN_DAYS on the server).

import { useState } from 'react'

import type { DeadAccount } from '../../supabase/functions/postiz/deadAccounts.ts'
import type { Campaign } from './look'
import { placeFor, postingHere } from './posting'
import { sendExtraWarmup } from './warmupSend'

const ASKED_KEY = 'warmups:cold-asked'
/** Asked again after this, if the account is still cold. */
const ASK_AGAIN_MS = 7 * 24 * 3600_000

function asked(): Record<string, number> {
  try {
    const got = JSON.parse(localStorage.getItem(ASKED_KEY) ?? '{}') as unknown
    return got && typeof got === 'object' ? (got as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function markAsked(accountId: string): void {
  try {
    localStorage.setItem(ASKED_KEY, JSON.stringify({ ...asked(), [accountId]: Date.now() }))
  } catch {
    // Asked again next time.
  }
}

/** Whether to ask about this account now. */
export function askAbout(accountId: string, answered: Record<string, number> = asked(), now = Date.now()): boolean {
  const at = answered[accountId]
  return !at || now - at > ASK_AGAIN_MS
}

/** The campaign a cold account posts for: the first one he has it on. */
export function campaignOf(accountId: string, campaigns: readonly Campaign[]): Campaign | null {
  const profile = postingHere()?.profile
  return campaigns.find((c) => !c.general && !c.trial && placeFor(profile, c.id).accounts.includes(accountId)) ?? null
}

/** "Post an extra warm-up on it?" Yes / No - for one cold account. */
export function ColdWarmupAsk({ account, campaigns }: { account: Pick<DeadAccount, 'id'>; campaigns: readonly Campaign[] }) {
  const [shown, setShown] = useState(() => askAbout(account.id))
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const campaign = campaignOf(account.id, campaigns)
  if (said) return <p className="hint">{said}</p>
  if (!shown || !campaign) return null
  const yes = () => {
    setBusy(true)
    void sendExtraWarmup(campaign, account.id)
      .then((sent) => {
        if (!sent) {
          setSaid('No filmed warm-up can go there yet - film a few in More → Warm-ups, then ask again.')
          return
        }
        markAsked(account.id)
        const when = sent.at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
        setSaid(`"${sent.made.title}" goes out ${when} on this account only - approve it in Posts.`)
      })
      .catch((error: unknown) => setSaid(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  const no = () => {
    markAsked(account.id)
    setShown(false)
  }
  return (
    <div className="cold-warmup">
      <span className="hint">Post an extra warm-up on it?</span>
      <button type="button" className="btn small primary" disabled={busy} onClick={yes}>
        {busy ? '…' : 'Yes'}
      </button>
      <button type="button" className="btn small" disabled={busy} onClick={no}>
        No
      </button>
    </div>
  )
}
