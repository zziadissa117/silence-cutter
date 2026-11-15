import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { FUNCTIONS_URL } from '../config'
import { demoAsked } from './flag'
import { installServer, makeServer } from './server'
import { ACCOUNTS, makeWorld } from './world'

const storage = (on: boolean) => ({ getItem: (key: string) => (on && key === 'cutter.demo' ? 'on' : null) })

describe('demo mode: when it starts', () => {
  it('never on a real address, whatever the address asks', () => {
    expect(demoAsked({ hostname: 'cutter.netlify.app', search: '?demo=1' }, storage(true))).toBeNull()
    expect(demoAsked({ hostname: 'localhost.example.com', search: '?demo=1' }, storage(false))).toBeNull()
  })

  it('starts with ?demo=1 on this computer, stays on, and ends with ?demo=0', () => {
    expect(demoAsked({ hostname: 'localhost', search: '?demo=1' }, storage(false))).toBe('enter')
    expect(demoAsked({ hostname: '127.0.0.1', search: '' }, storage(true))).toBe('stay')
    expect(demoAsked({ hostname: '127.0.0.1', search: '?demo=0' }, storage(true))).toBe('leave')
    expect(demoAsked({ hostname: 'localhost', search: '' }, storage(false))).toBeNull()
    expect(demoAsked({ hostname: 'localhost', search: '?demo=0' }, storage(false))).toBeNull()
  })
})

describe('demo mode: the pretend server', () => {
  const world = () => makeWorld(Date.parse('2026-11-15T15:00:00Z'), 'America/New_York', (name) => `/media/${name}.mp4`)

  it('answers the real server\'s calls itself - the real one is never reached', async () => {
    const real = vi.fn(async () => new Response('real'))
    const target = { fetch: real as unknown as typeof fetch }
    const undo = installServer(makeServer(world()), target)
    const ask = (url: string, body: unknown) => target.fetch(url, { method: 'POST', body: JSON.stringify(body) })

    const posts = await (await ask(`${FUNCTIONS_URL}/postiz`, { action: 'posts', token: 'demo-token' })).json()
    expect(posts.posts.length).toBeGreaterThan(5)
    const login = await (await ask(`${FUNCTIONS_URL}/cutter`, { action: 'login', name: 'x', password: 'y' })).json()
    expect(login.token).toBe('demo-token')
    // Storage, or any other part of the real project: turned away here.
    const storageCall = await target.fetch('https://uykuoibqdxmpbbrsmyad.supabase.co/storage/v1/object/cutter-files/x', { method: 'PUT' })
    expect(storageCall.status).toBe(403)
    expect(real).not.toHaveBeenCalled()

    // Anything else (the app's own files) goes as usual.
    await target.fetch('/src/demo/media/react-1.mp4')
    expect(real).toHaveBeenCalledTimes(1)
    undo()
  })

  it('works out the week, the month and what works from the made-up posts', async () => {
    const server = makeServer(world(), () => Date.parse('2026-11-15T15:00:00Z'))
    const call = async (action: string, body: Record<string, unknown> = {}) => (await server.answer(`${FUNCTIONS_URL}/postiz`, { method: 'POST', body: JSON.stringify({ action, ...body }) })).json()
    const week = await call('week', { weeks: 0 })
    expect(week.days).toHaveLength(7)
    expect(week.campaigns.map((c: { name: string }) => c.name).sort()).toEqual(['FitPocket', 'Moonbrew', 'Trial reels'])
    const views = await call('views')
    expect(views.month).toHaveLength(30)
    expect(Object.keys(views.accounts)).toEqual(ACCOUNTS.map((a) => a.id))
    const insights = await call('insights')
    expect(insights.campaigns.length).toBe(2)
    expect(insights.trouble.map((t: { profile: string }) => t.profile)).toEqual(['samdaily.demo'])
  })

  it('his 3rd yes in a batch approves the rest of it, as the server does', async () => {
    const server = makeServer(world())
    const call = async (action: string, body: Record<string, unknown> = {}) => (await server.answer(`${FUNCTIONS_URL}/postiz`, { method: 'POST', body: JSON.stringify({ action, ...body }) })).json()
    await call('approve', { id: 'demo-wait-0' })
    await call('approve', { id: 'demo-wait-1' })
    const third = await call('approve', { id: 'demo-wait-2' })
    expect(third.alsoApproved).toBe(1)
  })
})

describe('demo mode: never in the real app', () => {
  // Every file that brings the demo in does it inside `if (import.meta.env.DEV)`,
  // which a build turns into `if (false)` and drops.
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'demo' ? [] : files(path)
      return /\.(ts|tsx)$/.test(name) && !name.includes('.test.') ? [path] : []
    })

  it('is only reached behind import.meta.env.DEV', () => {
    const src = join(__dirname, '..')
    const users = files(src).filter((path) => /from ['"].*\/demo\/|import\(['"].*\/demo\//.test(readFileSync(path, 'utf8')))
    expect(users.map((p) => p.slice(src.length + 1)).sort()).toEqual(['campaign/main.tsx', 'main.tsx'])
    for (const path of users) {
      for (const line of readFileSync(path, 'utf8').split('\n').filter((l) => /\/demo\//.test(l) && !l.trim().startsWith('//'))) {
        expect(line).toMatch(/^if \(import\.meta\.env\.DEV\) void import\(['"]\.{1,2}\/demo\/hook['"]\)/)
      }
    }
  })
})
