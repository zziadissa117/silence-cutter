// Once a day, what the Cutter keeps on the phone, sent as a "check" report:
// one phone had over 100 GB of it, and a full phone is what stops the iPhone
// handing picked videos over and gets the page restarted mid-video. Counts
// and sizes only - nothing is read from any file.

import { report } from '../report'
import { sendsHeld } from './outbox'
import { storedCounts } from './store'

const LAST_KEY = 'cutter.storageReport'
const DAY_MS = 24 * 60 * 60 * 1000

/** Each folder in the browser's private file storage: files and MB. */
async function folders(): Promise<string[]> {
  const out: string[] = []
  try {
    const root = await navigator.storage.getDirectory()
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue
      let files = 0
      let bytes = 0
      for await (const entry of (handle as FileSystemDirectoryHandle).values()) {
        if (entry.kind !== 'file') continue
        files++
        bytes += (await (entry as FileSystemFileHandle).getFile().catch(() => null))?.size ?? 0
      }
      out.push(`${name} ${files} files ${Math.round(bytes / 1e6)} MB`)
    }
  } catch {
    // No private file storage here.
  }
  return out
}

export async function reportStorage(now = Date.now()): Promise<void> {
  try {
    const last = Number(localStorage.getItem(LAST_KEY) ?? 0)
    if (now - last < DAY_MS) return
    localStorage.setItem(LAST_KEY, String(now))
  } catch {
    return
  }
  const estimate = await navigator.storage?.estimate?.().catch(() => null)
  const [files, counts, sends] = await Promise.all([folders(), storedCounts(), sendsHeld().catch(() => null)])
  const used = estimate?.usage !== undefined ? `${Math.round(estimate.usage / 1e6)} MB used` : 'usage unknown'
  const parts = [
    used,
    ...files,
    sends ? `send queue ${sends.sending} sending, ${sends.sent} sent, ${sends.mb} MB` : '',
    Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
  ].filter(Boolean)
  report({ page: 'campaign', kind: 'check', phase: 'storage', message: parts.join(' · ') })
}
