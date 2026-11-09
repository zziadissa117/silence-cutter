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

import type { EmojiSprite } from './emojiSprites'
import type { HeadlineStyle } from './look'
import type { TrialBank } from './trialLoop'

/** A file in the bank, kept on this phone only - his own footage. */
/** One video made again with other songs (his ask, 2026-11-09: "the same
 *  exact video ... with only 5 different audios"): the picture as it is,
 *  only the sound new (songSwap.ts). Its copies take the batch's next free
 *  times, each with a song of the batch's music it hasn't had. */
export interface CopySource {
  id: string
  /** The video, as he put it in. */
  clip: BankFile
  /** How many copies he wants. */
  count: number
  /** He talks in it (heard when it went in): his voice stays, the song low
   *  under it. Otherwise the song takes the place of its sound. */
  talks: boolean
  /** Stopped (Stop, or his tap): no more copies of it until Start. */
  stopped?: boolean
  addedAt: number
}

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
  /** Taken in again on purpose (Add anyway), though already in videos made
   *  before: when. It is its own clip then (usedKey) - what the earlier
   *  videos used it up for doesn't turn it away. */
  again?: number
  /** A reaction he talks in (his ask, 2026-11-06: "one batch ... where I'm
   *  not going to talk, and ... where I'm going to talk"): its video keeps his
   *  voice, the music under it. Absent: as the bank's old `voice` said - a
   *  reaction he is silent in, music alone, unless the whole batch talked. */
  talks?: boolean
  /** The formats of the batch it belongs to (BatchFormat ids): a clip of him
   *  belongs to one, a product clip to one or more. */
  formats?: string[]
}

/** What one kind of video in a batch is: his silent reaction then the
 *  product, him talking (his voice kept) then the product, or him cut out
 *  in a corner over the product (his ask, 2026-11-06: "reaction format,
 *  talking head format, green screen format" - all in the one batch of the
 *  account, several of each when the angles differ). */
export type FormatKind = 'reaction' | 'talking' | 'greenscreen'

export interface BatchFormat {
  id: string
  kind: FormatKind
  /** His name for it: "Reaction - shocked", "App demo behind me". */
  name: string
  /** Paused: no new videos of it; what was made stays. */
  paused?: boolean
  /** Green screen: his corner. */
  corner?: { side: 'left' | 'right'; sizePct: number }
  /** Green screen: he talks in these, so his voice is kept. */
  voice?: boolean
}

export const FORMAT_KINDS: { kind: FormatKind; label: string; hint: string }[] = [
  { kind: 'reaction', label: 'Reaction', hint: 'You react without a word, then the product. Music only.' },
  { kind: 'talking', label: 'Talking head', hint: 'You talk to the camera - your voice kept with captions, music under it - then the product.' },
  { kind: 'greenscreen', label: 'Green screen', hint: 'The product plays full screen, you cut out of your background in a corner.' },
]

export interface BatchBank {
  campaignId: string
  /** The angle whose headline look the videos take. */
  angleId: string
  reactions: BankFile[]
  products: BankFile[]
  headlines: string[]
  /** The emoji of its headlines as the iPhone draws them, for the Cutter
   *  server's videos (emojiSprites.ts) - kept by a phone with a server. */
  emojis?: EmojiSprite[]
  music: BankFile[]
  perDay: number
  /** More videos each day than the day before ("start with 4 and add +1 per
   *  day every single day"): `perDay` on `growthFrom`, this many more on each
   *  day after it, with no most a day (batchRun.perDayOn). None or 0: the
   *  same every day. */
  growth?: number
  /** The day `perDay` is the number for, while it grows (his own date). */
  growthFrom?: string
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
  /** Drop a hook that does badly by itself (batchHooks.weakHooks): its
   *  videos not out yet come out and the others are made instead. */
  dropWeakHooks?: boolean
  /** What was dropped that way, newest first, to say so. */
  droppedHooks?: { label: string; views: number; others: number; at: string }[]
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
  /** The clips (reactions, product showcases, steps' clips) that left the
   *  bank after videos were made from them - taken out, or cleared once
   *  every video was made - by what is in them (clipKey). The same file is
   *  never taken in again, so no video is ever made twice. */
  usedClips?: string[]
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
  /** Made on the Cutter server (server/, serverMode.ts), not on this phone:
   *  the phone sends it its clips and settings, and makes none itself. */
  where?: 'server'
  /** When the phone handed it to the server (serverLink.ts): a bank the
   *  server kept from an earlier hand-over is out of date, not merged. */
  movedAt?: string
  /** When he last tapped Start: what stopped the batch before (every video
   *  made, a problem) is behind it - read by fromPhone. */
  startedAt?: string
  /** "Use the best hooks" (Analytics): the headlines, looks, reactions and
   *  songs whose videos do best (postiz/hookInsights.ts) go into more of the
   *  videos - each comes round FAVOUR times as often - and follow the
   *  numbers as they change (batchFavour.ts). Off: everything evenly. */
  useBest?: boolean
  favour?: Favour
  /** A talking batch: his reactions keep their own sound - his voice - with
   *  the music under it, dipping while he talks. Off (the default): music
   *  alone, the clips muted. (His ask, 2026-11-03.) */
  voice?: boolean
  /** Of every 100 videos, how many are made from the reactions he talks in,
   *  while there are both kinds (talkShareOf; default TALK_SHARE). */
  talkShare?: number
  /** How many videos of each kind the batch has made, so the share holds
   *  from one top-up to the next. */
  kinds?: { talk: number; quiet: number }
  /** The kinds of video the batch makes, each with its own clips (BankFile
   *  `formats`) - withFormats makes them for a bank from before. */
  formats?: BatchFormat[]
  /** How many videos of each format it has made, so they keep taking turns
   *  from one top-up to the next. */
  formatDone?: Record<string, number>
  /** One video, new songs (CopySource): his, set on the phone. */
  copies?: CopySource[]
  /** The songs each of them has had so far (music ids), by its id: the
   *  making's, like `made`. */
  copiesMade?: Record<string, string[]>
  /** How much of the day each format gets, by id (1 when absent): set by
   *  how its videos do (Analytics). */
  formatShares?: Record<string, number>
  /** When he last tapped Start anyway: the mixes made before were forgotten
   *  then, so the same clips make the same videos again - read by fromPhone,
   *  which takes the phone's `made` for that Start. */
  anyway?: string
  /** A Trial loop (layout 'trial', trialLoop.ts): the viral reels it makes
   *  Instagram Trial Reels from. Their clean clips are `reactions`, their
   *  sounds `music`. */
  trial?: TrialBank
  /** The most a day whatever his number: a Trial loop's accounts' daily trial
   *  limit as Instagram showed it (postiz/trial.ts), set by the app. */
  most?: number
}

/** What "Use the best hooks" makes more of: headlines by their words in
 *  small letters (batchHooks.wordsKey), looks, and reactions and songs by
 *  their file's name without its ending - as the server's numbers name them. */
export interface Favour {
  headlines: string[]
  looks: BatchLook[]
  reactions: string[]
  songs: string[]
}

/** How many times as often a favoured one comes round. */
export const FAVOUR = 2

/** What the making of a batch has done so far - what was made, used, put on
 *  which day, why it stopped. On the server these are the server's own; every
 *  other field is a setting he changes on the phone. */
export const PROGRESS_FIELDS = ['used', 'lastPair', 'made', 'usedClips', 'madeThrough', 'filled', 'runProblem', 'spent', 'lastPerDay', 'kinds', 'formatDone', 'copiesMade'] as const

/** The bank the server makes from, after the phone sent its latest: his
 *  settings from the phone (clips, headlines, looks, the number a day, Start
 *  and Stop), what was made so far from the server - the phone's copy of
 *  that is older, and taking it would make videos again. Clips once used stay
 *  used from either. The first time, or a new hand-over (movedAt), the
 *  phone's bank whole. The phone reads the server's progress back the same
 *  way, so both always agree. */
export function fromPhone(server: BatchBank | null, phone: BatchBank): BatchBank {
  if (!server || server.movedAt !== phone.movedAt) return phone
  const next: BatchBank = { ...phone }
  for (const key of PROGRESS_FIELDS) {
    if (server[key] === undefined) delete next[key]
    else (next as unknown as Record<string, unknown>)[key] = server[key]
  }
  if (phone.startedAt !== server.startedAt) {
    // He tapped Start since the server last had it: what stopped it is behind
    // it - and with Start anyway, the mixes made before too.
    const behind = phone.anyway !== undefined && phone.anyway === phone.startedAt ? (['spent', 'runProblem', 'made'] as const) : (['spent', 'runProblem'] as const)
    for (const key of behind) {
      if (phone[key] === undefined) delete next[key]
      else (next as unknown as Record<string, unknown>)[key] = phone[key]
    }
  } else if (server.running === false && server.spent) {
    // The server stopped it itself, every different video made, and he
    // hasn't tapped Start since: stopped on the phone too, as it would be there.
    next.running = false
  }
  const usedClips = [...new Set([...(server.usedClips ?? []), ...(phone.usedClips ?? [])])]
  if (usedClips.length > 0) next.usedClips = usedClips
  // A clip the server already used up (every video from it made, so it was
  // cleared out) never comes back from the phone's older copy: those videos
  // would be made again.
  const spent = new Set(server.usedClips ?? [])
  const fresh = (files: BankFile[]) => files.filter((f) => !spent.has(usedKey(f)))
  next.reactions = fresh(next.reactions)
  next.products = fresh(next.products)
  if (next.steps) next.steps = next.steps.map((step) => ({ ...step, files: fresh(step.files) }))
  return next
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
  /** The formats whose product it is (BatchFormat ids). */
  formats?: string[]
}

/** The look of every word on a batch video but its headline hook: the step
 *  names and the Claude + X amount are always outlined - he wants Snapchat
 *  only on a headline hook, on its own. */
export const ONLY_HOOK_ELSE = 'outline' as const

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
  // Green screen too: the steps' clips play behind him, one after the other.
  return ((bank.layout ?? 'after') === 'after' || bank.layout === 'greenscreen') && (bank.steps?.length ?? 0) > 0
}

export type BatchLayout = 'after' | 'greenscreen' | 'engine' | 'trial'

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
  /** What goes under the logos: an amount a day (absent, as before), one of
   *  the batch's headlines on each video, or nothing - just the two
   *  pictures (his ask, 2026-11-03). */
  says?: FormulaSays
}

export type FormulaSays = 'amount' | 'headlines' | 'none'

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

/** The headlines the mixing goes through: his own, or one blank stand-in -
 *  for the formula, where the hook is drawn rather than written, and for a
 *  batch with no headline at all, whose videos have no words on them (text is
 *  optional: "sometimes it just makes it weird and kills the reach", his
 *  words 2026-11-03) - so reactions, products and tracks still go round
 *  evenly. */
export function headlinesToMix(bank: LookFields & Pick<BatchBank, 'headlines' | 'layout' | 'formula'>): string[] {
  // Claude + X alone: its own line, unless it says the headlines.
  if (bank.layout !== 'greenscreen' && hookOf(bank) === 'formula' && bank.formula?.says !== 'headlines') return ['']
  return bank.headlines.length > 0 ? bank.headlines : ['']
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

/** A name the camera or the phone gave a file - "IMG 0373", "Screenshot
 *  2026 10 12 at 9.41.03", "PXL 20261012" - which says nothing of what is in
 *  it. */
const SAYS_NOTHING = /^(img|image|dsc|pxl|photo|screenshot|screen shot|whatsapp image)?(?:[\d\s.:]|\bat\b)*$/i

/** "Claude", from "claude-logo.png" - or the name he gave it. Nothing from
 *  "IMG_0373.png": Claude wrote captions about "two screenshots on my camera
 *  roll" from that. */
export function logoName(file: Pick<BankFile, 'name'> | null, given?: string): string {
  if (given?.trim()) return given.trim()
  if (!file) return ''
  const base = file.name.replace(/\.[^./]+$/, '').replace(/[-_]+/g, ' ').replace(/\blogo\b/gi, '').trim()
  if (SAYS_NOTHING.test(base)) return ''
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** What the hook says in words, for the caption Claude writes and the
 *  notification: "Claude + OpenArt = $650 a day" - or just the amount while
 *  a logo's name isn't known. */
export function formulaText(formula: BatchFormula, line: string): string {
  const left = logoName(formula.left, formula.leftName)
  const right = logoName(formula.right, formula.rightName)
  if (!left || !right) return line
  if (!line.trim()) return `${left} + ${right}`
  return formula.says === 'headlines' ? `${left} + ${right} - ${line}` : `${left} + ${right} = ${line}`
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

/** Whether a format's clips keep his voice: a talking head always, a green
 *  screen when he turned "You talk in these" on. */
export function formatTalks(format: Pick<BatchFormat, 'kind' | 'voice'>): boolean {
  return format.kind === 'talking' || (format.kind === 'greenscreen' && Boolean(format.voice))
}

/** Whether he talks in this reaction: the format it is in when it is in one
 *  (a clip in a Talking head format always keeps its sound - his report,
 *  2026-11-08: "all the reaction clips are muted, but they have to have
 *  sound on every single one of them"), else its own mark, else the bank's
 *  old one-for-all sound setting. */
export function talksIn(bank: Pick<BatchBank, 'voice'> & { formats?: BatchFormat[] }, file: BankFile): boolean {
  const format = (bank.formats ?? []).find((f) => file.formats?.includes(f.id))
  if (format) return formatTalks(format)
  return file.talks ?? bank.voice === true
}

/** Of every 100 videos, how many talk, when there are reactions of both
 *  kinds (his "maybe do 65% non-talking and the rest talking"). */
export const TALK_SHARE = 35

export function talkShareOf(bank: Pick<BatchBank, 'talkShare'>): number {
  const share = bank.talkShare
  return typeof share === 'number' && Number.isFinite(share) ? Math.min(100, Math.max(0, Math.round(share))) : TALK_SHARE
}

/** The reactions of one kind. */
export function reactionsOfKind(bank: Pick<BatchBank, 'voice' | 'reactions'>, talking: boolean): BankFile[] {
  return bank.reactions.filter((f) => talksIn(bank, f) === talking)
}

export type ReactionKind = 'talk' | 'quiet'

/** Which kind each of the next `count` videos is: the one furthest behind
 *  its share, from what was made before (`done`), and only while it has
 *  videos left (`left`) - when one kind runs out, the other makes the rest.
 *  Ties go to the not-talking ones, his bigger share. */
export function kindsFor(
  count: number,
  share: number,
  done: { talk: number; quiet: number } | undefined,
  left: { talk: number; quiet: number },
): ReactionKind[] {
  const out: ReactionKind[] = []
  const made = { talk: done?.talk ?? 0, quiet: done?.quiet ?? 0 }
  const room = { ...left }
  const want = { talk: share / 100, quiet: 1 - share / 100 }
  for (let i = 0; i < count; i++) {
    const can = (k: ReactionKind) => room[k] > 0 && want[k] > 0
    let kind: ReactionKind | null
    if (can('talk') && can('quiet')) {
      const total = made.talk + made.quiet + 1
      // How far each is under its share if the next one isn't it.
      kind = made.talk / total - want.talk < made.quiet / total - want.quiet ? 'talk' : 'quiet'
    } else kind = can('quiet') ? 'quiet' : can('talk') ? 'talk' : room.quiet > 0 ? 'quiet' : room.talk > 0 ? 'talk' : null
    if (!kind) break
    out.push(kind)
    made[kind]++
    room[kind]--
  }
  return out
}

/** The ids a bank from before formats is given (the same on every phone and
 *  the server, which may each convert it). */
export const OLD_FORMAT = { reaction: 'f-reaction', talking: 'f-talking', greenscreen: 'f-greenscreen' } as const

/** Whether a bank's videos are mixed from formats: not on the engine, and
 *  not a Trial loop. */
export function hasFormats(bank: Pick<BatchBank, 'layout'>): boolean {
  return bank.layout !== 'engine' && bank.layout !== 'trial'
}

const tag = <T extends { formats?: string[] }>(item: T, ids: string[]): T => (item.formats?.length ? item : { ...item, formats: ids })

/** The bank with formats: as it is when it has them. A bank from before
 *  gets them from how it was set up - green screen one format, otherwise the
 *  reactions he is silent in one and the ones he talks in another, both with
 *  the product clips - and every clip says which it belongs to. */
export function withFormats(bank: BatchBank): BatchBank {
  // An empty list is one format's own bank (formatBank): mixed as it is.
  if (!hasFormats(bank) || bank.formats) return bank
  let formats: BatchFormat[]
  let reactions: BankFile[]
  if (bank.layout === 'greenscreen') {
    // The ones he talks in keep his voice: a green screen format of their own.
    const talking = bank.reactions.filter((r) => talksIn(bank, r))
    const silent = bank.reactions.filter((r) => !talksIn(bank, r))
    const corner = bank.corner ? { corner: bank.corner } : {}
    formats = [
      ...(silent.length > 0 || talking.length === 0 ? [{ id: OLD_FORMAT.greenscreen, kind: 'greenscreen' as const, name: 'Green screen', ...corner }] : []),
      ...(talking.length > 0 ? [{ id: `${OLD_FORMAT.greenscreen}-talking`, kind: 'greenscreen' as const, name: 'Green screen - talking', voice: true, ...corner }] : []),
    ]
    reactions = bank.reactions.map((r) => tag(r, [talksIn(bank, r) ? `${OLD_FORMAT.greenscreen}-talking` : OLD_FORMAT.greenscreen]))
  } else {
    const talking = bank.reactions.filter((r) => talksIn(bank, r))
    const silent = bank.reactions.filter((r) => !talksIn(bank, r))
    formats = [
      ...(silent.length > 0 || talking.length === 0 ? [{ id: OLD_FORMAT.reaction, kind: 'reaction' as const, name: 'Reaction' }] : []),
      ...(talking.length > 0 ? [{ id: OLD_FORMAT.talking, kind: 'talking' as const, name: 'Talking head' }] : []),
    ]
    reactions = bank.reactions.map((r) => tag(r, [talksIn(bank, r) ? OLD_FORMAT.talking : OLD_FORMAT.reaction]))
  }
  const all = formats.map((f) => f.id)
  return {
    ...bank,
    layout: 'after',
    formats,
    reactions,
    products: bank.products.map((p) => tag(p, all)),
    ...(bank.steps ? { steps: bank.steps.map((s) => tag(s, all)) } : {}),
  }
}

const inFormat = (id: string) => (item: { formats?: string[] }) => Boolean(item.formats?.includes(id))

/** One format as a bank of its own, the way the mixing has always read one:
 *  its own clips of him and product clips (or steps), its layout and sound,
 *  with the batch's headlines, looks, music and progress. */
export function formatBank(bank: BatchBank, format: BatchFormat): BatchBank {
  const mine = inFormat(format.id)
  const steps = bank.steps?.filter(mine)
  const talks = formatTalks(format)
  return {
    ...bank,
    layout: format.kind === 'greenscreen' ? 'greenscreen' : 'after',
    reactions: bank.reactions.filter(mine).map((r) => ({ ...r, talks })),
    products: bank.products.filter(mine),
    steps: steps && steps.length > 0 ? steps : undefined,
    ...(format.corner ? { corner: format.corner } : {}),
    voice: undefined,
    formats: [],
  }
}

/** The formats of a bank (none on the engine or in a Trial loop). */
export function formatsOf(bank: BatchBank): BatchFormat[] {
  return withFormats(bank).formats ?? []
}

/** The format a clip of him belongs to. */
export function formatOfReaction(bank: BatchBank, reactionId: string): BatchFormat | null {
  const b = withFormats(bank)
  const file = b.reactions.find((r) => r.id === reactionId)
  return (b.formats ?? []).find((f) => file?.formats?.includes(f.id)) ?? null
}

/** Which format each of the next `count` videos is: the one furthest behind
 *  its share (`weight`, counted from what each made before), only while it
 *  has videos left (`room`) - when one runs out, the others make the rest.
 *  Ties go to the first in his list. */
export function turnsFor(count: number, groups: { id: string; weight: number; done: number; room: number }[]): string[] {
  const out: string[] = []
  const state = groups.filter((g) => g.weight > 0).map((g) => ({ ...g }))
  const total = state.reduce((n, g) => n + g.weight, 0)
  for (let i = 0; i < count; i++) {
    const open = state.filter((g) => g.room > 0)
    if (open.length === 0) break
    const made = state.reduce((n, g) => n + g.done, 0) + 1
    // How far under its share each is; the most under goes next.
    let best = open[0]
    let bestUnder = -Infinity
    for (const g of open) {
      const under = g.weight / total - g.done / made
      if (under > bestUnder + 1e-9) {
        best = g
        bestUnder = under
      }
    }
    out.push(best.id)
    best.done++
    best.room--
  }
  return out
}

/** A format needs this many videos out with their views before how it does
 *  counts. */
export const FORMAT_EVIDENCE = 5
/** The most and least of the day a format's results can give it, against an
 *  even share. */
export const FORMAT_SHARE_RANGE = { min: 0.5, max: 2 } as const

/** How much of the day each format gets from how its videos do (his pick,
 *  2026-11-06: "even, then by results"): a format's middle views against the
 *  middle of all of them, kept between half and twice an even share. Even
 *  (undefined) until two formats each have FORMAT_EVIDENCE videos out with
 *  views; a format without enough yet keeps an even share. */
export function formatSharesFrom(
  posts: readonly { campaignId: string; status: string; batch?: { format?: string } | null; views?: Record<string, number> | null }[],
  campaignId: string,
  formats: readonly Pick<BatchFormat, 'id'>[],
): Record<string, number> | undefined {
  const viewsOf = new Map<string, number[]>()
  for (const p of posts) {
    const id = p.batch?.format
    if (p.campaignId !== campaignId || p.status !== 'posted' || !id || !p.views) continue
    const total = Object.values(p.views).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0)
    viewsOf.set(id, [...(viewsOf.get(id) ?? []), total])
  }
  const middle = (list: number[]) => {
    const sorted = [...list].sort((a, b) => a - b)
    const half = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
  }
  const known = formats.filter((f) => (viewsOf.get(f.id)?.length ?? 0) >= FORMAT_EVIDENCE)
  if (known.length < 2) return undefined
  const all = middle(known.flatMap((f) => viewsOf.get(f.id)!))
  if (all <= 0) return undefined
  const out: Record<string, number> = {}
  for (const f of known) {
    const share = middle(viewsOf.get(f.id)!) / all
    out[f.id] = Math.round(Math.min(FORMAT_SHARE_RANGE.max, Math.max(FORMAT_SHARE_RANGE.min, share)) * 10) / 10
  }
  return out
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
type MixBank = Pick<BatchBank, 'reactions' | 'products' | 'headlines' | 'music' | 'layout' | 'steps' | 'formula' | 'useBest' | 'favour'> & LookFields

/** A file's name as the server's numbers have it: without its ending. */
export const bareName = (name: string) => name.replace(/\.[^./]+$/, '').trim()

/** How many times as often each item comes round, by the key the mixing
 *  counts it by: FAVOUR for the ones "Use the best hooks" picked, 1 (absent)
 *  for the rest. */
function boostsOf(bank: MixBank, hooks: readonly Hook[]): { item: Map<string, number>; look: Map<BatchLook, number> } {
  const item = new Map<string, number>()
  const look = new Map<BatchLook, number>()
  const f = bank.useBest ? bank.favour : undefined
  if (!f) return { item, look }
  const reactions = new Set(f.reactions)
  const songs = new Set(f.songs)
  const headlines = new Set(f.headlines)
  for (const r of bank.reactions) if (reactions.has(bareName(r.name))) item.set(r.id, FAVOUR)
  for (const m of bank.music) if (songs.has(bareName(m.name))) item.set(m.id, FAVOUR)
  for (const h of hooks) {
    const words = h.text.trim().toLowerCase().replace(/\s+/g, ' ')
    if (h.look === 'formula' ? f.headlines.includes('formula') : headlines.has(words)) item.set(h.key, FAVOUR)
  }
  for (const l of f.looks) look.set(l, FAVOUR)
  return { item, look }
}

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
              ? formulaHooks(bank)
              : headlines(look),
          ),
    tracks: bank.music.length > 0 ? bank.music.map((m) => m.id) : [null],
    parts: new Map(looks.map(({ look, parts }) => [look, Math.max(1, parts)])),
  }
}

/** Claude + X's hooks: one per amount (each its own video), one per
 *  headline when it says the headlines, or the one blank - just the logos. */
function formulaHooks(bank: MixBank): Hook[] {
  const formula = bank.formula ?? DEFAULT_FORMULA
  if (formula.says === 'none') return [{ text: '', key: 'a:none', look: 'formula' }]
  if (formula.says === 'headlines') {
    const words = bank.headlines.filter((h) => h.trim())
    return words.length > 0 ? words.map((h) => ({ text: h, key: `f${headlineKey(h)}`, look: 'formula' as const })) : [{ text: '', key: 'a:none', look: 'formula' }]
  }
  return formulaAmounts(formula).map((amount) => ({ text: '', key: `a:${amount}`, look: 'formula' as const, amount }))
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
  // The best ones (Use the best hooks) count each use as a share of one, so
  // they come round more often.
  const boosts = boostsOf(bank, hooks)
  const usedOf = (key: string | null) => (key ? (used[key] ?? 0) / (boosts.item.get(key) ?? 1) : 0)
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
    const due = (look: BatchLook) => (doneOf(look) + 1) / (parts.get(look)! * (boosts.look.get(look) ?? 1))
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
        const low = Math.min(...pool.map((k) => usedOf(k)))
        const ties = pool.filter((k) => usedOf(k) === low)
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

/** The start of a made combination's key - reaction, product (or steps)
 *  and hook - for a video known only by its name and its headline: the file
 *  name lists its clips ("IMG_0249 + IMG_0330 + ….mp4", CampaignApp.addBatch)
 *  and the headline is its hook, or the Claude + X line with its amount.
 *  Every reading that fits, as clip names can repeat. */
export function mixPrefixes(bank: Pick<BatchBank, 'reactions' | 'products' | 'steps' | 'layout' | 'formats'>, fileName: string, headline: string): string[] {
  // Each format reads its own clips.
  if (bank.formats?.length) return bank.formats.flatMap((f) => mixPrefixes(formatBank(bank as BatchBank, f), fileName, headline))
  const names = fileName.replace(/\.[^./]+$/, '').split(' + ')
  const named = (list: readonly BankFile[], name: string | undefined) => list.filter((f) => f.name.replace(/\.[^./]+$/, '') === name).map((f) => f.id)
  const reactions = named(bank.reactions, names[0])
  const products = usesSteps(bank) ? bank.steps!.map((step, k) => named(step.files, names[k + 1])) : [named(bank.products, names[1])]
  // "Claude + Lovable = $800 a day", or "$800 a day" while the logos are unnamed.
  const amount = /(?:^|=)\s*\$([\d,]+)/.exec(headline.trim())?.[1]?.replace(/,/g, '')
  const hooks = [headlineKey(headline), ...(amount ? [`a:${amount}`, 'h:'] : [])]
  const out: string[] = []
  for (const r of reactions) for (const p of everyChoice(products)) for (const h of hooks) out.push(`${r}|${p.join('+')}|${h}|`)
  return out
}

/** The made list with the videos taken out (`gone`, by mixPrefixes) made
 *  again possible - but never one that matches a video still out there
 *  (`kept`): posted, or going out. */
export function unmake(made: readonly string[], gone: readonly string[], kept: readonly string[]): string[] {
  const hit = (key: string, prefixes: readonly string[]) => prefixes.some((p) => key.startsWith(p))
  return made.filter((key) => !hit(key, gone) || hit(key, kept))
}

/** How a clip is known when it comes back: by what is in it, or - for
 *  files kept before fingerprints existed - by its name and size. */
export function clipKey(file: Pick<BankFile, 'fp' | 'name' | 'size'>): string {
  return file.fp ?? `${file.name}|${file.size}`
}

/** How a clip is remembered as used up (usedClips): by clipKey - or, for
 *  one taken in again on purpose, by that and when, so the earlier use
 *  never turns it away and its own use does. */
export function usedKey(file: Pick<BankFile, 'fp' | 'name' | 'size' | 'again'>): string {
  return file.again ? `${clipKey(file)}~${file.again}` : clipKey(file)
}

/** The bank, remembering those of `files` that went into videos as used,
 *  so they are never taken in again (usedClips). */
export function rememberUsed(bank: BatchBank, files: readonly BankFile[]): BatchBank {
  const keys = files.filter((f) => (bank.used[f.id] ?? 0) > 0).flatMap((f) => [clipKey(f), usedKey(f)])
  if (keys.length === 0) return bank
  return { ...bank, usedClips: [...new Set([...(bank.usedClips ?? []), ...keys])] }
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
      ...rememberUsed(bank, [...bank.reactions, ...bank.products, ...stepFiles]),
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

/** `count` of `times`, one from each of `count` equal stretches of them -
 *  for random times picked from a window, which must not all start at its
 *  first minute (dayTimes always takes the first: right for his own times,
 *  not for these). With a `seed` (the campaign and day), a different one of
 *  each stretch every day; without, its middle one. */
export function spreadPick(times: string[], count: number, seed?: string): string[] {
  const all = cleanTimes(times)
  if (count >= all.length) return all
  const random = seed ? seeded(seed) : () => 0.5
  return Array.from({ length: Math.max(0, count) }, (_, i) => all[Math.min(all.length - 1, Math.floor(((i + random()) * all.length) / count))])
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

/** How many of a campaign's batch videos were made with the file `name`, and
 *  how many of them he rejected - read off each video's file name, the files
 *  it was made of joined by " + " (a reaction first). A reaction whose videos
 *  he keeps rejecting is the one to watch and take out: 8 reactions out of 17
 *  made laggy videos every time, the others never. */
export function madeWith(
  posts: readonly { campaignId: string; fileName: string | null; status: string; batch?: unknown }[],
  campaignId: string,
  name: string,
  first: boolean,
): { made: number; rejected: number } {
  const bare = name.replace(/\.[^./]+$/, '')
  let made = 0
  let rejected = 0
  for (const post of posts) {
    if (post.campaignId !== campaignId || !post.batch || !post.fileName) continue
    const parts = post.fileName.replace(/\.[^./]+$/, '').split(' + ')
    if (!(first ? parts[0] === bare : parts.slice(1).includes(bare))) continue
    made++
    if (post.status === 'rejected') rejected++
  }
  return { made, rejected }
}

/** A batch video to be made again in another look (batchRun.changeLook): its
 *  clips as they were, and its song when it is known. */
export interface RecastFrom {
  reaction: string
  /** The product clip - or, in steps, each step's clip in order. */
  products: string[]
  /** Its song when known (a video still on this phone); otherwise his
   *  least-used one is taken. */
  music?: string | null
  /** Its headline's words; '' for Claude + X. */
  headline: string
}

/** The clips a batch video was made of, read off its file name ("IMG_0249 +
 *  IMG_0330.mp4", the reaction first - CampaignApp.addBatch), or null when one
 *  of them is no longer in the bank. */
export function recipeOf(bank: Pick<BatchBank, 'reactions' | 'products' | 'steps' | 'layout' | 'formats'>, fileName: string, headline: string): RecastFrom | null {
  if (bank.formats?.length) {
    for (const f of bank.formats) {
      const found = recipeOf(formatBank(bank as BatchBank, f), fileName, headline)
      if (found) return found
    }
    return null
  }
  const names = fileName.replace(/\.[^./]+$/, '').split(' + ')
  const first = (list: readonly BankFile[], name: string | undefined) => list.find((f) => f.name.replace(/\.[^./]+$/, '') === name)?.id
  const reaction = first(bank.reactions, names[0])
  const products = usesSteps(bank) ? bank.steps!.map((step, k) => first(step.files, names[k + 1])) : [first(bank.products, names[1])]
  if (!reaction || products.some((p) => !p)) return null
  return { reaction, products: products as string[], headline }
}

/**
 * Picks that make `videos` again in `look` - a look already in the bank's
 * mix: the same reaction and clips (and song, when known); a headline keeps
 * its words while they are still his, else takes his least-used one; Claude +
 * X its least-used amount. Never a combination already made: the next
 * headline or amount is taken instead, and a video with none left in that
 * look is null (the batch fills its day with another). The used counts and
 * made list after them, kept the way pickBatch keeps them.
 */
export function recastPicks(
  bank: BatchBank,
  videos: readonly RecastFrom[],
  look: BatchLook,
  rand: () => number = Math.random,
): { picks: (BatchPick | null)[]; used: Record<string, number>; made: string[] } {
  // With formats: each video made again from its own format's clips.
  if (bank.formats?.length) {
    const picks: (BatchPick | null)[] = videos.map(() => null)
    let used = bank.used
    let made = bank.made ?? []
    for (const f of bank.formats) {
      const sub = formatBank(bank, f)
      const mine = videos.map((v, i) => ({ v, i })).filter(({ v }) => sub.reactions.some((r) => r.id === v.reaction))
      if (mine.length === 0) continue
      const out = recastPicks({ ...sub, used, made }, mine.map(({ v }) => v), look, rand)
      mine.forEach(({ i }, k) => (picks[i] = out.picks[k]))
      used = out.used
      made = out.made
    }
    return { picks, used, made }
  }
  const mixable = mixFrom(bank, headlinesToMix(bank))
  const dims = dimensions(mixable)
  const mixing = dims.parts.size > 0
  const used = { ...bank.used }
  const made = new Set(bank.made ?? [])
  const usedOf = (key: string | null) => (key ? (used[key] ?? 0) : 0)
  /** Least used first, ties in a random order. */
  const byUse = <T>(items: readonly T[], key: (item: T) => string | null): T[] =>
    items
      .map((item) => ({ item, score: usedOf(key(item)), tie: rand() }))
      .sort((a, b) => a.score - b.score || a.tie - b.tie)
      .map(({ item }) => item)
  const headlineHooks = mixable.headlines.map((text) => ({ text, key: headlineKey(text), amount: undefined as number | undefined }))
  const picks = videos.map((v): BatchPick | null => {
    if (!dims.reactions.includes(v.reaction) || v.products.length !== dims.products.length) return null
    if (v.products.some((id, k) => !dims.products[k].includes(id))) return null
    const known = v.music !== undefined && dims.tracks.includes(v.music)
    const tracks = known ? [v.music as string | null] : byUse(dims.tracks, (m) => m)
    const hooks =
      mixing && look === 'formula'
        ? byUse(
            formulaAmounts(bank.formula ?? DEFAULT_FORMULA).map((amount) => ({ text: '', key: `a:${amount}`, amount })),
            (h) => h.key,
          )
        : [
            ...headlineHooks.filter((h) => v.headline && h.key === headlineKey(v.headline)),
            ...byUse(
              headlineHooks.filter((h) => !v.headline || h.key !== headlineKey(v.headline)),
              (h) => h.key,
            ),
          ]
    for (const h of hooks) {
      for (const m of tracks) {
        const key = comboKey(v.reaction, v.products, h.key, m, mixing ? look : null)
        if (made.has(key)) continue
        made.add(key)
        for (const k of [v.reaction, ...v.products, h.key, m, mixing ? lookKey(look) : null]) if (k) used[k] = usedOf(k) + 1
        return {
          reaction: v.reaction,
          product: v.products[0],
          ...(usesSteps(bank) ? { steps: v.products } : {}),
          headline: h.text,
          music: m,
          look,
          ...(h.amount !== undefined ? { amount: h.amount } : {}),
        }
      }
    }
    return null
  })
  const kept = [...made]
  return { picks, used, made: totalOf(dims) <= MAX_COMBOS ? kept : kept.slice(-REMEMBERED) }
}
