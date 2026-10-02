# AGENTS.md

Instructions for coding agents (Codex, Claude Code). Full map:
`ARCHITECTURE.md`. Keep both updated when structure changes.

## What it is

Phone-first PWA: cuts silences/"um"s out of talking-head video on-device, brands
it per campaign, posts it to social platforms via Postiz. Vite + React + TS,
Dexie, `mediabunny` (WebCodecs), Supabase (Postgres + 2 Edge Functions), Netlify.
**No ffmpeg/ffprobe**: inspect media with `mediabunny` track metadata.

## Commands

```
npm ci --ignore-scripts
npm run dev | npm test | npx tsc -b | npm run lint | npm run build
git checkout tsconfig.tsbuildinfo   # after builds (tracked file)
```

## Hard rules

1. **Security first.** The login gate (`campaign/LoginGate.tsx`) is the front
   door; the server is the lock. Never add a route, table grant or function
   action that exposes data without a valid cutter login token. Never re-add
   login creation. All `cutter_*` tables: RLS on, **no policies, no anon/authenticated
   privileges**. Secrets (Postiz/Anthropic keys, admin password) never go in code,
   the client, or git.
2. `supabase/functions/cutter/index.ts` in the repo is the deployed source of
   record. Deploying anything older reopens signup.
3. Show any SQL migration to the owner and wait for OK before applying it. The
   Supabase MCP `apply_migration`/`execute_sql` tool hangs on statements containing
   `delete`/`drop`; those are run by hand in the SQL editor.
4. Videos never leave the phone except as the finished MP4 to Postiz. Never
   upload a raw recording.
5. Local-first: every change lands on the phone at once and syncs in the
   background; nothing waits on the network except first sign-in and posting.
6. One page runs at a time. Do not auto-update the service worker.
7. The plain cutter (`media/silenceCut.ts`, `App.tsx`) must keep working
   unchanged; `campaign/*` render files are siblings, not edits of it.
8. Idempotency everywhere: a video has a client key; sending twice must make one post.
9. No new dependencies without asking.

## Where things are

- Render: `src/campaign/{pipeline,plan,render,reactionRender,montageRender,joinRender}.ts`
- Audio: `voice.ts`, `music.ts`, `sounds.ts`; captions `captions.ts`; headline `overlay.ts`, `look.ts`; effects `effects.ts`
- Wide clips -> 9:16: `framing916.ts` (Settings: Fill/Fit/Off)
- Queue/storage: `store.ts`, `outbox.ts`; sync + login: `cloud.ts`, `SignIn.tsx`, `LoginGate.tsx`
- Posting (phone): `posting.ts`, `PostsView.tsx`, `NewPost.tsx`, `BatchView.tsx`
- Posting (server): `supabase/functions/postiz/*` (`slots.ts` times, `caption.ts`, `batch.ts`, `hand.ts`, `attach.ts`)
- Duplicate protection: `campaign/fingerprint.ts` (never key a send or a bank file on a random id alone)
- Login (server): `supabase/functions/cutter/index.ts`

## Workflow

Phases, verified one at a time (tests, `tsc`, lint, no console errors, existing
batches still work); commit after each. If ambiguous, take the simplest option
and note it in the commit message.
