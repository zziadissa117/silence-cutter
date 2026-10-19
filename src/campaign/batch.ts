// The Batch tab: a campaign's bank of reactions (they go first, with the
// headline), product showcases, headlines and music, mixed into videos made
// days ahead - so many a day, on the campaign's own posting times - each
// waiting for his approval.
//
// The mixing makes every combination of reaction, product, headline, track
// and headline look once before any is made twice, in a different order each time, and
// keeps each of them coming round evenly; the same reaction never follows
// itself. What was made is kept, so the next batch carries on where this
// one left off.

import type { HeadlineStyle } from './look'

/** A file in the bank, kept on this phone only - his own footage. */
export interface BankFile {
  id: string
  name: string
  type: string
  size: number
  seconds?: number
  /** Content fingerprint (fingerprint.ts), so the same recording is never
   *  kept twice. Absent on files kept before it existed; those are matched on
   *  name and size instead. */
  fp?: string
}

export interface BatchBank {
  campaignId: string
  /** The angle whose headline look the videos take. */
  angleId: string
  reactions: BankFile[]
  products: BankFile[]
  headlines: string[]
  music: BankFile[]
  perDay: number
  /** No longer used: the batch keeps going (batchRun.ts) instead of being
   *  made for a number of days. Kept so banks saved before still load. */
  days: number
  /** The batch keeps going (batchRun.ts): the next days are made whenever
   *  the app is open, until every different video is made or he stops it. */
  running?: boolean
  /** How many videos the batch has put on each day still to come, by date. */
  filled?: Record<string, number>
  /** Why the last top-up couldn't be made, until one is. */
  runProblem?: string
  /** Views a video at which Analytics suggests more a day (analytics.ts);
   *  none: it goes by the trend only. */
  viewTarget?: number
  /** The hooks his videos take turns between, each with its share: headlines
   *  in the three looks (the step names follow) and Claude + X (looksOf,
   *  looksToMix). None: headlines in the angle's look. */
  looks?: LookShare[]
  /** The headline looks picked before Claude + X and shares could be; read
   *  by looksOf. */
  headlineStyles?: HeadlineStyle[]
  /** The one look picked before several could be; read by looksOf. */
  headlineStyle?: HeadlineStyle
  /** How often each item has gone into a video: files by id, headlines by
   *  their words. */
  used: Record<string, number>
  /** The reaction and product of the last video made, never next to itself. */
  lastPair?: string
  /** Every combination made this round, so none is made twice before all
   *  have been. */
  made?: string[]
  /** The last day a batch has been made for. */
  madeThrough?: string
  /** No longer used (batches stacked on top of each other, before a batch
   *  kept going). */
  stack?: boolean
  /** How many a day the batches made before days were counted (`filled`)
   *  put on each of their days. */
  lastPerDay?: number
  /** Every different video its reactions and products could make has been
   *  made, so they were cleared out for new footage: how many videos that
   *  was, and the day the last of them posts. */
  spent?: { videos: number; through: string }
  /** The hook over each reaction before looks could be mixed: one of the
   *  headlines (absent), or the "Claude + X = $ a day" formula. Read by
   *  looksOf; a bank saved since keeps `looks`. */
  hook?: BatchHook
  formula?: BatchFormula
  /** How each video is put together: the reaction then the product (absent),
   *  or green screen - the product playing behind him, cut out in a corner. */
  layout?: BatchLayout
  /** Green screen: which corner he is in, and how big. */
  corner?: { side: 'left' | 'right'; sizePct: number }
  /** On the engine: the batch it is making now, to follow. */
  engineJob?: string
  /** The campaign's product showcase in order (Set order): each step its own
   *  clips, one of them in every video - the moment something happens in it
   *  (stepPiece.ts) - the steps always in this order after the reaction.
   *  None: the one list of product showcases, each played whole. */
  steps?: BatchStep[]
}

/** One step of a campaign's product showcase - "Claude", "The app", "The
 *  prompt" - and the clips that can play there. How long it plays is never
 *  set: each video plays the part of the clip where something happens
 *  (stepPiece.ts). Steps saved before that may still carry the minSec and
 *  maxSec he used to type; nothing reads them. */
export interface BatchStep {
  id: string
  name: string
  files: BankFile[]
}

/** The words a step puts over its clip in every video: its name exactly as
 *  he typed it - "DRAW SOMETHING" - unless it still has the name it was
 *  given ("Step 2"), which says nothing to a viewer. */
export function stepTitle(name: string | undefined): string {
  const typed = (name ?? '').trim()
  return /^step \d+$/i.test(typed) ? '' : typed
}

/** The product showcase is in steps: the layout plays the reaction then the
 *  product, and he has set an order for the campaign. */
export function usesSteps(bank: Pick<BatchBank, 'layout' | 'steps'>): boolean {
  return (bank.layout ?? 'after') === 'after' && (bank.steps?.length ?? 0) > 0
}

export type BatchLayout = 'after' | 'greenscreen' | 'engine'

/** What a bank mixes from: in green screen, no music (the background's sound
 *  is the sound), and headlines are optional - none is the default. */
export function mixFrom<T extends Pick<BatchBank, 'layout' | 'headlines' | 'music' | 'hook'>>(bank: T, headlines: string[]): T {
  if (bank.layout !== 'greenscreen') return { ...bank, headlines }
  return { ...bank, music: [], headlines: bank.headlines.length > 0 ? bank.headlines : [''] }
}

/** The "Claude + X = $ a day" hook: two logos with a plus between them over
 *  the reaction, and a money line under them - one amount per video, from
 *  the range he set. Drawn by formulaOverlay.ts. */
export interface BatchFormula {
  left: BankFile | null
  right: BankFile | null
  /** What the logos are, in words - for the caption and the notification
   *  only. Default: the file names. */
  leftName?: string
  rightName?: string
  /** Dollars a day, the range each video's amount is drawn from. */
  min: number
  max: number
}

export const DEFAULT_FORMULA: BatchFormula = { left: null, right: null, min: 500, max: 1000 }

/** What each batch video's hook is: one of his headlines, or the formula. */
export type BatchHook = 'headline' | 'formula'

/** The hook every one of the bank's videos takes: Claude + X when it is the
 *  only look picked, else headlines (Claude + X taking turns with them is
 *  one of the looks, looksToMix). */
export function hookOf(bank: LookFields): BatchHook {
  const looks = looksOf(bank)
  return looks.length === 1 && looks[0].look === 'formula' ? 'formula' : 'headline'
}

/** The headlines the mixing goes through: his own, or - for the formula,
 *  where the hook is drawn rather than written - one blank stand-in, so
 *  reactions, products and tracks still go round evenly. */
export function headlinesToMix(bank: LookFields & Pick<BatchBank, 'headlines'>): string[] {
  return hookOf(bank) === 'formula' ? [''] : bank.headlines
}

const ENDINGS = ['a day', '/day', 'per day', 'daily'] as const

/** A small seeded generator: the same seed, the same numbers. */
function seeded(seed: string): () => number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  let state = hash >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** "$650 a day", "$800/day", "$1,000 per day": a round amount in the range,
 *  in steps of $50, with the ending varied. The same seed - a video's own
 *  id - always gives the same line, so a remake says the same thing. */
export function formulaLine(formula: Pick<BatchFormula, 'min' | 'max'>, seed: string, given?: number): string {
  const step = 50
  const low = Math.ceil(Math.max(0, Math.min(formula.min, formula.max)) / step) * step
  const high = Math.max(low, Math.floor(Math.max(formula.min, formula.max) / step) * step)
  const random = seeded(seed)
  const drawn = low + Math.floor(random() * ((high - low) / step + 1)) * step
  const amount = given ?? drawn
  const ending = ENDINGS[Math.floor(random() * ENDINGS.length)]
  return `$${amount.toLocaleString('en-US')}${ending.startsWith('/') ? '' : ' '}${ending}`
}

/** The amounts Claude + X goes through when it takes turns with headlines:
 *  each one in the range, in steps of $50 (at most 100 of them, spread
 *  over the range) - each amount a different video, the way each headline
 *  is. */
export function formulaAmounts(formula: Pick<BatchFormula, 'min' | 'max'>): number[] {
  const step = 50
  const low = Math.ceil(Math.max(0, Math.min(formula.min, formula.max)) / step) * step
  const high = Math.max(low, Math.floor(Math.max(formula.min, formula.max) / step) * step)
  const n = (high - low) / step + 1
  const take = Math.min(n, 100)
  return Array.from({ length: take }, (_, i) => low + Math.round((i * (n - 1)) / Math.max(1, take - 1)) * step)
}

/** "Claude", from "claude-logo.png". */
export function logoName(file: Pick<BankFile, 'name'> | null, given?: string): string {
  if (given?.trim()) return given.trim()
  if (!file) return ''
  const base = file.name.replace(/\.[^./]+$/, '').replace(/[-_]+/g, ' ').replace(/\blogo\b/gi, '').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : ''
}

/** What the hook says in words, for the caption Claude writes and the
 *  notification: "Claude + OpenArt = $650 a day". */
export function formulaText(formula: BatchFormula, line: string): string {
  const left = logoName(formula.left, formula.leftName) || 'Claude'
  const right = logoName(formula.right, formula.rightName) || 'it'
  return `${left} + ${right} = ${line}`
}

export interface BatchPick {
  reaction: string
  /** The product showcase - or, in steps, the first step's clip. */
  product: string
  /** In steps: one clip per step, in order. */
  steps?: string[]
  headline: string
  music: string | null
  /** The hook's look, when the bank takes turns between several: a headline
   *  look, or Claude + X. */
  look?: BatchLook
  /** Claude + X taking turns: the amount this video says. */
  amount?: number
}

/** A hook a batch's videos can take: a headline in one of the three looks,
 *  or the Claude + X formula. */
export type BatchLook = HeadlineStyle | 'formula'

/** A look he picked and its share of the videos: its parts out of all the
 *  picked looks' parts - 2, 1 and 1 are a half and a quarter each. */
export interface LookShare {
  look: BatchLook
  parts: number
}

/** The order the looks are shown and kept in. */
export const BATCH_LOOKS: readonly BatchLook[] = ['box', 'outline', 'snap', 'formula']

type LookFields = Pick<BatchBank, 'looks' | 'hook' | 'headlineStyles' | 'headlineStyle'>

/** The looks he picked, with their shares. None: a headline in the angle's
 *  look. Banks from before read as they were: the Claude + X hook alone, or
 *  the headline looks picked then, even. */
export function looksOf(bank: LookFields): LookShare[] {
  if (bank.looks?.length) return bank.looks
  if (bank.hook === 'formula') return [{ look: 'formula', parts: 1 }]
  const styles = bank.headlineStyles?.length ? bank.headlineStyles : bank.headlineStyle ? [bank.headlineStyle] : []
  return styles.map((look) => ({ look, parts: 1 }))
}

/** The headline looks picked, without Claude + X; none: the angle's. */
export function stylesOf(bank: LookFields): HeadlineStyle[] {
  return looksOf(bank).flatMap(({ look }) => (look === 'formula' ? [] : [look]))
}

/** Claude + X is one of the hooks he picked. */
export function hasFormula(bank: LookFields): boolean {
  return looksOf(bank).some(({ look }) => look === 'formula')
}

/** The looks the mixing takes turns between: only two or more, never on the
 *  engine, Claude + X never in green screen, and headline looks only with a
 *  headline written - so a bank with one look keeps the combinations it
 *  always had. */
export function looksToMix(bank: LookFields & Pick<BatchBank, 'layout' | 'headlines'>): LookShare[] {
  if (bank.layout === 'engine') return []
  const written = bank.headlines.some((h) => h.trim())
  const looks = looksOf(bank).filter(({ look }) => (look === 'formula' ? bank.layout !== 'greenscreen' : written))
  return looks.length > 1 ? looks : []
}

/** The look a batch video is made in: the one it was mixed with while he
 *  still has it picked, else one of those picked now (the same for the same
 *  video), so a change reaches every video not made yet. None picked: the
 *  angle's (undefined). */
export function styleFor(planned: HeadlineStyle | undefined, picked: readonly HeadlineStyle[], seed: string): HeadlineStyle | undefined {
  if (picked.length === 0) return undefined
  if (planned && picked.includes(planned)) return planned
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0
  return picked[hash % picked.length]
}

export function emptyBank(campaignId: string, angleId: string): BatchBank {
  return { campaignId, angleId, reactions: [], products: [], headlines: [], music: [], perDay: 3, days: 7, used: {} }
}

/** The headlines as he pasted them: one a line, blanks and repeats out. */
export function headlinesFrom(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split('\n')) {
    const headline = line.trim()
    const key = headline.toLowerCase()
    if (!headline || seen.has(key)) continue
    seen.add(key)
    out.push(headline)
  }
  return out
}

const headlineKey = (headline: string) => `h:${headline.trim().toLowerCase()}`

/** More combinations than this and they are not all listed - a bank that
 *  big never runs out before its items are balanced anyway. Kept low enough
 *  that a two-week batch is picked in a moment on a phone. */
export const MAX_COMBOS = 20_000
/** How many made combinations a bank too big to list remembers, so a repeat
 *  is still avoided. */
const REMEMBERED = 5_000

/** What a bank's videos are mixed from: the reactions, the product - one
 *  list, or one per step - the hooks and the tracks (none: one empty). */
type MixBank = Pick<BatchBank, 'reactions' | 'products' | 'headlines' | 'music' | 'layout' | 'steps' | 'formula'> & LookFields

/** A look as the mixing counts it. */
const lookKey = (look: BatchLook) => `s:${look}`

/** One hook a video can take: one of his headlines (in a look, when they
 *  take turns), or Claude + X at one amount - each amount its own video, the
 *  way each headline is. */
interface Hook {
  text: string
  key: string
  look: BatchLook | null
  amount?: number
}

function dimensions(bank: MixBank): {
  reactions: string[]
  products: string[][]
  hooks: Hook[]
  tracks: (string | null)[]
  /** Each look taking turns, and its parts. */
  parts: Map<BatchLook, number>
} {
  const looks = looksToMix(bank)
  const headlines = (look: HeadlineStyle | null): Hook[] => bank.headlines.map((h) => ({ text: h, key: headlineKey(h), look }))
  return {
    reactions: bank.reactions.map((r) => r.id),
    products: usesSteps(bank) ? bank.steps!.map((step) => step.files.map((f) => f.id)) : [bank.products.map((p) => p.id)],
    hooks:
      looks.length === 0
        ? headlines(null)
        : looks.flatMap(({ look }) =>
            look === 'formula'
              ? formulaAmounts(bank.formula ?? DEFAULT_FORMULA).map((amount) => ({ text: '', key: `a:${amount}`, look, amount }))
              : headlines(look),
          ),
    tracks: bank.music.length > 0 ? bank.music.map((m) => m.id) : [null],
    parts: new Map(looks.map(({ look, parts }) => [look, Math.max(1, parts)])),
  }
}

/** One video's combination, as it is remembered. The product part is the
 *  clip's id - or every step's, joined - and the look is only there when it
 *  takes turns, so a bank without steps or looks keeps the keys it always had. */
const comboKey = (r: string, product: readonly string[], h: string, m: string | null, look: BatchLook | null = null) =>
  `${r}|${product.join('+')}|${h}|${m ?? ''}${look ? `|${look}` : ''}`

/** The look a remembered combination was made in, if any. */
const lookOfKey = (key: string): string => key.slice(key.lastIndexOf('|') + 1)

/** Every combination's key - the made ones still in the bank. */
function liveKeys({ reactions, products, hooks, tracks }: ReturnType<typeof dimensions>): Set<string> {
  const live = new Set<string>()
  for (const r of reactions) for (const p of everyChoice(products)) for (const h of hooks) for (const m of tracks) live.add(comboKey(r, p, h.key, m, h.look))
  return live
}

const totalOf = ({ reactions, products, hooks, tracks }: ReturnType<typeof dimensions>) =>
  reactions.length * products.reduce((n, l) => n * l.length, 1) * hooks.length * tracks.length

/** Every choice of one item from each list, in order. */
function* everyChoice(lists: readonly (readonly string[])[]): Generator<string[]> {
  if (lists.some((l) => l.length === 0)) return
  const at = lists.map(() => 0)
  for (;;) {
    yield lists.map((l, i) => l[at[i]])
    let i = lists.length - 1
    while (i >= 0 && ++at[i] === lists[i].length) at[i--] = 0
    if (i < 0) return
  }
}

/** `count` videos' worth of picks, and what has been used after them.
 *
 *  Every combination of reaction, product (one clip per step, in steps),
 *  hook and track is made once before any is made again: each video is the
 *  unmade combination whose items have been used least, ties broken at
 *  random - so the order is different every time and each reaction, clip,
 *  headline and track still comes round evenly. Only when every combination
 *  has been made does the round start again. The same reaction is never used
 *  twice in a row while there is another. With looks taking turns, each video
 *  first takes the look furthest behind its share, then the best combination
 *  in it; a look with nothing left this round sits out until the next. */
export function pickBatch(
  bank: MixBank & Pick<BatchBank, 'used' | 'lastPair' | 'made'>,
  count: number,
  rand: () => number = Math.random,
): { picks: BatchPick[]; used: Record<string, number>; lastPair?: string; made: string[] } {
  const used = { ...bank.used }
  let lastPair = bank.lastPair
  const picks: BatchPick[] = []
  const made = new Set(bank.made ?? [])
  const dims = dimensions(bank)
  const { reactions, products, hooks, tracks, parts } = dims
  const total = totalOf(dims)
  if (total === 0) return { picks, used, lastPair, made: [...made] }
  const listed = total <= MAX_COMBOS
  // Combinations made before, with items since taken out of the bank, no
  // longer count against this round.
  if (listed) {
    const live = liveKeys(dims)
    for (const key of made) if (!live.has(key)) made.delete(key)
  }
  const usedOf = (key: string | null) => (key ? (used[key] ?? 0) : 0)
  // Each look's videos this round (all along, for a bank too big to list).
  const inRound = new Map<string, number>()
  const countRound = () => {
    inRound.clear()
    for (const key of made) inRound.set(lookOfKey(key), (inRound.get(lookOfKey(key)) ?? 0) + 1)
  }
  if (listed) countRound()
  const doneOf = (look: BatchLook) => (listed ? (inRound.get(look) ?? 0) : usedOf(lookKey(look)))
  /** Of `looks`, the one furthest behind its share; ties at random. */
  const behind = (looks: BatchLook[]): BatchLook => {
    const due = (look: BatchLook) => (doneOf(look) + 1) / parts.get(look)!
    const low = Math.min(...looks.map(due))
    const ties = looks.filter((look) => due(look) === low)
    return ties[Math.min(ties.length - 1, Math.floor(rand() * ties.length))]
  }

  for (let i = 0; i < count; i++) {
    if (listed && made.size >= total) {
      made.clear()
      countRound()
    }
    const lastReaction = lastPair?.split('|')[0]
    type Choice = { r: string; p: string[]; h: Hook; m: string | null }
    let best: Choice[] = []
    if (listed) {
      // The least-used unmade combinations of each look.
      const byLook = new Map<BatchLook | null, { score: number; list: Choice[] }>()
      const consider = (avoidLast: boolean) => {
        for (const r of reactions) {
          if (avoidLast && reactions.length > 1 && r === lastReaction) continue
          for (const p of everyChoice(products)) {
            const productScore = p.reduce((n, id) => n + usedOf(id), 0)
            for (const h of hooks)
              for (const m of tracks) {
                if (made.has(comboKey(r, p, h.key, m, h.look))) continue
                const score = usedOf(r) + productScore + usedOf(h.key) + usedOf(m)
                const at = byLook.get(h.look)
                if (!at || score < at.score) byLook.set(h.look, { score, list: [{ r, p, h, m }] })
                else if (score === at.score) at.list.push({ r, p, h, m })
              }
          }
        }
      }
      consider(true)
      // Only combinations with the last reaction are left unmade.
      if (byLook.size === 0) consider(false)
      const look = parts.size > 0 ? behind([...byLook.keys()] as BatchLook[]) : null
      best = byLook.get(look)?.list ?? []
    } else {
      // Too many to list: the look furthest behind, then each part on its
      // own, least used first.
      const look = parts.size > 0 ? behind([...parts.keys()]) : null
      const lookHooks = hooks.filter((h) => h.look === look)
      const least = (keys: string[], avoid?: string) => {
        const pool = keys.filter((k) => k !== avoid).length > 0 ? keys.filter((k) => k !== avoid) : keys
        const low = Math.min(...pool.map((k) => used[k] ?? 0))
        const ties = pool.filter((k) => (used[k] ?? 0) === low)
        return ties[Math.min(ties.length - 1, Math.floor(rand() * ties.length))]
      }
      const draw = (): Choice => {
        const hKey = least(lookHooks.map((h) => h.key))
        return {
          r: least(reactions, lastReaction),
          p: products.map((list) => least(list)),
          h: lookHooks.find((h) => h.key === hKey)!,
          m: tracks[0] === null ? null : least(tracks as string[]),
        }
      }
      // The least-used of each part, drawn again (ties fall differently)
      // while it would make one already made.
      let choice = draw()
      for (let tries = 0; tries < 20 && made.has(comboKey(choice.r, choice.p, choice.h.key, choice.m, choice.h.look)); tries++) choice = draw()
      best = [choice]
    }
    const choice = best[Math.min(best.length - 1, Math.floor(rand() * best.length))]
    const { look, amount } = choice.h
    for (const key of [choice.r, ...choice.p, choice.h.key, choice.m, look && lookKey(look)]) if (key) used[key] = (used[key] ?? 0) + 1
    made.add(comboKey(choice.r, choice.p, choice.h.key, choice.m, look))
    if (look) inRound.set(look, (inRound.get(look) ?? 0) + 1)
    lastPair = `${choice.r}|${choice.p.join('+')}`
    picks.push({
      reaction: choice.r,
      product: choice.p[0],
      ...(usesSteps(bank) ? { steps: choice.p } : {}),
      headline: choice.h.text,
      music: choice.m,
      ...(look ? { look } : {}),
      ...(amount !== undefined ? { amount } : {}),
    })
  }
  const kept = [...made]
  return { picks, used, lastPair, made: listed ? kept : kept.slice(-REMEMBERED) }
}

/** How many different videos the bank can make, and how many of those are
 *  still to be made. Infinity for a bank too big to count. */
export function combos(bank: MixBank & Pick<BatchBank, 'made'>): { total: number; left: number } {
  const dims = dimensions(bank)
  const total = totalOf(dims)
  if (total === 0) return { total: 0, left: 0 }
  if (total > MAX_COMBOS) return { total: Infinity, left: Infinity }
  const live = liveKeys(dims)
  const made = (bank.made ?? []).filter((key) => live.has(key)).length
  return { total, left: total - made }
}

/** Once every different video has been made: the reactions and product
 *  showcases go - he films new ones - and the headlines, music and the
 *  steps' names stay. The files are only deleted once the videos made from
 *  them are finished. */
export function spend(bank: BatchBank, through: string): { bank: BatchBank; retired: string[] } {
  const { total } = combos(bank)
  const stepFiles = (bank.steps ?? []).flatMap((step) => step.files)
  return {
    bank: {
      ...bank,
      reactions: [],
      products: [],
      ...(bank.steps ? { steps: bank.steps.map((step) => ({ ...step, files: [] })) } : {}),
      made: [],
      lastPair: undefined,
      spent: { videos: total, through },
    },
    retired: [...bank.reactions, ...bank.products, ...stepFiles].map((f) => f.id),
  }
}

/** Every bank file a batch video is made from. */
export function filesOf(bank: { reaction: BankFile; product: BankFile; steps?: { file: BankFile }[] }): string[] {
  return [bank.reaction.id, bank.product.id, ...(bank.steps ?? []).map((s) => s.file.id)]
}

/** The campaign's times as a sorted list, bad ones out. */
export function cleanTimes(times: string[]): string[] {
  return [...new Set(times.map((t) => t.trim()).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort()
}

/** `perDay` of the campaign's times, spread through the day: 3 of 8, 11,
 *  2, 5, 8 and 11 o'clock are 8 AM, 2 PM and 8 PM. */
export function dayTimes(times: string[], perDay: number): string[] {
  const all = cleanTimes(times)
  if (perDay >= all.length) return all
  const picked = new Set<number>()
  for (let i = 0; i < perDay; i++) picked.add(Math.min(all.length - 1, Math.round((i * all.length) / perDay)))
  return [...picked].sort((a, b) => a - b).map((i) => all[i])
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Today on this phone, as "2026-09-30". */
export function todayHere(now = new Date()): string {
  return now.toLocaleDateString('en-CA')
}

/** Time enough to make a video, send it up and approve it. */
export const LEAD_MINUTES = 60

export interface BatchSlot {
  date: string
  time: string
}

/** "Wed Sep 30" - how a day reads on the phone. */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
