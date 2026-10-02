// This section's own storage: the campaign looks, and its own queue.
//
// A separate database from the plain cutter's queue on purpose - nothing here
// can upgrade, clear or collide with it. The queue works the same way as that
// one, for the same hard-learned reasons (see media/jobStore.ts): the video is
// kept so it survives the tab being killed, it is only read back when its
// turn comes, and every attempt is counted before it starts so a video heavy
// enough to kill the tab cannot do it in a loop.

import Dexie, { type EntityTable } from 'dexie'

import type { Range, SilenceSettings } from '../media/silenceMath'
import { orTimeout, within } from '../media/within'
import { NO_EFFECTS } from './effects'
import {
  NO_BANK,
  firstAngleId,
  upgradeV1,
  withGeneralAngle,
  type AngleSound,
  type BankPicture,
  type Campaign,
  type CampaignPosting,
  type CampaignV1,
  type PictureCue,
} from './look'
import type { BankFile, BatchBank } from './batch'
import type { MusicLevel } from './music'
import type { CaptionWord } from './captions'
import type { CampaignPlan } from './plan'
import type { Guess } from './sort'

export type JobPhase = 'reading' | 'model' | 'listening' | 'cutting' | 'joining'

interface StoredJob {
  id: string
  fileName: string
  fileType: string
  campaignId: string
  angleId: string
  headlineText: string
  settings: SilenceSettings
  cleanSpeech: boolean
  attempts: number
  lastPhase?: JobPhase
  addedAt: number
  /** Why it failed, when it did. A failed video is kept - the video too -
   *  so he can try it again, even after the page restarts, instead of
   *  having to find it and add it again. */
  failed?: string
  /** A video from a dropped day, sorted before it is made. Absent for one
   *  added to a campaign and angle he picked himself. */
  day?: {
    /** What was heard, once it has been listened to - kept so approving it
     *  later does not mean listening again. */
    plan?: CampaignPlan
    guess?: Guess
    /** He said yes to the campaign, angle and headline. */
    approved: boolean
    /** Added for a campaign and angle he picked himself: listened to for
     *  its captions, not sorted. */
    chosen?: boolean
    /** The captions as he checked them - the words heard, with any he
     *  corrected. Absent until he opens them. */
    captions?: CaptionWord[]
    /** He went through the captions. */
    checked?: boolean
    /** He found them no good: made without captions. */
    noCaptions?: boolean
    /** Captions start with the first word, hook and all, instead of after
     *  the headline. Asked each time the captions are checked. */
    hookCaptions?: boolean
    /** The kept parts as he fixed them by hand (see cuts.ts), in place of
     *  the plan's. Absent when he left the cut as it was found. */
    keep?: Range[]
    /** The track under this video: an angle's, as "campaignId:angleId", or
     *  "none". Absent means the video's own angle's. */
    music?: string
    /** No default effects on this video (its angle's own still apply). */
    noEffects?: boolean
    /** Picture ids left out of this video alone. */
    skipPictures?: string[]
    /** The videos joined on before and after this one: a clip's id, or
     *  "none". Absent means the angle's own - see clips.ts. */
    clips?: JobClips
    /** A video filmed as separate recordings, joined: the recordings, in
     *  order. They are kept, hidden, so it can be split apart again. */
    parts?: string[]
  }
  /** A reaction video: this job's own video is the reaction clip, and the
   *  product clip - often the same one for a whole batch - is kept once,
   *  under its own id. */
  reaction?: ReactionParts
  /** A video of clips and music, no talking: this job's own video is the
   *  first clip, the rest are kept under it. */
  montage?: MontageParts
  /** Made from the Batch tab, for this day and time. */
  batch?: JobBatch
  /** Recordings he joined before anything else: this job's own video is the
   *  first until they are put together, the rest are kept under it. */
  prejoin?: { clips: { name: string; type: string }[] }
  /** Made for the next days: posted on its campaign's times from tomorrow,
   *  never squeezed into today. */
  later?: boolean
  /** When it was filmed and how long it is, from the file: two recordings
   *  filmed moments apart are offered to be joined. */
  filmedAt?: number
  seconds?: number
  /** A recording that is now part of a joined video, hidden until that is
   *  split apart or made. */
  joinedInto?: string
  /** When it was made. Its recording, listening and edits are kept for
   *  EDIT_WINDOW_MS after, so he can fix a caption, a cut or the music and
   *  make it again - then they go. A made job is never picked up as one
   *  still to make. */
  madeAt?: number
  /** How many times it has been made again. The post's key carries it, so
   *  each go is its own post on the server. */
  version?: number
  /** The post key this go replaces, retired when the new one is sent. */
  replaces?: string
}

/** How long a made video can still be edited and made again. */
export const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000

/** The key a job's post goes under: the job's id for the first go,
 *  `id~2`, `id~3` for each go after. */
export function postKeyOf(id: string, version = 1): string {
  return version > 1 ? `${id}~${version}` : id
}

/** The job a post key was made from. */
export function jobOfPostKey(key: string): string {
  return key.split('~')[0]
}

/** A video's own pick of the clips joined on before and after it. */
export interface JobClips {
  before?: string
  after?: string
}

export interface ReactionParts {
  productId: string
  productName: string
  productType: string
}

/** A video from the Batch tab: the making it came from, the day and time
 *  it posts at, and how many that making made. */
export interface JobBatch {
  id: string
  date: string
  time: string
  size: number
}

/** A clips-and-music video's other files, by name and type: the clips after
 *  the first, in order, and a song he picked from his phone for it. */
export interface MontageParts {
  /** From a batch: the reaction, product and track are the bank's own,
   *  read from it when the video is made - nothing is kept twice. */
  bank?: { reaction: BankFile; product: BankFile; music: BankFile | null }
  clips: { name: string; type: string }[]
  /** The track under it: "" for its angle's, "none", another angle's as
   *  "campaignId:angleId", or "song" for the song kept with it. */
  music: string
  song?: { name: string; type: string }
}

export type PendingJob = Omit<StoredJob, 'addedAt'>

/** A queued video, kept under its job's id and apart from the job's row: on
 *  an iPhone, storing a video read back out of the database fails, so a row
 *  holding one could never be changed again - not its attempt count, not
 *  what the listen found. See media/jobStore.ts. */
interface StoredVideo {
  id: string
  blob: Blob
}

export const MAX_ATTEMPTS = 2

/** A campaign's logo and sound files, kept as bytes rather than as Blobs.
 *  WebKit refuses to put a Blob in the database in some modes ("Error
 *  preparing Blob/File data to be stored"), and these files are small - a
 *  logo, a second of sound - so bytes cost nothing. The videos themselves stay
 *  Blobs: reading one into bytes would hold the whole thing in memory. */
interface StoredFile {
  bytes: ArrayBuffer
  type: string
}

type StoredSound = Omit<AngleSound, 'source'> & {
  source: { kind: 'built-in'; name: string } | { kind: 'file'; name: string; audio: StoredFile }
}

type StoredPicture = Omit<PictureCue, 'image'> & { image: StoredFile }

type StoredCampaign = Omit<Campaign, 'logo' | 'angles'> & {
  logo: StoredFile | null
  angles: (Omit<Campaign['angles'][number], 'sounds' | 'pictures' | 'music'> & {
    sounds: StoredSound[]
    music?: { name: string; audio: StoredFile; level: MusicLevel } | null
    /** Missing on angles saved before pictures existed. */
    pictures?: StoredPicture[]
  })[]
}

type StoredBankPicture = Omit<BankPicture, 'image'> & {
  image: StoredFile
  /** When it was last changed, for sharing: the newer change wins. Missing
   *  on pictures added before sharing existed. */
  updatedAt?: number
}

/** A change still to be sent to the shared login. */
export interface OutboxEntry {
  key: string
  kind: 'campaign' | 'bank'
  id: string
  updatedAt: number
  deleted: boolean
}

/** A finished video on its way to Postiz - see outbox.ts. */
export interface SendEntry {
  /** The job's id: also the post's own id on the server, so sending it
   *  twice makes one post. A video posted by hand has one worked out from
   *  what is in it, the campaign and the day (NewPost), so picking or tapping
   *  it again lands on the same key instead of making a second post. */
  key: string
  /** Content fingerprint of the picked file (fingerprint.ts), for a video
   *  posted by hand. */
  fp?: string
  profileId: string
  campaign: { id: string; name: string; posting: CampaignPosting }
  meta: {
    transcript: string
    headline: string
    duration: number
    fileName: string
    later?: boolean
    /** Made by hand from New post: a finished video, sent as it is, at this
     *  time (none for straight away) - or spread over the campaign's times
     *  with the rest of its batch - with his caption or none for Claude to
     *  write, and what it is about. */
    byHand?: { at: string | null; caption: string; about: string; spread?: boolean }
    /** Made from the Batch tab: waits for his approval, for this day and time. */
    batch?: JobBatch
  }
  size: number
  /** Where the phone's own copy is: the browser's private files, or - on a
   *  browser that cannot write those - the database. */
  where: 'opfs' | 'idb'
  /** sending: still going up. sent: the server has it all. */
  state: 'sending' | 'sent'
  postId?: string
  error?: string
  tries: number
  addedAt: number
}

/** A clip kept on this phone to join onto videos - a hook before, a
 *  showcase after. Its bytes are in clipParts, a few MB a piece. Never
 *  shared: it is his own footage. */
export interface StoredClip {
  id: string
  name: string
  type: string
  size: number
  seconds: number
  addedAt: number
}

/** A file known by its contents' hash, and whether the shared login has it. */
interface CachedFile {
  sha: string
  bytes: ArrayBuffer
  type: string
  uploaded: boolean
}

// The table is still called "looks": that is what it was called when each
// campaign had one look, and renaming a table means copying every row.
const db = new Dexie('silence-cutter-campaigns') as Dexie & {
  looks: EntityTable<StoredCampaign, 'id'>
  jobs: EntityTable<StoredJob, 'id'>
  videos: EntityTable<StoredVideo, 'id'>
  bank: EntityTable<StoredBankPicture, 'id'>
  outbox: EntityTable<OutboxEntry, 'key'>
  files: EntityTable<CachedFile, 'sha'>
  meta: EntityTable<{ key: string; value: string }, 'key'>
  sends: EntityTable<SendEntry, 'key'>
  sendVideos: EntityTable<{ key: string; bytes: ArrayBuffer }, 'key'>
  clips: EntityTable<StoredClip, 'id'>
  clipParts: EntityTable<{ key: string; bytes: ArrayBuffer }, 'key'>
}
db.version(1).stores({ looks: 'id, updatedAt', jobs: 'id, addedAt' })
// Angles. Every campaign set up before them becomes one with a single angle,
// "Angle 1", holding exactly the format it had; a video still in the queue
// is pointed at that angle. See upgradeV1.
db.version(2)
  .stores({ looks: 'id, updatedAt', jobs: 'id, addedAt' })
  .upgrade(async (tx) => {
    await tx
      .table('looks')
      .toCollection()
      .modify((row: Record<string, unknown>, ref: { value: unknown }) => {
        if ('headline' in row) ref.value = upgradeV1<StoredFile>(row as unknown as CampaignV1)
      })
    await tx
      .table('jobs')
      .toCollection()
      .modify((job: Record<string, unknown>) => {
        if (typeof job.lookId === 'string' && job.campaignId === undefined) {
          job.campaignId = job.lookId
          job.angleId = firstAngleId(job.lookId)
          delete job.lookId
        }
      })
  })

// The picture bank.
db.version(3).stores({ looks: 'id, updatedAt', jobs: 'id, addedAt', bank: 'id, addedAt' })
// Sharing: changes waiting to be sent, files by their hash, and how far the
// last fetch got.
db.version(4).stores({
  looks: 'id, updatedAt',
  jobs: 'id, addedAt',
  bank: 'id, addedAt',
  outbox: 'key',
  files: 'sha',
  meta: 'key',
})
// Videos out of the job rows. Rows from before are dropped rather than
// moved: moving means storing their videos again, the very thing that fails,
// and a failure inside an upgrade would stop the database opening at all.
db.version(5)
  .stores({
    looks: 'id, updatedAt',
    jobs: 'id, addedAt',
    videos: 'id',
    bank: 'id, addedAt',
    outbox: 'key',
    files: 'sha',
    meta: 'key',
  })
  .upgrade((tx) => tx.table('jobs').clear())
// Posting: finished videos on their way to Postiz. Two new tables, nothing
// else touched.
db.version(6).stores({
  looks: 'id, updatedAt',
  jobs: 'id, addedAt',
  videos: 'id',
  bank: 'id, addedAt',
  outbox: 'key',
  files: 'sha',
  meta: 'key',
  sends: 'key, addedAt',
  sendVideos: 'key',
})
// Clips joined on before and after videos. Two new tables, nothing else
// touched.
db.version(7).stores({
  looks: 'id, updatedAt',
  jobs: 'id, addedAt',
  videos: 'id',
  bank: 'id, addedAt',
  outbox: 'key',
  files: 'sha',
  meta: 'key',
  sends: 'key, addedAt',
  sendVideos: 'key',
  clips: 'id, addedAt',
  clipParts: 'key',
})

/** Told whenever something local changes that the shared login should get. */
let onLocalChange: () => void = () => {}
export function whenChangedLocally(listener: () => void): void {
  onLocalChange = listener
}

async function enqueue(kind: OutboxEntry['kind'], id: string, updatedAt: number, deleted: boolean): Promise<void> {
  await db.outbox.put({ key: `${kind}:${id}`, kind, id, updatedAt, deleted })
  onLocalChange()
}

// --- Campaigns ----------------------------------------------------------------

async function toStoredFile(blob: Blob): Promise<StoredFile> {
  return { bytes: await blob.arrayBuffer(), type: blob.type }
}

function fromStoredFile(file: StoredFile): Blob {
  return new Blob([file.bytes], { type: file.type })
}

async function toStored(campaign: Campaign): Promise<StoredCampaign> {
  return {
    ...campaign,
    logo: campaign.logo ? await toStoredFile(campaign.logo) : null,
    angles: await Promise.all(
      campaign.angles.map(async (angle) => ({
        ...angle,
        music: angle.music ? { ...angle.music, audio: await toStoredFile(angle.music.audio) } : angle.music,
        sounds: await Promise.all(
          angle.sounds.map(async (sound) => ({
            ...sound,
            source:
              sound.source.kind === 'file'
                ? { kind: 'file' as const, name: sound.source.name, audio: await toStoredFile(sound.source.audio) }
                : sound.source,
          })),
        ),
        pictures: await Promise.all(
          angle.pictures.map(async (picture) => ({ ...picture, image: await toStoredFile(picture.image) })),
        ),
      })),
    ),
  }
}

function fromStored(row: StoredCampaign): Campaign {
  return {
    ...row,
    logo: row.logo ? fromStoredFile(row.logo) : null,
    angles: row.angles.map((angle) => ({
      ...angle,
      music: angle.music ? { ...angle.music, audio: fromStoredFile(angle.music.audio) } : undefined,
      // Angles saved before effects existed have none: every effect off.
      effects: { ...NO_EFFECTS, ...angle.effects },
      pictures: (angle.pictures ?? []).map((picture) => ({ ...picture, image: fromStoredFile(picture.image) })),
      // Angles saved before the bank and sorting existed.
      bank: { ...NO_BANK, ...angle.bank },
      recognize: angle.recognize ?? [],
      sounds: angle.sounds.map((sound) => ({
        ...sound,
        source:
          sound.source.kind === 'file'
            ? { kind: 'file', name: sound.source.name, audio: fromStoredFile(sound.source.audio) }
            : (sound.source as AngleSound['source']),
      })),
    })),
  }
}

export async function loadCampaigns(): Promise<Campaign[]> {
  const rows = await db.looks.orderBy('updatedAt').reverse().toArray()
  // Every campaign has its General angle, including ones set up before it
  // existed. It is only written back when the campaign is next saved.
  return rows.map(fromStored).map(withGeneralAngle)
}

export async function saveCampaign(campaign: Campaign): Promise<Campaign> {
  const saved = { ...campaign, updatedAt: Date.now() }
  await db.looks.put(await toStored(saved))
  await enqueue('campaign', saved.id, saved.updatedAt, false)
  return saved
}

// --- The picture bank ---------------------------------------------------------

export async function loadBank(): Promise<BankPicture[]> {
  const rows = await db.bank.orderBy('addedAt').toArray()
  return rows.map((row) => ({ ...row, image: fromStoredFile(row.image) }))
}

export async function saveBankPicture(picture: BankPicture): Promise<void> {
  const updatedAt = Date.now()
  await db.bank.put({ ...picture, image: await toStoredFile(picture.image), updatedAt })
  await enqueue('bank', picture.id, updatedAt, false)
}

export async function deleteBankPicture(id: string): Promise<void> {
  await db.bank.delete(id)
  await enqueue('bank', id, Date.now(), true)
}

export async function deleteCampaign(id: string): Promise<void> {
  await db.looks.delete(id)
  await enqueue('campaign', id, Date.now(), true)
}

// --- Sharing ------------------------------------------------------------------
//
// What cloud.ts needs to send and take changes. Nothing here enqueues: a
// change that arrived from the shared login is not sent back to it.

export type StoredRow = StoredCampaign | StoredBankPicture
export type { StoredFile }

export async function outboxEntries(): Promise<OutboxEntry[]> {
  return db.outbox.toArray()
}

/** Clears a sent change - unless it changed again while it was being sent. */
export async function markSent(entry: OutboxEntry): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const now = await db.outbox.get(entry.key)
    if (now && now.updatedAt === entry.updatedAt) await db.outbox.delete(entry.key)
  })
}

/** Everything on this phone, queued to go - for the first sign-in, when the
 *  shared login may not have any of it yet. */
export async function enqueueEverything(): Promise<void> {
  const [campaigns, bank] = await Promise.all([db.looks.toArray(), db.bank.toArray()])
  await db.outbox.bulkPut([
    ...campaigns.map((c) => ({ key: `campaign:${c.id}`, kind: 'campaign' as const, id: c.id, updatedAt: c.updatedAt, deleted: false })),
    ...bank.map((b) => ({ key: `bank:${b.id}`, kind: 'bank' as const, id: b.id, updatedAt: b.updatedAt ?? b.addedAt, deleted: false })),
  ])
}

export async function storedRow(kind: OutboxEntry['kind'], id: string): Promise<StoredRow | undefined> {
  return kind === 'campaign' ? db.looks.get(id) : db.bank.get(id)
}

export function rowUpdatedAt(kind: OutboxEntry['kind'], row: StoredRow): number {
  return kind === 'campaign' ? (row as StoredCampaign).updatedAt : ((row as StoredBankPicture).updatedAt ?? (row as StoredBankPicture).addedAt)
}

/** Takes a change from the shared login, if it is newer than what is here
 *  and nothing newer is waiting to be sent. Says whether anything changed. */
export async function applyRemote(
  kind: OutboxEntry['kind'],
  id: string,
  updatedAt: number,
  row: StoredRow | null,
): Promise<boolean> {
  return db.transaction('rw', db.looks, db.bank, db.outbox, async () => {
    const pending = await db.outbox.get(`${kind}:${id}`)
    if (pending && pending.updatedAt >= updatedAt) return false
    const table = kind === 'campaign' ? db.looks : db.bank
    const local = (await table.get(id)) as StoredRow | undefined
    if (local && rowUpdatedAt(kind, local) >= updatedAt) return false
    if (row === null) {
      if (!local) return false
      await table.delete(id)
    } else if (kind === 'campaign') {
      await db.looks.put({ ...(row as StoredCampaign), updatedAt })
    } else {
      await db.bank.put({ ...(row as StoredBankPicture), updatedAt })
    }
    return true
  })
}

export async function cachedFile(sha: string): Promise<CachedFile | undefined> {
  return db.files.get(sha)
}

export async function cacheFile(file: CachedFile): Promise<void> {
  await db.files.put(file)
}

export async function markUploaded(sha: string): Promise<void> {
  await db.files.update(sha, { uploaded: true })
}

export async function getMeta(key: string): Promise<string | null> {
  return (await db.meta.get(key))?.value ?? null
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  if (value === null) await db.meta.delete(key)
  else await db.meta.put({ key, value })
}

// --- Posting ----------------------------------------------------------------
//
// What outbox.ts keeps. Nothing here goes to the shared login: posting is
// each person's own.

export async function loadSends(): Promise<SendEntry[]> {
  return db.sends.orderBy('addedAt').toArray()
}

export async function saveSend(entry: SendEntry): Promise<void> {
  await db.sends.put(entry)
}

export async function updateSend(key: string, fields: Partial<SendEntry>): Promise<void> {
  await db.sends.update(key, fields).catch(() => {})
}

export async function deleteSend(key: string): Promise<void> {
  await db.transaction('rw', db.sends, db.sendVideos, async () => {
    await db.sends.delete(key)
    await db.sendVideos.where('key').startsWith(`${key}#`).delete()
  })
}

/** A video's copy, for a browser that can't write private files, kept as
 *  bytes a few MB at a time: WebKit refuses to store a Blob in some modes
 *  (see StoredFile), and bytes read a piece at a time never hold the whole
 *  video in memory. */
const PIECE_BYTES = 4 * 1024 * 1024

export async function saveSendVideo(key: string, video: Blob): Promise<void> {
  for (let at = 0, i = 0; at < video.size; at += PIECE_BYTES, i++) {
    const bytes = await video.slice(at, at + PIECE_BYTES).arrayBuffer()
    await db.sendVideos.put({ key: `${key}#${String(i).padStart(5, '0')}`, bytes })
  }
}

export async function loadSendVideo(key: string): Promise<Blob | null> {
  const pieces = await db.sendVideos.where('key').startsWith(`${key}#`).sortBy('key')
  return pieces.length > 0 ? new Blob(pieces.map((p) => p.bytes), { type: 'video/mp4' }) : null
}

// --- Clips -------------------------------------------------------------------
//
// Kept like a video's copy for posting: bytes a piece at a time, so storing
// works in every mode and reading one back never holds more than the clip.

const partKey = (id: string, i: number) => `${id}#${String(i).padStart(5, '0')}`

/** Keeps a clip. The row goes in last, so a clip that is listed always has
 *  all of its bytes. */
export async function saveClipFile(clip: StoredClip, file: Blob): Promise<void> {
  try {
    for (let at = 0, i = 0; at < file.size; at += PIECE_BYTES, i++) {
      const bytes = await file.slice(at, at + PIECE_BYTES).arrayBuffer()
      await db.clipParts.put({ key: partKey(clip.id, i), bytes })
    }
    await db.clips.put(clip)
  } catch (error) {
    await deleteClipFile(clip.id).catch(() => {})
    throw error
  }
}

export async function loadClipRows(): Promise<StoredClip[]> {
  return db.clips.orderBy('addedAt').reverse().toArray()
}

export async function loadClipFile(id: string): Promise<Blob | null> {
  const row = await db.clips.get(id)
  if (!row) return null
  const pieces = await db.clipParts.where('key').startsWith(`${id}#`).sortBy('key')
  const blob = new Blob(pieces.map((p) => p.bytes), { type: row.type })
  return blob.size === row.size ? blob : null
}

export async function deleteClipFile(id: string): Promise<void> {
  await db.transaction('rw', db.clips, db.clipParts, async () => {
    await db.clips.delete(id)
    await db.clipParts.where('key').startsWith(`${id}#`).delete()
  })
}

/** Every clip a waiting video picked for itself. */
export async function clipsPickedByJobs(): Promise<string[]> {
  const rows = await db.jobs.toArray()
  return rows.flatMap((row) => [row.day?.clips?.before, row.day?.clips?.after]).filter((id): id is string => Boolean(id) && id !== 'none')
}

// --- Queue ------------------------------------------------------------------

async function freeSpace(): Promise<number | null> {
  try {
    const { quota, usage } = await navigator.storage.estimate()
    return quota === undefined || usage === undefined ? null : quota - usage
  } catch {
    return null
  }
}

export async function spaceOnDevice(): Promise<{ free: number | null }> {
  return { free: await freeSpace() }
}

/** Keeps the video so it survives a reload, unless keeping it would leave no
 *  room to write the result - then it is cut straight from memory. */
export async function persistJob(job: Omit<StoredJob, 'addedAt' | 'attempts'> & { fileBlob: Blob }): Promise<boolean> {
  const { fileBlob, ...meta } = job
  try {
    await db.jobs.put({ ...meta, attempts: 0, addedAt: Date.now() })
    const free = await freeSpace()
    if (free !== null && free <= fileBlob.size * 2.5) return false
    await db.videos.put({ id: job.id, blob: fileBlob })
    return true
  } catch {
    return false
  }
}

export async function forgetFile(id: string): Promise<void> {
  await db.videos.delete(id).catch(() => {})
}

/** Both or neither: a page being torn down mid-delete must not leave a
 *  video with no row, taking up space that nothing will ever free. A
 *  reaction video's product clip goes too, once no other video uses it, and
 *  a joined video's recordings go with it. */
export async function forgetJob(id: string): Promise<void> {
  await db.transaction('rw', db.jobs, db.videos, async () => {
    const gone: string[] = []
    const products = new Set<string>()
    const forget = async (jobId: string) => {
      const row = await db.jobs.get(jobId)
      gone.push(jobId)
      if (row?.reaction) products.add(row.reaction.productId)
      for (const part of row?.day?.parts ?? []) await forget(part)
    }
    await forget(id)
    await db.jobs.bulkDelete(gone)
    await db.videos.bulkDelete(gone)
    for (const jobId of gone) await db.videos.where('id').startsWith(montagePrefix(jobId)).delete()
    for (const productId of products) {
      if (!(await db.jobs.filter((j) => j.reaction?.productId === productId).first())) await db.videos.delete(productKey(productId))
    }
  })
}

/** A joined video, before its file is made: its row, and its recordings
 *  marked as its parts. */
export async function persistJoined(job: Omit<StoredJob, 'addedAt' | 'attempts'>): Promise<void> {
  await db.transaction('rw', db.jobs, async () => {
    await db.jobs.put({ ...job, attempts: 0, addedAt: Date.now() })
    for (const part of job.day?.parts ?? []) await db.jobs.update(part, { joinedInto: job.id })
  })
}

/** Keeps a video made on the phone - a joined one - under its job. Says
 *  whether it managed to; the video is used from memory either way. */
export async function keepJobVideo(id: string, video: Blob): Promise<boolean> {
  try {
    await db.videos.put({ id, blob: video })
    return true
  } catch {
    return false
  }
}

/** Takes a joined video apart again: it goes, its recordings come back. */
export async function splitJoined(id: string): Promise<void> {
  await db.transaction('rw', db.jobs, db.videos, async () => {
    const row = await db.jobs.get(id)
    for (const part of row?.day?.parts ?? []) {
      await db.jobs.where('id').equals(part).modify((p) => {
        delete p.joinedInto
      })
    }
    await db.jobs.delete(id)
    await db.videos.delete(id)
  })
}

const productKey = (productId: string) => `product:${productId}`

/** A clips-and-music video's other files, kept under its job's id. */
const montagePrefix = (jobId: string) => `montage:${jobId}:`
const montageKey = (jobId: string, part: number | 'song') => `${montagePrefix(jobId)}${part}`

/** Recordings joined first, now one video: it replaces the first as the
 *  job's own, and the others go. All or nothing - if the joined video can't
 *  be kept, the recordings stay and are joined again after a restart. */
export async function finishPrejoin(id: string, joined: Blob): Promise<boolean> {
  try {
    await db.transaction('rw', db.jobs, db.videos, async () => {
      await db.videos.put({ id, blob: joined })
      await db.jobs
        .where('id')
        .equals(id)
        .modify((row) => {
          delete row.prejoin
          row.fileType = 'video/mp4'
        })
      await db.videos.where('id').startsWith(montagePrefix(id)).delete()
    })
    return true
  } catch {
    return false
  }
}

/** Keeps a clips-and-music video's clips after the first, and its song.
 *  Says whether it managed to; they are used from memory either way. */
export async function persistMontage(jobId: string, clips: Blob[], song: Blob | null): Promise<boolean> {
  try {
    for (const [i, clip] of clips.entries()) await db.videos.put({ id: montageKey(jobId, i + 1), blob: clip })
    if (song) await db.videos.put({ id: montageKey(jobId, 'song'), blob: song })
    return true
  } catch {
    return false
  }
}

/** One of those files back: clip `part` (1 is the second clip) or the song. */
export async function loadMontageFile(jobId: string, part: number | 'song', name: string, type: string): Promise<File | null> {
  const video = await orTimeout(db.videos.get(montageKey(jobId, part)), 20_000, 'Reading a saved clip')
  if (!video || video.blob.size === 0) return null
  return new File([video.blob], name, { type })
}

/** Keeps a product clip once, however many reaction videos use it. */
export async function persistProduct(productId: string, file: Blob): Promise<boolean> {
  try {
    if (await db.videos.get(productKey(productId))) return true
    await db.videos.put({ id: productKey(productId), blob: file })
    return true
  } catch {
    return false
  }
}

export async function loadProductFile(parts: ReactionParts): Promise<File | null> {
  const video = await orTimeout(db.videos.get(productKey(parts.productId)), 20_000, 'Reading the saved product clip')
  if (!video || video.blob.size === 0) return null
  return new File([video.blob], parts.productName, { type: parts.productType })
}

/** A job whose files are kept elsewhere - a batch video's are the bank's -
 *  so only its row. */
export async function persistJobRow(job: Omit<StoredJob, 'addedAt' | 'attempts'>): Promise<boolean> {
  try {
    await db.jobs.put({ ...job, attempts: 0, addedAt: Date.now() })
    return true
  } catch {
    return false
  }
}

// --- The Batch tab's banks ----------------------------------------------------
//
// A campaign's reactions, product showcases and tracks, kept like clips: as
// bytes a few MB at a time, so storing works in every mode and reading one
// back never holds more than it. The lists themselves are one row of meta
// per campaign. Never shared: his own footage.

const bankPrefix = (id: string) => `bank-${id}#`

export async function saveBankFile(id: string, file: Blob): Promise<void> {
  try {
    for (let at = 0, i = 0; at < file.size; at += PIECE_BYTES, i++) {
      const bytes = await file.slice(at, at + PIECE_BYTES).arrayBuffer()
      await db.clipParts.put({ key: `${bankPrefix(id)}${String(i).padStart(5, '0')}`, bytes })
    }
  } catch (error) {
    await deleteBankFile(id).catch(() => {})
    throw error
  }
}

/** A bank file back, or null when it is gone or not all there. */
export async function loadBankFile(file: BankFile): Promise<File | null> {
  const pieces = await orTimeout(db.clipParts.where('key').startsWith(bankPrefix(file.id)).sortBy('key'), 20_000, 'Reading a batch file')
  const blob = new Blob(
    pieces.map((p) => p.bytes),
    { type: file.type },
  )
  return blob.size === file.size && blob.size > 0 ? new File([blob], file.name, { type: file.type }) : null
}

export async function deleteBankFile(id: string): Promise<void> {
  await db.clipParts.where('key').startsWith(bankPrefix(id)).delete()
}

const RETIRED_KEY = 'batch:retired'

/** Bank files let go of - a bank that made every video it could - to be
 *  deleted once no video still to be made needs them. */
export async function retireBankFiles(ids: string[]): Promise<void> {
  const raw = await getMeta(RETIRED_KEY).catch(() => null)
  const waiting = new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  for (const id of ids) waiting.add(id)
  await setMeta(RETIRED_KEY, JSON.stringify([...waiting]))
}

/** Deletes the let-go bank files no waiting video is made from: none in
 *  the saved queue - so it never runs ahead of a page still picking its
 *  videos back up - and none of `inUse`, the videos on the page now. */
export async function sweepRetiredBankFiles(inUse: string[] = []): Promise<void> {
  try {
    const raw = await getMeta(RETIRED_KEY)
    if (!raw) return
    const waiting = JSON.parse(raw) as string[]
    const rows = await db.jobs.toArray()
    const needed = new Set([
      ...inUse,
      ...rows.flatMap((row) => {
        const bank = row.montage?.bank
        return bank ? [bank.reaction.id, bank.product.id] : []
      }),
    ])
    const keep: string[] = []
    for (const id of waiting) {
      if (needed.has(id)) keep.push(id)
      else await deleteBankFile(id)
    }
    await setMeta(RETIRED_KEY, keep.length > 0 ? JSON.stringify(keep) : null)
  } catch {
    // Tried again after the next video, and on the next start.
  }
}

const bankKey = (campaignId: string) => `batch:${campaignId}`

export async function loadBatchBank(campaignId: string): Promise<BatchBank | null> {
  try {
    const raw = await getMeta(bankKey(campaignId))
    return raw ? (JSON.parse(raw) as BatchBank) : null
  } catch {
    return null
  }
}

export async function saveBatchBank(bank: BatchBank): Promise<void> {
  await setMeta(bankKey(bank.campaignId), JSON.stringify(bank))
}

export async function claimAttempt(id: string): Promise<boolean> {
  return within(countAttempt(id), 10_000, true)
}

async function countAttempt(id: string): Promise<boolean> {
  try {
    const row = await db.jobs.get(id)
    if (!row) return true
    const attempts = row.attempts + 1
    await db.jobs.update(id, { attempts })
    return attempts <= MAX_ATTEMPTS
  } catch {
    // The count is a safety net, not a gate: a write that fails must never
    // be what stops a video.
    return true
  }
}

export async function resetAttempts(id: string): Promise<void> {
  await db.jobs.update(id, { attempts: 0, failed: undefined }).catch(() => {})
}

export async function recordFailure(id: string, message: string): Promise<void> {
  await db.jobs.update(id, { failed: message }).catch(() => {})
}

export async function recordPhase(id: string, phase: JobPhase): Promise<void> {
  await db.jobs.update(id, { lastPhase: phase }).catch(() => {})
}

export async function loadJobFile(id: string): Promise<File | null> {
  const [row, video] = await orTimeout(Promise.all([db.jobs.get(id), db.videos.get(id)]), 20_000, 'Reading the saved video')
  if (!row || !video || video.blob.size === 0) return null
  return new File([video.blob], row.fileName, { type: row.fileType })
}

/** Records what a day video's listen found, and whether he approved it. */
export async function recordDay(id: string, day: NonNullable<StoredJob['day']>, fields: Partial<StoredJob> = {}): Promise<void> {
  await db.jobs.update(id, { ...fields, day }).catch(() => {})
}

/** Marks a job as made, keeping its recording and edits for the edit window. */
export async function markMade(id: string): Promise<void> {
  await db.jobs.update(id, { madeAt: Date.now(), attempts: 0, failed: undefined }).catch(() => {})
}

/** The made jobs still inside the edit window: id -> when made. */
export async function editableJobs(now = Date.now()): Promise<Record<string, number>> {
  const rows = await db.jobs.filter((j) => j.madeAt !== undefined && now - j.madeAt < EDIT_WINDOW_MS).toArray()
  return Object.fromEntries(rows.map((j) => [j.id, j.madeAt as number]))
}

/** Lets go of made jobs past the window, recording and all. */
export async function expireMade(now = Date.now()): Promise<number> {
  const old = await db.jobs.filter((j) => j.madeAt !== undefined && now - j.madeAt >= EDIT_WINDOW_MS).primaryKeys()
  for (const id of old) await forgetJob(id)
  return old.length
}

/** Takes a made job back to be edited: it is a job to make again, its next
 *  post a new version replacing the old. Null when it has expired. */
export async function reopenJob(id: string, replaces: string): Promise<PendingJob | null> {
  const row = await db.jobs.get(id)
  const video = await db.videos.get(id)
  if (!row?.madeAt || !row.day?.plan || !video || video.blob.size === 0) return null
  if (Date.now() - row.madeAt >= EDIT_WINDOW_MS) return null
  const day = { ...row.day, approved: false, checked: false }
  await db.jobs.update(id, { madeAt: undefined, day, version: (row.version ?? 1) + 1, replaces, attempts: 0 })
  const { addedAt: _added, ...meta } = (await db.jobs.get(id))!
  return meta
}

export async function loadPendingJobs(): Promise<PendingJob[]> {
  const rows = await db.transaction('rw', db.jobs, db.videos, async () => {
    const rows = await db.jobs.orderBy('addedAt').toArray()
    // Kept videos whose job is gone, left by versions that could lose a row
    // and keep its video. Inside this transaction, so a job being added at
    // the same moment is never mistaken for one.
    const live = new Set(rows.flatMap((row) => (row.reaction ? [row.id, productKey(row.reaction.productId)] : [row.id])))
    const ids = new Set(rows.map((row) => row.id))
    const kept = (id: string) => live.has(id) || (id.startsWith('montage:') && ids.has(id.split(':')[1]))
    const orphans = (await db.videos.toCollection().primaryKeys()).filter((id) => !kept(id))
    if (orphans.length > 0) await db.videos.bulkDelete(orphans)
    return rows
  })
  return rows.filter((row) => row.madeAt === undefined).map(({ addedAt: _added, ...meta }) => meta)
}
