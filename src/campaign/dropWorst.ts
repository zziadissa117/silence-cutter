// "Stop using what doesn't work" (Analytics, his ask 2026-11-24: "after a
// certain amount of time, it asks me to only use certain songs or only use
// certain headlines because some really don't work"). Once a headline, song
// or headline look has been in enough of a batch's videos and still sits at
// the bottom (hookInsights marks it `worst`: under 3/4 of the campaign's
// views a video), Analytics asks once to drop it; one tap takes it out of
// the batch, so no new video uses it. Never the last one of a kind.

import type { CampaignHooks, HookRow } from '../../supabase/functions/postiz/hookInsights.ts'
import { bareName, looksOf, type BatchBank } from './batch'

/** Videos with their views read a row needs before it is judged worth
 *  dropping: a few unlucky ones say nothing. */
export const DROP_AFTER = 6

export interface ToDrop {
  headlines: HookRow[]
  songs: HookRow[]
  looks: HookRow[]
}

const wordsKey = (words: string) => words.trim().toLowerCase().replace(/\s+/g, ' ')

/** Every headline the batch uses: its own and each format's. */
function allHeadlines(bank: BatchBank): string[] {
  return [...bank.headlines, ...(bank.formats ?? []).flatMap((f) => f.headlines ?? [])]
}

const worst = (rows: readonly HookRow[]) => rows.filter((r) => r.mark === 'worst' && r.videos >= DROP_AFTER)

/** What to ask him to drop: the worst still in the batch, leaving at least
 *  one of each kind. */
export function worstToDrop(hooks: CampaignHooks | undefined, bank: BatchBank): ToDrop {
  if (!hooks) return { headlines: [], songs: [], looks: [] }
  const keep = (have: readonly string[], drop: HookRow[]): HookRow[] => (have.length - drop.length >= 1 ? drop : drop.slice(0, Math.max(0, have.length - 1)))
  const headlineKeys = new Set(allHeadlines(bank).filter((h) => h.trim()).map(wordsKey))
  const songKeys = new Set(bank.music.map((m) => bareName(m.name)))
  const lookKeys = new Set<string>(looksOf(bank).map((l) => l.look))
  const headlines = worst(hooks.rows.headline).filter((r) => headlineKeys.has(r.key))
  const songs = worst(hooks.rows.song).filter((r) => songKeys.has(r.key))
  const looks = worst(hooks.rows.look).filter((r) => lookKeys.has(r.key))
  return {
    headlines: keep([...headlineKeys], headlines),
    songs: keep([...songKeys], songs),
    looks: keep([...lookKeys], looks),
  }
}

export const anyToDrop = (d: ToDrop) => d.headlines.length + d.songs.length + d.looks.length > 0

/** The batch without them: new videos never use them again. */
export function withoutWorst(bank: BatchBank, drop: ToDrop): BatchBank {
  const headlines = new Set(drop.headlines.map((r) => r.key))
  const songs = new Set(drop.songs.map((r) => r.key))
  const looks = new Set(drop.looks.map((r) => r.key))
  const keepHeadline = (h: string) => !headlines.has(wordsKey(h))
  const next: BatchBank = {
    ...bank,
    headlines: bank.headlines.filter(keepHeadline),
    music: bank.music.filter((m) => !songs.has(bareName(m.name))),
    ...(bank.formats ? { formats: bank.formats.map((f) => (f.headlines ? { ...f, headlines: f.headlines.filter(keepHeadline) } : f)) } : {}),
  }
  if (looks.size > 0) {
    const left = looksOf(bank).filter((l) => !looks.has(l.look))
    if (left.length > 0) return { ...next, looks: left }
  }
  return next
}

/** The same list asked about again only once it changes. */
export function dropSignature(d: ToDrop): string {
  return [...d.headlines, ...d.songs, ...d.looks].map((r) => r.key).sort().join('|')
}

const ANSWERED_KEY = 'cutter.dropWorst'

/** "Not now": that list is not asked about again for this campaign. */
export function answeredDrop(campaignId: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(ANSWERED_KEY) ?? '{}') as Record<string, string>)[campaignId] ?? null
  } catch {
    return null
  }
}

export function rememberDrop(campaignId: string, signature: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(ANSWERED_KEY) ?? '{}') as Record<string, string>
    localStorage.setItem(ANSWERED_KEY, JSON.stringify({ ...all, [campaignId]: signature }))
  } catch {
    // Asked again next time.
  }
}

