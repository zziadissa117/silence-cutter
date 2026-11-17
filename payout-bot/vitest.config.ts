import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', root: import.meta.dirname, testTimeout: 30_000 },
})
