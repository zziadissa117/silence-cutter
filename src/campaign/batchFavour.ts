// "Use the best hooks" (Analytics): what a batch makes more of, from the
// server's numbers on what works (postiz/hookInsights.ts). His words
// (2026-11-01): a button that "makes a higher percentage of using those hooks
// than others, like the text, the headline, the music, and the reaction".
//
// The best of each - the ones the numbers mark `best` - go into the bank's
// `favour`; the mixing then brings each round FAVOUR times as often
// (batch.pickBatch). Once on, it follows the numbers by itself: each time
// they are read again, the favour is worked out afresh (CampaignApp).

import type { CampaignHooks, HookKind } from '../../supabase/functions/postiz/hookInsights.ts'
import { BATCH_LOOKS, type BatchBank, type BatchLook, type Favour } from './batch'

const best = (hooks: CampaignHooks, kind: HookKind) => hooks.rows[kind].filter((r) => r.mark === 'best').map((r) => r.key)

/** What the numbers say to make more of. */
export function favourFrom(hooks: CampaignHooks): Favour {
  return {
    headlines: best(hooks, 'headline'),
    looks: best(hooks, 'look').filter((l): l is BatchLook => (BATCH_LOOKS as readonly string[]).includes(l)),
    reactions: best(hooks, 'reaction'),
    songs: best(hooks, 'song'),
  }
}

/** Whether the numbers name anything best yet - a button with nothing to
 *  favour would do nothing. */
export function anyFavour(favour: Favour): boolean {
  return favour.headlines.length + favour.looks.length + favour.reactions.length + favour.songs.length > 0
}

const same = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

export function sameFavour(a: Favour | undefined, b: Favour | undefined): boolean {
  if (!a || !b) return a === b
  return same(a.headlines, b.headlines) && same(a.looks, b.looks) && same(a.reactions, b.reactions) && same(a.songs, b.songs)
}

/** The bank following the latest numbers, or null when nothing changes:
 *  only a bank with "Use the best hooks" on. */
export function followFavour(bank: BatchBank, hooks: CampaignHooks | undefined): BatchBank | null {
  if (!bank.useBest || !hooks) return null
  const next = favourFrom(hooks)
  return sameFavour(bank.favour, next) ? null : { ...bank, favour: next }
}
