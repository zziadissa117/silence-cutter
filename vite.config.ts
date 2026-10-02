import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** When this copy was built, in UTC. Shown on the page and in every error, so
 *  a screenshot from someone else's phone says which version it came from. */
const BUILT = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(BUILT) },
  // The speech model runs in a module worker (src/media/transcribe.worker.ts),
  // and the model library it loads splits into chunks, which only the ES
  // worker format can do.
  worker: { format: 'es' },
  // Two pages: the plain cutter at /, and campaign videos, kept apart so the
  // plain one runs exactly as it always has. See src/ModeNav.tsx.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        campaign: fileURLToPath(new URL('./campaign.html', import.meta.url)),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // Deliberately NOT autoUpdate. An auto-updating service worker reloads
      // the page out from under whoever is using it, and this tool's whole
      // job is a long-running queue of big video files. A reload mid-cut is
      // exactly the bug that made the planner version lose videos.
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Take over as soon as a new version downloads, instead of waiting
        // for every open copy of the old page to close. iOS never closes a
        // bookmarked web app, only freezes it, so waiting meant forever. The
        // page itself still decides when to reload - see UpdateBanner.tsx.
        skipWaiting: true,
        clientsClaim: true,
        // The posting's notifications (public/push-sw.js). The version in
        // the address makes a change to that file a new service worker too.
        importScripts: ['push-sw.js?v=1'],
      },
      manifest: {
        name: 'Silence Cutter',
        short_name: 'Cut',
        description: 'Cuts the dead air and the "ums" out of raw video, on your own phone.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#07090c',
        theme_color: '#07090c',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
