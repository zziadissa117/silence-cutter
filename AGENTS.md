# AGENTS.md

Instructions for coding agents (Codex, Claude Code). Full map:
`ARCHITECTURE.md`. Keep both updated when structure changes.

## What it is

Phone-first PWA: cuts silences/"um"s out of talking-head video on-device, brands
it per campaign, posts it to social platforms via Postiz. Vite + React + TS,
Dexie, `mediabunny` (WebCodecs), Supabase (Postgres + 2 Edge Functions), Netlify.
**No ffmpeg/ffprobe** in the app: inspect media with `mediabunny` track metadata (only `engine/`, on a server, uses ffmpeg).

## The rule behind every feature: least input, most output

He makes thousands of videos a month (25 posts a day). Every tap, number or
choice the app asks of him is paid again every day; the program's time is free.

- The app works things out itself: from the footage, what was made and posted
  before, the accounts, the clock. Never ask him to type a value the program
  could measure or decide (seconds, sizes, levels, times, counts).
- A setting is the last resort: a default that is right without being touched,
  shown only when there is truly no way to decide it.
- Two more hours of building to save him one second a day is worth it. Take the
  automatic version even when it is much more work.
- Anything he still sets by hand is a candidate to automate; say so when you see one.

## Commands

```
npm ci --ignore-scripts
npm run dev | npm test | npx tsc -b | npm run lint | npm run build
git checkout tsconfig.tsbuildinfo   # after builds (tracked file)
```

Shipping is done from the owner's Mac: `./deploy.sh` ships the app (Netlify login
only, no Supabase); `./deploy-server.sh` ships the `postiz` and `cutter` functions
(`--no-verify-jwt`), and `deploy.sh` says when it is needed. When a change touches
`supabase/functions`, say "Needs deploying: run ./deploy-server.sh" in the CHANGELOG.

## Hard rules

1. **Security first.** The login gate (`campaign/LoginGate.tsx`) is the front
   door; the server is the lock. Never add a route, table grant or function
   action that exposes data without a valid cutter login token (the two
   server-to-server exceptions: `tick`, by its `cutter_config` secret, and
   `channels`, by the project's service key - see ARCHITECTURE.md). Never re-add
   login creation. All `cutter_*` tables: RLS on, **no policies, no anon/authenticated
   privileges**. Secrets (Postiz/Anthropic keys, admin password) never go in code,
   the client, or git.
2. `supabase/functions/cutter/index.ts` in the repo is the deployed source of
   record. Deploying anything older reopens signup.
3. Show any SQL migration to the owner and wait for OK before applying it. The
   Supabase MCP `apply_migration`/`execute_sql` tool hangs on statements containing
   `delete`/`drop`; those are run by hand in the SQL editor.
4. Videos never leave the phone except as the finished MP4 to Postiz, and the
   campaign bank sent to **the engine** (`engine/`, OK'd by the owner) when he
   makes a batch there. Never upload a raw recording anywhere else.
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
- Videos before/after/in the middle (at a phrase): `clips.ts`, `cueClips.ts`, `ClipRow.tsx`, `ClipsField.tsx`
- Green screen (Batch layout): `cutout.ts` (once per reaction), `greenScreenRender.ts`
- Batch keeps going (Videos a day + Start, no days): `batchRun.ts` (`runSlots`, `planVideos`, `topUp`; Batch tab and `CampaignApp` top up)
- Analytics tab (views per video, trend, "ready for more a day?"): `analytics.ts`, `AnalyticsView.tsx`; server `postiz/views.ts` (one account read per tick, cache in `cutter_config` `views:<profile>`)
- Formats tab (takes -> made -> kept -> saved for the brand -> scheduled): `formats.ts`, `FormatsView.tsx`; formats are angles with `isFormat`, takes are jobs with `forFormat` (`CampaignApp.addFormatTakes/holdFormat/scheduleFormat`, `store.holdMade/heldVideos`); server `batch.approvalFor` (`meta.scheduled`)
- Batch mixing: `batch.ts` (`pickBatch`, `combos`; hooks in shares `looks`/`looksToMix` - headline looks and Claude + X; product steps `BatchStep` set in `StepOrder.tsx` - names and order only), made by `montageRender.ts` (reaction zoom; each step clip plays its moment, found by `stepPiece.ts` from frame sizes)
- Wide clips -> 9:16: `framing916.ts` (Settings: Fill/Fit/Off)
- Edit again: `store.ts` (markMade/reopenJob/expireMade, 2 h window), `PostsView.EditAgain`, `CampaignApp.editAgain/retireOld` (see ARCHITECTURE.md)
- Queue/storage: `store.ts`, `outbox.ts`; sync + login: `cloud.ts`, `SignIn.tsx`, `LoginGate.tsx`
- Posting (phone): `posting.ts`, `PostsView.tsx`, `NewPost.tsx`, `BatchView.tsx`
- Posting (server): `supabase/functions/postiz/*` (`slots.ts` times, `caption.ts`, `batch.ts`, `hand.ts`, `attach.ts`, `failed.ts` missed accounts,
  `channels.ts` accounts a campaign holds / `endPlan` for ending one - phone side `EndCampaign.tsx`)
- Duplicate protection: `campaign/fingerprint.ts` (never key a send or a bank file on a random id alone)
- Login (server): `supabase/functions/cutter/index.ts` (`whoami` is the engine's login check)
- The engine (Railway, Python + ffmpeg, Ilyan's Le plateau): `engine/` (setup in `engine/README.md`); phone side
  `campaign/engine.ts`, Batch layout "On the engine", Settings "Engine". Tests: `cd engine && python3 -m unittest tests.test_engine`

## Workflow

Phases, verified one at a time (tests, `tsc`, lint, no console errors, existing
batches still work); commit after each. If ambiguous, take the simplest option
and note it in the commit message.
