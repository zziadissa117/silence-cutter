// @vitest-environment node
// A Mac's disk doesn't tell capitals apart: two files whose names differ only
// in them are one file there, and an import finds the wrong one - his
// ./deploy.sh stopped on batchStatus.ts beside BatchStatus.tsx (2026-10-25)
// while every check passed here, on Linux.

import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** What an import names: the file without its extensions - tests left out,
 *  nothing imports them. */
function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return modules(full)
    if (/\.test\.[jt]sx?$/.test(entry.name) || !/\.[jt]sx?$/.test(entry.name)) return []
    return [path.join(dir, entry.name.replace(/\.[jt]sx?$/, ''))]
  })
}

describe("the app's file names", () => {
  it('never differ only in capitals', () => {
    const byLower = new Map<string, Set<string>>()
    for (const name of modules(path.resolve(__dirname))) {
      const key = name.toLowerCase()
      byLower.set(key, (byLower.get(key) ?? new Set()).add(name))
    }
    const clashes = [...byLower.values()].filter((names) => names.size > 1).map((names) => [...names].map((n) => path.relative(__dirname, n)))
    expect(clashes).toEqual([])
  })
})
