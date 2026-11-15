// Fills this browser's Cutter storage with the demo's made-up phone: three
// brands, their angles and posting rules, two batches with their clips and
// songs, two videos waiting on the Videos tab, and the music bank. The
// footage is a drawn creator with a robot voice (docs/guide/tools/
// make_demo_media.py) - no real person, brand or voice.

import type { CaptionWord } from '../campaign/captions'
import type { BankFile, BatchBank } from '../campaign/batch'
import { CLIP_MADE } from '../campaign/clipEdit'
import { NO_EFFECTS } from '../campaign/effects'
import { blankAngle, generalAngle, generalCampaign, type Angle, type Campaign } from '../campaign/look'
import { saveMusicBank, type Song } from '../campaign/musicBank'
import { saveSession } from '../campaign/motion/session'
import { REWORD_CHECK } from '../campaign/trialLoop'
import { fakeStoryboard } from '../../supabase/functions/postiz/motion.ts'
import type { CampaignPlan } from '../campaign/plan'
import { keepPosting } from '../campaign/posting'
import { persistJob, saveBankFile, saveBankPicture, saveBatchBank, saveCampaign, saveFormatScript } from '../campaign/store'
import { PRESETS } from '../media/silenceMath'
import { addDays, localDate } from '../../supabase/functions/postiz/slots.ts'
import { CAMPAIGN_IDS, DEMO_NAME, FITPOCKET_HEADLINES, MOONBREW_HEADLINES, type World } from './world'

const media = import.meta.glob('./media/*.{mp4,m4a,png}', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const words = import.meta.glob('./media/*.words.json', { import: 'default', eager: true }) as Record<string, { duration: number; words: CaptionWord[] }>

/** A demo file's address on this computer, by its name without ending. */
export function mediaUrl(name: string): string {
  const hit = Object.entries(media).find(([path]) => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '') === name)
  return hit ? hit[1] : ''
}

async function file(name: string): Promise<Blob> {
  const response = await fetch(mediaUrl(name))
  return response.blob()
}

/** What a video's listening would have found: the words as timed, each line
 *  kept from just before its first word to just after its last, and an "um"
 *  or "uh" cut out on its own. */
export function planOf(name: string): CampaignPlan {
  const heard = words[`./media/${name}.words.json`]
  if (!heard) throw new Error(`No words for ${name}`)
  const keep: { start: number; end: number }[] = []
  let fillers = 0
  let open: { start: number; end: number } | null = null
  const all = heard.words
  for (let i = 0; i < all.length; i++) {
    const w = all[i]
    const filler = /^(um|uh),?$/i.test(w.text)
    if (filler) {
      fillers++
      if (open) keep.push(open)
      open = null
      continue
    }
    const gap = open ? w.start - open.end : 0
    if (open && gap > 0.55) {
      keep.push(open)
      open = null
    }
    if (!open) open = { start: Math.max(0, w.start - 0.12), end: w.end + 0.15 }
    else open.end = w.end + 0.15
  }
  if (open) keep.push(open)
  const clean = all.filter((w) => !/^(um|uh),?$/i.test(w.text))
  return {
    keep: keep.map((k) => ({ start: k.start, end: Math.min(heard.duration, k.end) })),
    duration: heard.duration,
    silences: Math.max(0, keep.length - 1 - fillers),
    fillerWords: fillers,
    stutters: 0,
    words: all.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    spoken: clean.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    aligned: true,
    cleanSpeech: true,
  }
}

/** The talking head format's speed, every clip already made at it. */
const TALK_SPEED = { speed: 1.1, made: CLIP_MADE } as const

const logoFile = async (id: string, name: string): Promise<BankFile> => {
  const blob = await file(name)
  await saveBankFile(id, blob)
  return { id, name: `${name}.png`, type: 'image/png', size: blob.size }
}

const bankFile = async (id: string, name: string, extra: Partial<BankFile> = {}): Promise<BankFile> => {
  const blob = await file(name)
  await saveBankFile(id, blob)
  const ext = name.startsWith('song') ? 'm4a' : 'mp4'
  return { id, name: `${name}.${ext}`, type: ext === 'm4a' ? 'audio/mp4' : 'video/mp4', size: blob.size, seconds: name.startsWith('song') ? 20 : name.startsWith('react') ? 4 : name.startsWith('product') ? 5 : 6, ...extra }
}

function angle(id: string, name: string, fields: Partial<Angle> & { headlineText?: string; fromFirstLine?: boolean; style?: Angle['headline']['style'] }): Angle {
  const a = blankAngle(id, name)
  return {
    ...a,
    ...fields,
    headline: { ...a.headline, text: fields.headlineText ?? '', fromFirstLine: fields.fromFirstLine, style: fields.style ?? 'outline' },
    effects: fields.effects ?? { ...NO_EFFECTS },
  }
}

export async function seedPhone(world: World, now = Date.now()): Promise<void> {
  // Signed in as the made-up creator, posting set up on this phone.
  localStorage.setItem('cutter.session', JSON.stringify({ name: DEMO_NAME, token: 'demo-token' }))
  keepPosting({ profile: world.profile, sendHere: true })

  const tz = world.profile.timezone
  const today = localDate(new Date(now), tz)

  const moonbrew: Campaign = {
    id: CAMPAIGN_IDS.moonbrew,
    name: 'Moonbrew',
    logo: await file('logo-moonbrew'),
    brandWords: ['Moonbrew'],
    updatedAt: now,
    posting: {
      caption: 'claude',
      rules: 'Friendly and short. End with a question to the viewer.',
      hashtags: ['#moonbrewpartner'],
      approval: 'me',
      remind: true,
      byKind: { talking: '#advancedpost', reaction: '#basicpost' },
    },
    angles: [],
  }
  moonbrew.angles = [
    angle('mb-morning', 'Morning routine', { headlineText: MOONBREW_HEADLINES[0], recognize: ['morning', 'mornings'], effects: { cutPunch: 'subtle', hookPush: 'subtle', brandHit: 'off', logoPop: true } }),
    angle('mb-money', 'Money saved', { fromFirstLine: true, style: 'box', recognize: ['money', 'saved'] }),
    generalAngle(moonbrew),
  ]
  const fitpocket: Campaign = {
    id: CAMPAIGN_IDS.fitpocket,
    name: 'FitPocket',
    logo: await file('logo-fitpocket'),
    brandWords: ['FitPocket'],
    updatedAt: now,
    posting: { caption: 'claude', rules: '', hashtags: ['#fitpocketpartner'], approval: 'me', remind: false },
    angles: [],
  }
  fitpocket.angles = [angle('fp-streak', 'Streak', { headlineText: FITPOCKET_HEADLINES[0], recognize: ['streak', 'workout'] }), angle('fp-week', 'Plans my week', { headlineText: FITPOCKET_HEADLINES[1], recognize: ['week', 'plans'] }), generalAngle(fitpocket)]
  const notely: Campaign = {
    id: CAMPAIGN_IDS.notely,
    name: 'Notely',
    logo: await file('logo-notely'),
    brandWords: ['Notely'],
    format: 'reaction',
    switchSound: 'whoosh',
    updatedAt: now,
    angles: [],
  }
  notely.angles = [angle('nt-react', 'Reaction', { headlineText: 'I can’t believe this note app is free' }), generalAngle(notely)]
  // A format: its look (an angle marked as a format) and, below, its script.
  moonbrew.angles.splice(2, 0, { ...angle('mb-format', 'Day in the life', { headlineText: 'A day with my coffee app', style: 'box' }), isFormat: true })
  const trial: Campaign = { id: CAMPAIGN_IDS.trial, name: 'Trial reels', logo: null, brandWords: [], format: 'reaction', trial: true, updatedAt: now, posting: { caption: 'claude', rules: '', hashtags: [], approval: 'me', remind: false }, angles: [] }
  trial.angles = [generalAngle(trial)]
  for (const campaign of [generalCampaign(), moonbrew, fitpocket, notely, trial]) await saveCampaign(campaign, { asIs: true })

  // The picture bank: the logos, brought up by their names.
  await saveBankPicture({ id: 'pic-moonbrew', image: await file('logo-moonbrew'), words: ['Moonbrew'], addedAt: now - 3 * 86_400_000 })
  await saveBankPicture({ id: 'pic-notely', image: await file('logo-notely'), words: ['Notely', 'notes app'], addedAt: now - 2 * 86_400_000 })

  // The music bank.
  const songs: Song[] = [await bankFile('song-bank-sunny', 'song-sunny', { name: 'Sunny loop.m4a' }), await bankFile('song-bank-night', 'song-night', { name: 'Night drive.m4a' })]
  await saveMusicBank(songs)

  // Moonbrew's batch: a reaction format and a talking head with steps.
  const reacts = [await bankFile('mb-react-1', 'react-1', { formats: ['fmt-react'] }), await bankFile('mb-react-2', 'react-2', { formats: ['fmt-react'] }), await bankFile('mb-react-3', 'react-3', { formats: ['fmt-react'] })]
  // His hooks with their words already checked, and the steps' clips with no
  // talking: nothing to listen to, so the demo never needs the speech model.
  const heardIn = (name: string): CaptionWord[] => (words[`./media/${name}.words.json`]?.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end }))
  const hooks = [
    await bankFile('mb-hook-1', 'hook-1', { formats: ['fmt-talk'], talks: true, edited: true, checked: true, captions: heardIn('hook-1'), ...TALK_SPEED }),
    await bankFile('mb-hook-2', 'hook-2', { formats: ['fmt-talk'], talks: true, edited: true, checked: true, captions: heardIn('hook-2'), ...TALK_SPEED }),
  ]
  const products = [await bankFile('mb-product-1', 'product-1', { formats: ['fmt-react'] }), await bankFile('mb-product-2', 'product-2', { formats: ['fmt-react'] }), await bankFile('mb-product-3', 'product-3', { formats: ['fmt-react'] })]
  // Already at the format's speed and as each step says (cut, or raw as
  // filmed), so nothing is made again when the format is opened.
  const stepClip = async (id: string, name: string, raw = false) => bankFile(id, name, { formats: ['fmt-talk'], checked: true, captions: [], ...TALK_SPEED, ...(raw ? { ownCut: true } : { edited: true }) })
  const filled: Record<string, number> = {}
  for (let d = 0; d < 3; d++) filled[addDays(today, d)] = 4
  const moonBatch: BatchBank = {
    campaignId: CAMPAIGN_IDS.moonbrew,
    angleId: 'mb-morning',
    reactions: [...reacts, ...hooks],
    products,
    headlines: MOONBREW_HEADLINES,
    music: [await bankFile('mb-song-1', 'song-sunny', { name: 'Sunny loop.m4a' }), await bankFile('mb-song-2', 'song-night', { name: 'Night drive.m4a' })],
    perDay: 4,
    days: 7,
    running: true,
    startedAt: new Date(now - 9 * 86_400_000).toISOString(),
    filled,
    used: {},
    looks: [
      { look: 'outline', parts: 2 },
      { look: 'box', parts: 1 },
    ],
    // Its Claude + X logos, for when that look is picked: two made-up ones.
    formula: { left: await logoFile('mb-formula-left', 'logo-moonbrew'), right: await logoFile('mb-formula-right', 'logo-notely'), leftName: 'Moonbrew', rightName: 'Notely', min: 500, max: 1000 },
    formats: [
      { id: 'fmt-react', kind: 'reaction', name: 'Reaction - shocked' },
      { id: 'fmt-talk', kind: 'talking', name: 'Talking head', speed: 1.1, dropHooks: true },
    ],
    steps: [
      { id: 'st-open', name: 'Open the app', files: [await stepClip('mb-step-1a', 'product-1'), await stepClip('mb-step-1b', 'product-2')], formats: ['fmt-talk'], clips: 'cut' },
      { id: 'st-plan', name: 'Your plan', files: [await stepClip('mb-step-2a', 'product-2')], formats: ['fmt-talk'] },
      { id: 'st-save', name: 'Savings', files: [await stepClip('mb-step-3a', 'product-3', true)], formats: ['fmt-talk'], clips: 'raw' },
    ],
  }
  await saveBatchBank(moonBatch)

  // FitPocket's batch: reactions only, on three days a week.
  const fitBatch: BatchBank = {
    campaignId: CAMPAIGN_IDS.fitpocket,
    angleId: 'fp-streak',
    reactions: [await bankFile('fp-react-1', 'react-1', { formats: ['fmt-fp'] }), await bankFile('fp-react-2', 'react-2', { formats: ['fmt-fp'] }), await bankFile('fp-react-3', 'react-3', { formats: ['fmt-fp'] })],
    products: [await bankFile('fp-product-1', 'product-2', { formats: ['fmt-fp'] }), await bankFile('fp-product-2', 'product-3', { formats: ['fmt-fp'] })],
    headlines: FITPOCKET_HEADLINES,
    music: [await bankFile('fp-song-1', 'song-night', { name: 'Night drive.m4a' })],
    perDay: 3,
    days: 7,
    running: true,
    startedAt: new Date(now - 20 * 86_400_000).toISOString(),
    filled: { [today]: 3, [addDays(today, 1)]: 3, [addDays(today, 2)]: 3 },
    used: {},
    looks: [{ look: 'outline', parts: 1 }],
    formats: [{ id: 'fmt-fp', kind: 'reaction', name: 'Reaction' }],
  }
  await saveBatchBank(fitBatch)

  // The Trial reels loop: one reel that went well, made again and again.
  const trialClip = await bankFile('tr-clip-1', 'react-2', { name: 'viral-coffee-clean.mp4' })
  const trialSound = await bankFile('tr-sound-1', 'song-sunny', { name: 'viral-coffee-sound.m4a' })
  await saveBatchBank({
    campaignId: CAMPAIGN_IDS.trial,
    angleId: trial.angles[0].id,
    layout: 'trial',
    reactions: [trialClip],
    products: [],
    headlines: [],
    music: [trialSound],
    perDay: 3,
    days: 7,
    running: true,
    startedAt: new Date(now - 2 * 86_400_000).toISOString(),
    filled: { [today]: 3, [addDays(today, 1)]: 3, [addDays(today, 2)]: 3 },
    used: {},
    trial: {
      sources: [
        {
          id: 'ts-1',
          name: 'viral-coffee-reel.mp4',
          clip: trialClip.id,
          sound: trialSound.id,
          read: { text: 'POV: your coffee knows your schedule', style: 'outline', outlineColor: '#000000', size: 'medium', x: 0.5, y: 0.2, rewordings: ['POV: my coffee knows my schedule', 'When your coffee knows your schedule'], checked: REWORD_CHECK },
          addedAt: now - 2 * 86_400_000,
        },
      ],
    },
  })

  // Motion graphics, left at its plan: the video heard, checked and planned.
  const plan = planOf('talk-moonbrew')
  await saveSession({ id: 'demo-motion', file: await file('talk-moonbrew'), fileName: 'Morning coffee take.mp4', ask: 'Make the money numbers big', format: 'board', plan, storyboard: fakeStoryboard(plan.spoken?.length ?? plan.words.length, 'board'), chat: [], checked: true, costCents: 2 })

  // The format's script: three lines, takes of the first two.
  await saveFormatScript({
    angleId: 'mb-format',
    lines: [
      { id: 'ln-1', words: 'My coffee app woke me up at the right time', takes: [await bankFile('fm-take-1', 'hook-1', { name: 'take 1.mp4' }), await bankFile('fm-take-2', 'hook-2', { name: 'take 2.mp4' })] },
      { id: 'ln-2', words: 'It planned my whole morning', takes: [await bankFile('fm-take-3', 'talk-moonbrew', { name: 'take 3.mp4' })] },
      { id: 'ln-3', words: 'Comment COFFEE for the link', takes: [] },
    ],
    uses: {},
    opened: [],
  })

  // Two videos on the Videos tab: one sorted and waiting for its caption
  // check, one that needs him to say which angle.
  const settings = PRESETS.balanced
  const morning = await file('talk-moonbrew')
  await persistJob({
    id: 'demo-job-1',
    fileName: 'Morning coffee take.mp4',
    fileType: 'video/mp4',
    campaignId: CAMPAIGN_IDS.moonbrew,
    angleId: 'mb-morning',
    headlineText: MOONBREW_HEADLINES[0],
    settings,
    cleanSpeech: true,
    filmedAt: now - 40 * 60_000,
    seconds: planOf('talk-moonbrew').duration,
    day: { plan: planOf('talk-moonbrew'), guess: { campaignId: CAMPAIGN_IDS.moonbrew, angleId: 'mb-morning', sure: true, why: 'Heard "mornings"' }, approved: false },
    fileBlob: morning,
  })
  const workout = await file('talk-fitpocket')
  await persistJob({
    id: 'demo-job-2',
    fileName: 'Workout app take.mp4',
    fileType: 'video/mp4',
    campaignId: CAMPAIGN_IDS.fitpocket,
    angleId: 'fp-streak',
    headlineText: FITPOCKET_HEADLINES[0],
    settings,
    cleanSpeech: true,
    filmedAt: now - 25 * 60_000,
    seconds: planOf('talk-fitpocket').duration,
    day: { plan: planOf('talk-fitpocket'), guess: { campaignId: CAMPAIGN_IDS.fitpocket, angleId: 'fp-streak', sure: false, why: 'Heard "workout", but not which angle' }, approved: false },
    fileBlob: workout,
  })
}
