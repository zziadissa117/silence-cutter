import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // The Discord bot has its own packages and tests: run them from payout-bot/.
  test: { environment: 'jsdom', exclude: [...configDefaults.exclude, 'payout-bot/**'] },
})
