// On the Cutter server only (serverMode.ts): his talking videos, listened to
// and made several at once (talkOrder.ts). The phone sends a recording and an
// order to the server (server/main.mjs /talk); this reads the waiting orders
// from it (/local/talk), runs them, and writes back how far each is and what
// it found. A made video goes to Postiz from here, through the same send
// queue, under the key the phone gave it - one post, whoever sends it.
//
// Measured in Chrome on a 4-core machine (2026-11-04), five 61 s 1080p
// talking videos: listening took 26 s for one and 32 s for all five at once;
// making took 23 s for one and 108 s for five - making uses every core, so
// it is the number of cores, not the order, that sets how long it takes.

import { withHeadlinePlace, withHeadlineStyle, type AngleMusic } from './look'
import { findSong, songFile } from './musicBank'
import { queueSend } from './outbox'
import { listen, make } from './pipeline'
import { serverLog } from './serverMode'
import { loadBank, loadCampaigns } from './store'
import type { ListenOrder, MakeOrder, TalkState } from './talkOrder'
import { SilenceCutError } from '../media/errors'

/** How many at once, from the memory the server may use: listening holds
 *  the speech model (about 1.2 GB each), making about 2 GB each, and the
 *  batches being made meanwhile need room too. Listening is mostly waiting on
 *  the model and shares the machine well; making takes every core it can get.
 *  Railway's Hobby plan (8 GB): 4 listening, 2 making. */
export function atOnce(memoryGB: number | null | undefined): { listen: number; make: number } {
  if (!memoryGB) return { listen: 4, make: 2 }
  const spare = memoryGB - 2.5
  return { listen: Math.max(1, Math.min(4, Math.floor(spare / 1.2))), make: Math.max(1, Math.min(2, Math.floor(spare / 2.5))) }
}
const LOOK_EVERY_MS = 2000
const PROGRESS_EVERY_MS = 2000

interface Record {
  id: string
  kind: 'listen' | 'make'
  order: ListenOrder | MakeOrder
}

const running = new Map<string, 'listen' | 'make'>()

async function tell(id: string, kind: 'listen' | 'make', fields: { state: TalkState; progress?: number; plan?: unknown; error?: string; made?: unknown }): Promise<void> {
  await fetch(`/local/talk/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ kind, ...fields }) }).catch(() => {})
}

/** How far it is, said at most every couple of seconds. */
function progressTo(id: string, kind: 'listen' | 'make', state: TalkState): (fraction: number) => void {
  let last = 0
  return (fraction) => {
    const now = Date.now()
    if (now - last < PROGRESS_EVERY_MS) return
    last = now
    void tell(id, kind, { state, progress: Math.max(0, Math.min(1, fraction)) })
  }
}

async function fileOf(fileId: string, name = fileId): Promise<File> {
  const res = await fetch(`/local/files/${encodeURIComponent(fileId)}`)
  if (!res.ok) throw new SilenceCutError('The recording never reached the server whole. The phone sends it again.')
  const blob = await res.blob()
  return new File([blob], name, { type: blob.type || 'video/mp4' })
}

async function runListen(order: ListenOrder): Promise<void> {
  await tell(order.id, 'listen', { state: 'listening', progress: 0 })
  const file = await fileOf(order.fileId, `${order.id}.mp4`)
  const onProgress = progressTo(order.id, 'listen', 'listening')
  const plan = await listen(
    file,
    order.settings,
    { cleanSpeech: order.cleanSpeech, hear: true, names: order.names, align: order.align, keepWhole: order.keepWhole },
    {
      onAnalyseProgress: (p) => onProgress(p * 0.2),
      onTranscribeProgress: (p) => onProgress(0.2 + p * 0.8),
    },
  )
  await tell(order.id, 'listen', { state: 'listened', progress: 1, plan })
}

async function musicOf(order: MakeOrder, level: AngleMusic['level'] | undefined, campaigns: Awaited<ReturnType<typeof loadCampaigns>>): Promise<AngleMusic | null | undefined> {
  const picked = order.music
  if (picked === 'none') return null
  if (!picked) return undefined
  if (picked.startsWith('bank:')) {
    const song = await findSong(picked.slice('bank:'.length))
    const audio = song ? await songFile(song) : null
    if (!song || !audio) throw new SilenceCutError('The song picked for this video is no longer in the music bank. Pick another and make it again.')
    return { name: song.name, audio, level: level ?? 'normal' }
  }
  const [campaignId, angleId] = picked.split(':')
  return campaigns.find((c) => c.id === campaignId)?.angles.find((a) => a.id === angleId)?.music ?? undefined
}

async function runMake(order: MakeOrder): Promise<void> {
  await tell(order.id, 'make', { state: 'making', progress: 0 })
  const campaigns = await loadCampaigns()
  const campaign = campaigns.find((c) => c.id === order.campaignId)
  const own = campaign?.angles.find((a) => a.id === order.angleId)
  if (!campaign || !own) throw new SilenceCutError("The server doesn't have this campaign yet - it makes it on the phone.")
  const placed = withHeadlinePlace(withHeadlineStyle(own, order.headlineStyle), order.headlinePlace)
  const angle = order.headlineSeconds ? { ...placed, headline: { ...placed.headline, seconds: order.headlineSeconds } } : placed
  const file = await fileOf(order.fileId, order.send.fileName)
  const bank = await loadBank()
  const clips = {
    ...(order.clips.before ? { before: await fileOf(order.clips.before) } : {}),
    ...(order.clips.after ? { after: await fileOf(order.clips.after) } : {}),
    ...(order.clips.cues?.length ? { cues: await Promise.all(order.clips.cues.map(async (c) => ({ phrase: c.phrase, file: await fileOf(c.fileId) }))) } : {}),
    ...(order.clips.missing?.length ? { missing: order.clips.missing } : {}),
    ...(order.clips.cuesMissing ? { cuesMissing: order.clips.cuesMissing } : {}),
    ...(order.clips.muted?.length ? { muted: order.clips.muted } : {}),
  }
  const manual: { picture: MakeOrder['manual'][number]['picture']; image: Blob }[] = []
  for (const m of order.manual) {
    const image = m.fileId
      ? await fileOf(m.fileId).catch(() => null)
      : m.picture.source.kind === 'bank'
        ? (bank.find((b) => b.id === (m.picture.source as { pictureId: string }).pictureId)?.image ?? null)
        : null
    if (image) manual.push({ picture: m.picture, image })
  }
  const videos = await Promise.all(order.byHand.videos.map(async (v) => ({ picture: v.picture, file: await fileOf(v.fileId).catch(() => null) })))
  const sounds = await Promise.all((order.byHand.sounds ?? []).map(async (v) => ({ picture: v.picture, file: v.fileId ? await fileOf(v.fileId).catch(() => null) : null })))
  const result = await make(
    file,
    order.plan,
    campaign,
    angle,
    bank,
    order.headlineText,
    order.id,
    progressTo(order.id, 'make', 'making'),
    false,
    order.captions,
    order.voice,
    await musicOf(order, own.music?.level, campaigns),
    clips,
    order.defaults,
    order.skipPictures,
    order.captionPosition,
    order.noCut,
    manual,
    order.captionSize,
    order.captionStyle,
    {
      videos: order.pops.videos,
      sizePct: order.pops.sizePct,
      position: order.pops.position,
      load: async (id) => (order.pops.files[id] ? fileOf(order.pops.files[id]).catch(() => null) : null),
    },
    {
      texts: order.byHand.texts,
      videos: videos.filter((v): v is { picture: typeof v.picture; file: File } => v.file !== null),
      sounds: sounds.filter((v) => v.file !== null || (v.picture.source.kind === 'sound' && v.picture.source.from === 'effect')),
    },
  )
  // The look didn't go on: the phone makes it itself, where he sees why.
  if (result.lookFailed) throw new SilenceCutError(result.lookFailed)
  await queueSend(
    {
      key: order.send.key,
      profileId: order.send.profileId,
      campaign: order.send.campaign,
      meta: { transcript: order.send.transcript, headline: result.headline, duration: result.newDurationSec, fileName: order.send.fileName },
    },
    result.blob,
  )
  await tell(order.id, 'make', { state: 'made', progress: 1, made: { headline: result.headline, seconds: result.newDurationSec } })
}

async function run(record: Record): Promise<void> {
  running.set(record.id, record.kind)
  try {
    if (record.kind === 'listen') await runListen(record.order as ListenOrder)
    else await runMake(record.order as MakeOrder)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    serverLog(`talking video ${record.id} (${record.kind}) failed: ${why}`)
    await tell(record.id, record.kind, { state: 'failed', error: why })
  } finally {
    running.delete(record.id)
  }
}

const count = (kind: 'listen' | 'make') => [...running.values()].filter((k) => k === kind).length

/** Takes waiting orders as there is room, for as long as the page is open. */
export async function talkLoop(): Promise<void> {
  for (;;) {
    try {
      const res = await fetch('/local/talk')
      const { talk, room } = (await res.json()) as { talk: Record[]; room?: { memoryGB?: number | null } }
      const most = atOnce(room?.memoryGB)
      // Oldest first: the order he pasted them in.
      for (const record of talk) {
        if (running.has(record.id)) continue
        const free = record.kind === 'listen' ? most.listen - count('listen') : most.make - count('make')
        if (free <= 0) continue
        void run(record)
      }
    } catch (error) {
      serverLog(`talking videos: ${error instanceof Error ? error.message : String(error)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY_MS))
  }
}
