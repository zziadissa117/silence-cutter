// Every hint that sends him somewhere under More ("add songs in More → Bank")
// names a row that is really there - "More → Music" pointed at nothing
// (found 2026-11-15 while writing the guide).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : []
  })

describe('More → … in the hints', () => {
  it('names only rows More has', () => {
    const more = readFileSync(join(__dirname, 'MoreView.tsx'), 'utf8')
    const rows = new Set([...more.matchAll(/name: '([^']+)'/g)].map((m) => m[1]))
    expect(rows.has('Bank')).toBe(true)
    const pointers = files(__dirname).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .flatMap((line) => [...line.matchAll(/More → ([A-Z][\w-]*(?: [a-z][\w-]*)?)/g)].map((m) => ({ path, to: m[1] }))),
    )
    expect(pointers.length).toBeGreaterThan(0)
    for (const { path, to } of pointers) expect([path, rows.has(to) || rows.has(to.split(' ')[0]) ? 'ok' : to]).toEqual([path, 'ok'])
  })
})
