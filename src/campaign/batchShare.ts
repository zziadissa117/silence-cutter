// A batch shared with his students (his ask, 2026-11-28: "share batches to
// students, so they only have to film and drop in clips"). He picks students
// on the Batch tab; each gets, once, a copy of the campaign and its batch:
// formats, steps with their words, pictures and caption scripts, headlines,
// looks, songs and beat drops, the money and step lines, and his product
// clips - never a clip of him (his reactions, hooks, talking clips, him at the
// computer, his copies). Nothing of his progress goes (what was made, used,
// days filled) and it isn't running: they drop in their own clips and Start.
// A one-time copy: his later changes don't reach them (his pick).
//
// The files go through the Cutter's storage (his OK, the same day), named by
// their file ids under the share (supabase/functions/cutter/shares.ts), and
// are taken off it once every student has them.

import { PROGRESS_FIELDS, formatsOf, type BankFile, type BatchBank, type BatchStep } from './batch'
import { askShared, CloudError } from './cloud'
import { PUBLISHABLE_KEY } from '../config'
import type { BankPicture, Campaign } from './look'
import { loadBankFile, saveBankFile, saveBankPicture, saveBatchBank, saveCampaign } from './store'

/** A key a file is kept under in a share. */
const KEY = /^[A-Za-z0-9_-]{1,80}$/

/** The batch as a student gets it: his clips out, his progress gone, stopped. */
export function packBank(bank: BatchBank): BatchBank {
  const formats = formatsOf(bank)
  const talking = new Set(formats.filter((f) => f.kind === 'talking').map((f) => f.id))
  // A step only talking heads use holds clips of him talking: its words,
  // pictures and script go, its clips don't.
  const ofHim = (step: BatchStep) => (step.formats?.length ? step.formats.every((id) => talking.has(id)) : formats.length > 0 && formats.every((f) => f.kind === 'talking'))
  const bare = (file: BankFile): BankFile => {
    const { source: _source, ...rest } = file
    void _source
    return rest
  }
  const out: BatchBank = {
    ...bank,
    reactions: [],
    products: bank.products.map(bare),
    steps: bank.steps?.map((step) => ({ ...step, files: ofHim(step) ? [] : step.files.map(bare), heard: undefined })),
    music: bank.music.map(bare),
    copies: [],
    running: false,
    used: {},
  }
  for (const key of PROGRESS_FIELDS) delete (out as unknown as Record<string, unknown>)[key]
  for (const key of ['where', 'movedAt', 'startedAt', 'anyway', 'engineJob', 'variations', 'droppedHooks', 'favour', 'formatShares', 'growthFrom', 'cutterCaptions'] as const) {
    delete (out as unknown as Record<string, unknown>)[key]
  }
  out.used = {}
  return out
}

/** Every file a packed batch needs. */
export function filesOfPack(bank: BatchBank): BankFile[] {
  const all = [
    ...bank.reactions,
    ...bank.products,
    ...bank.music,
    ...(bank.steps ?? []).flatMap((s) => [...s.files, ...(s.overlays ?? []).map((o) => o.file)]),
    ...(bank.formula?.left ? [bank.formula.left] : []),
    ...(bank.formula?.right ? [bank.formula.right] : []),
    ...(bank.emojis ?? []),
  ]
  return [...new Map(all.filter((f) => f && KEY.test(f.id)).map((f) => [f.id, f])).values()]
}

/** A picture or sound inside the campaign, as a share keeps it. */
interface BlobRef {
  shareBlob: string
  type: string
}
const isRef = (v: unknown): v is BlobRef => typeof v === 'object' && v !== null && typeof (v as BlobRef).shareBlob === 'string'

/** `value` with every Blob in it swapped for a key, and the Blobs by key. */
export function withoutBlobs(value: unknown, blobs: Map<string, Blob> = new Map()): { value: unknown; blobs: Map<string, Blob> } {
  const walk = (v: unknown): unknown => {
    if (v instanceof Blob) {
      const key = `c${blobs.size}`
      blobs.set(key, v)
      return { shareBlob: key, type: v.type }
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return { value: walk(value), blobs }
}

/** The keys of the Blobs a packed value refers to. */
export function blobKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (isRef(value)) into.add(value.shareBlob)
  else if (Array.isArray(value)) value.forEach((v) => blobKeys(v, into))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => blobKeys(v, into))
  return into
}

/** A packed value with its Blobs back. */
export function withBlobs(value: unknown, blobs: ReadonlyMap<string, Blob>): unknown {
  if (isRef(value)) {
    const blob = blobs.get(value.shareBlob)
    if (!blob) throw new CloudError('A picture of the shared campaign could not be fetched.')
    return blob.type || !value.type ? blob : new Blob([blob], { type: value.type })
  }
  if (Array.isArray(value)) return value.map((v) => withBlobs(v, blobs))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withBlobs(v, blobs)]))
  return value
}

/** What goes to the server for the students. */
export interface SharePack {
  campaign: unknown
  pictures: unknown
  bank: BatchBank
}

/** One share waiting for this login. */
interface Waiting {
  shareId: string
  from: string
  at: string
  pack: SharePack
}

async function put(url: string, blob: Blob): Promise<void> {
  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', blob)
  const res = await fetch(url, { method: 'PUT', body: form, headers: { apikey: PUBLISHABLE_KEY, 'x-upsert': 'true' } }).catch(() => null)
  if (!res) throw new CloudError('No connection. Try again when there is signal.')
  if (!res.ok) throw new CloudError(`A file could not be sent (${res.status}).`)
}

/** He shares a campaign's batch with `students`. Says who got it. */
export async function shareBatch(
  campaign: Campaign,
  bank: BatchBank,
  pictures: readonly BankPicture[],
  students: readonly string[],
  onProgress: (said: string) => void = () => {},
): Promise<string[]> {
  const packed = packBank(bank)
  const files = filesOfPack(packed)
  const { value: campaignValue, blobs } = withoutBlobs(campaign)
  const { value: picturesValue } = withoutBlobs(
    pictures.filter((p) => p.campaignId === campaign.id),
    blobs,
  )
  const keys = [...files.map((f) => f.id), ...blobs.keys()]
  const started = await askShared<{ shareId: string; uploads: { key: string; url: string }[] }>('share-start', { keys })
  if (!started) throw new CloudError('Sign in first.')
  const urls = new Map(started.uploads.map((u) => [u.key, u.url]))
  let done = 0
  for (const file of files) {
    onProgress(`Sending ${file.name} (${++done} of ${keys.length})…`)
    const blob = await loadBankFile(file)
    const url = urls.get(file.id)
    if (!blob || !url) throw new CloudError(`${file.name} isn't on this phone any more - take it out of the batch, then share again.`)
    await put(url, blob)
  }
  for (const [key, blob] of blobs) {
    onProgress(`Sending the campaign's pictures (${++done} of ${keys.length})…`)
    const url = urls.get(key)
    if (url) await put(url, blob)
  }
  onProgress('Handing it to them…')
  const pack: SharePack = { campaign: campaignValue, pictures: picturesValue, bank: packed }
  const sent = await askShared<{ sentTo: string[] }>('share-send', { shareId: started.shareId, students, pack })
  return sent?.sentTo ?? []
}

/** What a student's phone made of a share. */
export interface Taken {
  campaign: Campaign
  pictures: BankPicture[]
  from: string
}

/** Every batch shared with this login and not taken yet, brought onto this
 *  phone: a new campaign each, its pictures, its batch and files. */
export async function takeShares(onProgress: (said: string) => void = () => {}): Promise<Taken[]> {
  const waiting = (await askShared<{ shares: Waiting[] }>('shares'))?.shares ?? []
  const taken: Taken[] = []
  for (const share of waiting) {
    const { pack } = share
    if (!pack?.bank || !pack.campaign) continue
    const files = filesOfPack(pack.bank)
    const keys = [...files.map((f) => f.id), ...blobKeys(pack.campaign), ...blobKeys(pack.pictures)]
    const urls = (await askShared<{ urls: Record<string, string> }>('share-urls', { shareId: share.shareId, keys }))?.urls ?? {}
    const blobs = new Map<string, Blob>()
    let n = 0
    for (const key of keys) {
      onProgress(`Bringing in ${share.from}'s batch (${++n} of ${keys.length})…`)
      const url = urls[key]
      if (!url) throw new CloudError("A file of the shared batch is missing - ask for it to be shared again.")
      const res = await fetch(url).catch(() => null)
      if (!res?.ok) throw new CloudError('No connection. It is brought in next time the app opens.')
      blobs.set(key, await res.blob())
    }
    for (const file of files) await saveBankFile(file.id, blobs.get(file.id)!)
    const id = crypto.randomUUID()
    const now = Date.now()
    const shared = withBlobs(pack.campaign, blobs) as Campaign
    const campaign = await saveCampaign({ ...shared, id, createdAt: now, updatedAt: now, general: undefined, trial: undefined, tribe: undefined })
    const pictures = ((withBlobs(pack.pictures ?? [], blobs) as BankPicture[]) ?? []).map((p) => ({ ...p, id: `${id}-${p.id}`.slice(0, 120), campaignId: id }))
    for (const picture of pictures) await saveBankPicture(picture)
    await saveBatchBank({ ...pack.bank, campaignId: id })
    await askShared('share-done', { shareId: share.shareId }).catch(() => null)
    taken.push({ campaign, pictures, from: share.from })
  }
  return taken
}
