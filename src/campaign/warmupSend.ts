// Sends the warm-ups that are due (warmupPlan.ts) to the server, each to wait
// there for his yes at its time, with a notification (postiz warmupOf). Run
// when the app opens, every half hour while it is open, and when he films
// some or changes where they go. One run at a time.

import { NO_POSTING, type Campaign } from './look'
import { queueSend } from './outbox'
import { hoursHere, lastPosts, listPosts, placeFor, postingHere } from './posting'
import { QUIET_MS, bestOf, planExtra, planWarmups, quietAccounts, type PlannedWarmup } from './warmupPlan'
import { loadMade, madeFile, saveMade, type MadeWarmup } from './warmups'

let running: Promise<number> | null = null

const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The warm-ups due within a week, sent. How many went. */
export function sendDueWarmups(campaigns: readonly Campaign[]): Promise<number> {
  running ??= sendNow(campaigns).finally(() => {
    running = null
  })
  return running
}

async function sendNow(campaigns: readonly Campaign[]): Promise<number> {
  const local = postingHere()
  if (!local) return 0
  const posting = campaigns.filter((c) => !c.general && !c.trial && placeFor(local.profile, c.id).accounts.length > 0)
  if (posting.length === 0) return 0
  const firstSeen = seenAccounts(posting.flatMap((c) => placeFor(local.profile, c.id).accounts))
  const made = await loadMade()
  if (!made.some((m) => !m.posted)) return 0
  const posts = await listPosts(true).catch(() => lastPosts())
  const on = posting.filter((c) => c.warmups && c.warmups.perWeek > 0)
  const plan = planWarmups({ campaigns: on, made, posts, bestHour: (_, date) => bestOf(hoursHere(dayOf(date))) })
  let sent = 0
  for (const p of plan) {
    const campaign = on.find((c) => c.id === p.campaignId)
    if (campaign && (await sendOne(local.profile.id, campaign, p))) sent++
  }
  // An account he forgot for a day: a warm-up on it, on top of the rest.
  const paused = local.profile.settings.limits?.accounts ?? {}
  const covered = coveredAccounts()
  const quiet = quietAccounts({
    campaigns: posting.map((c) => ({ id: c.id, accounts: placeFor(local.profile, c.id).accounts.filter((a) => !paused[a]?.paused) })),
    posts,
    since: (id) => firstSeen[id] ?? Date.now(),
  }).filter((q) => !covered[q.accountId] || Date.now() - covered[q.accountId] > QUIET_MS)
  for (const q of quiet) {
    const campaign = posting.find((c) => c.id === q.campaignId)
    if (!campaign) continue
    const went = await sendExtraWarmup(campaign, q.accountId).catch(() => null)
    if (!went) continue
    markCovered(q.accountId)
    sent++
  }
  return sent
}

// Kept on this phone: when each account was first seen in a campaign (one
// new to the Cutter waits a day before it counts as forgotten), and when a
// forgotten one last got a warm-up (never two for the same quiet day).
const SEEN_KEY = 'warmups:seen'
const COVERED_KEY = 'warmups:quiet'

function readMap(key: string): Record<string, number> {
  try {
    const got = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown
    return got && typeof got === 'object' ? (got as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeMap(key: string, map: Record<string, number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    // Worked out again next time.
  }
}

function seenAccounts(ids: readonly string[]): Record<string, number> {
  const seen = readMap(SEEN_KEY)
  let changed = false
  for (const id of ids) {
    if (seen[id]) continue
    seen[id] = Date.now()
    changed = true
  }
  if (changed) writeMap(SEEN_KEY, seen)
  return seen
}

function coveredAccounts(): Record<string, number> {
  return readMap(COVERED_KEY)
}

function markCovered(accountId: string): void {
  writeMap(COVERED_KEY, { ...readMap(COVERED_KEY), [accountId]: Date.now() })
}

/** One warm-up to the server, then marked gone out - never again (his
 *  rule), whatever happens to the post. */
async function sendOne(profileId: string, campaign: Campaign, p: PlannedWarmup, only?: string): Promise<boolean> {
  const file = await madeFile(p.made)
  if (!file) return false
  const key = `warmup:${p.made.ideaId}:${p.made.id}`
  await queueSend(
    {
      key,
      profileId,
      campaign: { id: campaign.id, name: campaign.name, posting: campaign.posting ?? NO_POSTING },
      meta: {
        transcript: '',
        headline: p.made.headline,
        duration: p.made.seconds,
        fileName: p.made.file.name,
        warmup: { idea: p.made.ideaId, at: p.at.toISOString(), ...(only ? { only } : {}) },
      },
    },
    file,
  )
  const now = await loadMade()
  await saveMade(now.map((m) => (m.id === p.made.id ? { ...m, posted: { campaignId: campaign.id, key, at: p.at.toISOString() } } : m)))
  return true
}

/** An extra warm-up on one account that went cold, after his yes: on that
 *  account only, at its next best hour, waiting for his OK like the rest.
 *  What went out, or null when none of his filmed ones can go there. */
export async function sendExtraWarmup(campaign: Campaign, accountId: string): Promise<{ made: MadeWarmup; at: Date } | null> {
  const local = postingHere()
  if (!local) return null
  const made = await loadMade()
  const posts = await listPosts(true).catch(() => lastPosts())
  const p = planExtra({ campaign, made, posts, bestHour: (date) => bestOf(hoursHere(dayOf(date))) })
  if (!p || !(await sendOne(local.profile.id, campaign, p, accountId))) return null
  return { made: p.made, at: p.at }
}
