import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Which copy this is: the commit it was built from and that commit's date.
 *  Shown on the page and in every error, so a screenshot from someone else's
 *  phone says which version it came from. The same for every build of the
 *  same code - a build stamped with the clock changed the shared chunk's
 *  hash on every deploy, and every phone downloaded 1.2 MB again for
 *  nothing. Netlify names the commit in COMMIT_REF; git knows the rest. */
function version(): string {
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      return ''
    }
  }
  // Netlify names the commit in COMMIT_REF, Railway (the Cutter server's
  // image, built with no .git) in RAILWAY_GIT_COMMIT_SHA; git knows the rest.
  const commit = (process.env.COMMIT_REF || process.env.RAILWAY_GIT_COMMIT_SHA || git('rev-parse HEAD')).slice(0, 7)
  const date = git('log -1 --format=%cs')
  // Without any of those, at least when it was built.
  if (!commit) return `dev · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
  return `${commit}${date ? ` · ${date}` : ''}`
}
const BUILT = version()

/** The notification handlers are a separate file pulled into the service
 *  worker; a change to it has to make a new worker, which the version in its
 *  address does - from the file's own contents, so nobody has to remember. */
const PUSH_SW_VERSION = createHash('sha1').update(readFileSync(here('./public/push-sw.js'))).digest('hex').slice(0, 8)

/** onnxruntime-web refers to its "asyncify" WebAssembly build by URL, so Vite
 *  copies it into every build: 27 MB that nothing ever fetches, since the
 *  workers point the runtime at the plain build on the CDN before it loads
 *  (src/media/ort.ts). Left out of the bundle. */
const dropUnusedRuntime: Plugin = {
  name: 'drop-unused-ort-wasm',
  generateBundle(_options, bundle) {
    for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name]
  },
}

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
        main: here('./index.html'),
        campaign: here('./campaign.html'),
      },
      // The AAC encoder only the Cutter server needs (serverMode.ts), in a
      // file of its own that a phone never fetches or keeps.
      output: {
        manualChunks: (id) => (id.includes('@mediabunny/aac-encoder') ? 'server-aac' : undefined),
      },
    },
  },
  plugins: [
    react(),
    dropUnusedRuntime,
    VitePWA({
      // Deliberately NOT autoUpdate. An auto-updating service worker reloads
      // the page out from under whoever is using it, and this tool's whole
      // job is a long-running queue of big video files. A reload mid-cut is
      // exactly the bug that made the planner version lose videos.
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/server-aac-*.js'],
        // A new version waits until the page lets it in (UpdateBanner.tsx
        // reloadIntoUpdate), at a moment nothing is lost. Taking over the
        // moment it downloaded deleted the old files from the cache under a
        // page still cutting, whose next worker then 404'd. The page never
        // waits for ever either: it is the one asking.
        skipWaiting: false,
        clientsClaim: true,
        // The posting's notifications (public/push-sw.js). The version in
        // the address makes a change to that file a new service worker too.
        importScripts: [`push-sw.js?v=${PUSH_SW_VERSION}`],
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
          // UGC Roadmap's logo (his ask, 2026-11-05: "brand the cutter with this").
          { src: '/ugc-roadmap-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/ugc-roadmap-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/ugc-roadmap-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
