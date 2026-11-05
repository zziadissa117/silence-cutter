// The phone's side of his talking videos on the Cutter server (talkOrder.ts,
// serverTalk.ts): the recordings go up one after another, an order for each
// goes with them, and what the server has done is read back every few
// seconds. Nothing here decides anything about a video - CampaignApp does,
// exactly as when the phone makes it - and any trouble with the server hands
// the video back to the phone, which does it itself.

import { currentSession } from './cloud'
import { call, connectServer, lastServerStatus, sendFile, serverUrl } from './serverLink'
import type { ListenOrder, MakeOrder, TalkSummary } from './talkOrder'
import type { CampaignPlan } from './plan'

/** The server can take talking videos: connected, its page answering
 *  lately, and new enough to know /talk (asked once a minute at most). */
let checked: { at: number; up: boolean } | null = null
let connected = false
export async function talkServerUp(): Promise<boolean> {
  if (!serverUrl() || !currentSession()) return false
  if (checked && Date.now() - checked.at < 60_000) return checked.up
  let up = false
  // An address that doesn't answer is down within 8 s: the phone holds its
  // own listening only while this is asked.
  const within = <T,>(work: Promise<T>) =>
    Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The server did not answer.')), 8000))])
  try {
    if (!connected) {
      await within(connectServer())
      connected = true
    }
    await within(call<{ talk: unknown }>('GET', '/talk'))
    const page = lastServerStatus()?.page
    up = !page || Date.now() - Date.parse(page.at) < 10 * 60_000
  } catch {
    up = false
  }
  checked = { at: Date.now(), up }
  return up
}

/** Said when the server let him down: the next check asks again. */
export function serverLetDown(): void {
  checked = { at: Date.now(), up: false }
}

/** A file up, unless the server has it already. */
export async function upload(fileId: string, blob: Blob, name: string, type: string, onFraction: (f: number) => void = () => {}): Promise<void> {
  const { files } = await call<{ files: Record<string, { size: number }> }>('GET', '/files')
  if (files[fileId]?.size === blob.size) return
  await sendFile({ id: fileId, name, type, size: blob.size }, blob, onFraction)
}

export const orderListen = (order: ListenOrder) => call<{ ok: true }>('PUT', `/talk/${encodeURIComponent(order.id)}`, { kind: 'listen', order })
export const orderMake = (order: MakeOrder) => call<{ ok: true }>('PUT', `/talk/${encodeURIComponent(order.id)}`, { kind: 'make', order })

/** Every talking video the server has, as it is now. */
export async function talkNow(): Promise<Record<string, TalkSummary>> {
  return (await call<{ talk: Record<string, TalkSummary> }>('GET', '/talk')).talk
}

/** The words heard, once listened to. */
export async function talkPlan(id: string): Promise<CampaignPlan> {
  const record = await call<{ plan?: CampaignPlan }>('GET', `/talk/${encodeURIComponent(id)}`)
  if (!record.plan) throw new Error('The server has no words for this video yet.')
  return record.plan
}

/** Done with it on the server: its order and recording go. */
export const dropTalk = (id: string) => call<{ ok: true }>('DELETE', `/talk/${encodeURIComponent(id)}`).catch(() => {})
