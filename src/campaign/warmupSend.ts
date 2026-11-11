// Sends the warm-ups that are due (warmupPlan.ts) to the server, each to wait
// there for his yes at its time, with a notification (postiz warmupOf). Run
// when the app opens, every half hour while it is open, and when he films
// some or changes where they go. One run at a time.

import { NO_POSTING, type Campaign } from './look'
import { queueSend } from './outbox'
import { hoursHere, lastPosts, listPosts, placeFor, postingHere } from './posting'
import { bestOf, planWarmups } from './warmupPlan'
import { loadMade, madeFile, saveMade } from './warmups'

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
  const on = campaigns.filter((c) => c.warmups && c.warmups.perWeek > 0 && !c.general && placeFor(local.profile, c.id).accounts.length > 0)
  if (on.length === 0) return 0
  const made = await loadMade()
  if (!made.some((m) => !m.posted)) return 0
  const posts = await listPosts(true).catch(() => lastPosts())
  const plan = planWarmups({ campaigns: on, made, posts, bestHour: (_, date) => bestOf(hoursHere(dayOf(date))) })
  let sent = 0
  for (const p of plan) {
    const campaign = on.find((c) => c.id === p.campaignId)
    const file = await madeFile(p.made)
    if (!campaign || !file) continue
    const key = `warmup:${p.made.ideaId}:${p.made.id}`
    await queueSend(
      {
        key,
        profileId: local.profile.id,
        campaign: { id: campaign.id, name: campaign.name, posting: campaign.posting ?? NO_POSTING },
        meta: {
          transcript: '',
          headline: p.made.headline,
          duration: p.made.seconds,
          fileName: p.made.file.name,
          warmup: { idea: p.made.ideaId, at: p.at.toISOString() },
        },
      },
      file,
    )
    // Gone out: never again (his rule), whatever happens to the post.
    const now = await loadMade()
    await saveMade(now.map((m) => (m.id === p.made.id ? { ...m, posted: { campaignId: campaign.id, key, at: p.at.toISOString() } } : m)))
    sent++
  }
  return sent
}
