// Warm-up posts on the phone (his ask, 2026-11-11; the shared ideas are the
// cutter function's - supabase/functions/cutter/warmups.ts): the ideas and
// categories everyone shares, kept here too so the screen opens without
// signal; adding, changing, approving; and an idea's sound and example video,
// sent up once (named by what is in them) and brought down the first time
// they are used, then kept on the phone.

import { useCallback, useEffect, useState } from 'react'

import type { WarmupCategory, WarmupFile, WarmupIdea } from '../../supabase/functions/cutter/warmups.ts'
import { CloudError, askShared } from './cloud'
import { deleteBankFile, getMeta, loadBankFile, saveBankFile, setMeta } from './store'

export type { WarmupCategory, WarmupFile, WarmupIdea }
export { FIRST_CATEGORIES, SECONDS as WARMUP_SECONDS } from '../../supabase/functions/cutter/warmups.ts'

export interface WarmupList {
  ideas: WarmupIdea[]
  categories: WarmupCategory[]
  /** This login is the owner: he approves, and his ideas go up at once. */
  owner: boolean
  partner: boolean
}

const KEY = 'warmups:list'
const EMPTY: WarmupList = { ideas: [], categories: [], owner: false, partner: false }

async function kept(): Promise<WarmupList> {
  try {
    const raw = await getMeta(KEY)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as WarmupList) } : EMPTY
  } catch {
    return EMPTY
  }
}

/** The list as the server has it now, kept here for next time. */
export async function fetchWarmups(): Promise<WarmupList> {
  const list = await askShared<WarmupList>('warmups')
  if (!list) return kept()
  await setMeta(KEY, JSON.stringify(list)).catch(() => {})
  return list
}

/** The list, from the phone at once and then from the server. */
export function useWarmups(): { list: WarmupList; refresh: () => Promise<void>; problem: string | null } {
  const [list, setList] = useState<WarmupList>(EMPTY)
  const [problem, setProblem] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setList(await fetchWarmups())
      setProblem(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }, [])
  useEffect(() => {
    let alive = true
    void kept().then((k) => alive && setList((now) => (now === EMPTY ? k : now)))
    void refresh()
    return () => {
      alive = false
    }
  }, [refresh])
  return { list, refresh, problem }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Where a warm-up file is kept on this phone. */
const localId = (sha: string) => `warm-${sha}`

/** A sound or example video up to the server - once: it is named by what is
 *  in it - and kept on this phone. */
export async function sendWarmupFile(file: Blob, name: string): Promise<WarmupFile> {
  const bytes = await file.arrayBuffer()
  const sha = await sha256(bytes)
  const answer = await askShared<{ url: string | null }>('warmup-upload', { sha })
  if (!answer) throw new CloudError('Sign in to add warm-up ideas.')
  if (answer.url) {
    const form = new FormData()
    form.append('cacheControl', '31536000')
    form.append('', file)
    const response = await fetch(answer.url, { method: 'PUT', body: form, headers: { 'x-upsert': 'false' } })
    if (!response.ok && !/duplicate|already exists/i.test(await response.text().catch(() => ''))) {
      throw new CloudError(`${name} could not be sent (${response.status}).`)
    }
  }
  await saveBankFile(localId(sha), file).catch(() => {})
  return { sha, name, type: file.type || 'application/octet-stream', size: file.size }
}

/** A warm-up file: from the phone, or brought down once and kept. Null when
 *  it can't be had (no signal, or taken out). */
export async function warmupFile(file: WarmupFile): Promise<File | null> {
  const here = await loadBankFile({ id: localId(file.sha), name: file.name, type: file.type, size: file.size }).catch(() => null)
  if (here) return here
  const answer = await askShared<{ urls: Record<string, string> }>('warmup-urls', { shas: [file.sha] }).catch(() => null)
  const url = answer?.urls[file.sha]
  if (!url) return null
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) return null
  const bytes = await response.arrayBuffer()
  if ((await sha256(bytes)) !== file.sha) return null
  const got = new File([bytes], file.name, { type: file.type })
  await saveBankFile(localId(file.sha), got).catch(() => {})
  return got
}

/** A new or changed idea. Its files go up first; the server takes it once
 *  they are there. */
export async function saveWarmup(idea: Omit<WarmupIdea, 'by' | 'byName' | 'status'> & Partial<Pick<WarmupIdea, 'status'>>): Promise<WarmupIdea> {
  for (let tries = 0; ; tries++) {
    try {
      const answer = await askShared<{ idea: WarmupIdea }>('warmup-save', { idea })
      if (!answer) throw new CloudError('Sign in to add warm-up ideas.')
      return answer.idea
    } catch (error) {
      // A file still arriving: a moment later.
      if (tries < 3 && error instanceof CloudError && /arrived/.test(error.message)) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      throw error
    }
  }
}

export async function approveWarmup(id: string, approve: boolean): Promise<void> {
  await askShared('warmup-approve', { id, approve })
}

export async function removeWarmup(id: string): Promise<void> {
  await askShared('warmup-remove', { id })
}

export async function addCategory(name: string): Promise<WarmupCategory | null> {
  return (await askShared<{ category: WarmupCategory }>('warmcat-add', { name }))?.category ?? null
}

export async function approveCategory(id: string, approve: boolean): Promise<void> {
  await askShared('warmcat-approve', { id, approve })
}

export const newWarmupId = () => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

// --- Warm-ups filmed on this phone -------------------------------------------
//
// Each finished warm-up video waits here until it goes out - once, ever (his
// rule: "a video that's been posted once does not get posted again"). The
// video is kept like the batch's clips; the list is one row of meta.

export interface MadeWarmup {
  id: string
  ideaId: string
  title: string
  category: string
  headline: string
  seconds: number
  madeAt: number
  /** The finished video, kept on this phone (store.saveBankFile). */
  file: { id: string; name: string; type: string; size: number }
  /** Where it went: the campaign, and the post's key. Never sent twice. */
  posted?: { campaignId: string; key: string; at: string }
}

const MADE_KEY = 'warmups:made'
const madeListeners = new Set<(made: MadeWarmup[]) => void>()

export async function loadMade(): Promise<MadeWarmup[]> {
  try {
    const raw = await getMeta(MADE_KEY)
    return raw ? (JSON.parse(raw) as MadeWarmup[]) : []
  } catch {
    return []
  }
}

export async function saveMade(made: MadeWarmup[]): Promise<void> {
  await setMeta(MADE_KEY, JSON.stringify(made))
  for (const listener of madeListeners) listener(made)
}

/** A finished warm-up, kept until it goes out. */
export async function keepMade(blob: Blob, idea: Pick<WarmupIdea, 'id' | 'title' | 'category' | 'seconds'>, headline: string): Promise<MadeWarmup> {
  const id = newWarmupId()
  const fileId = `warmmade-${id}`
  const name = `Warm-up ${idea.title}.mp4`.replace(/[\\/:*?"<>|]/g, '')
  await saveBankFile(fileId, blob)
  const made: MadeWarmup = {
    id,
    ideaId: idea.id,
    title: idea.title,
    category: idea.category,
    headline,
    seconds: idea.seconds,
    madeAt: Date.now(),
    file: { id: fileId, name, type: 'video/mp4', size: blob.size },
  }
  await saveMade([...(await loadMade()), made])
  return made
}

export async function madeFile(made: MadeWarmup): Promise<File | null> {
  return loadBankFile(made.file).catch(() => null)
}

/** One he doesn't want: gone, its video with it. */
export async function dropMade(id: string): Promise<void> {
  const all = await loadMade()
  const gone = all.find((m) => m.id === id)
  await saveMade(all.filter((m) => m.id !== id))
  if (gone) await deleteBankFile(gone.file.id).catch(() => {})
}

export function useMade(): MadeWarmup[] {
  const [made, setMade] = useState<MadeWarmup[]>([])
  useEffect(() => {
    let alive = true
    void loadMade().then((m) => alive && setMade(m))
    madeListeners.add(setMade)
    return () => {
      alive = false
      madeListeners.delete(setMade)
    }
  }, [])
  return made
}
