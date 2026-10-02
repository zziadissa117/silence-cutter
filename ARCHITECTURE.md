# ARCHITECTURE

Map of the repo. Keep it current: any change that adds, moves or removes a
file, table, secret, route or pipeline stage updates this file and `AGENTS.md`.

## What it is

A phone-first PWA that cuts the silences and "um"s out of raw talking-head
video, brands it for a campaign (headline, logo, sounds, captions, effects),
and posts the finished videos to TikTok / Instagram / YouTube / Facebook
through **Postiz**, on each campaign's own posting times. **All video work
happens in the browser, on the phone** (WebCodecs via `mediabunny`); videos
never go to a server except as the finished file on its way to Postiz. There is
no ffmpeg and no ffprobe anywhere in this stack.

## Stack

Vite 8 + React 19 + TypeScript 6, `vite-plugin-pwa` (prompt-to-update, not
auto-update: a reload mid-render loses video), Dexie 4 (IndexedDB), `mediabunny`
(demux/decode/encode/mux), `@huggingface/transformers` (whisper-tiny.en speech
model, in a worker), Vitest + jsdom, oxlint. Netlify hosts the static build
(`netlify.toml`: `npm run build` -> `dist`). Backend: two **Supabase Edge
Functions** (Deno) plus Postgres tables, in project `uykuoibqdxmpbbrsmyad`,
which is **shared with the planner app** (`ugc-planner` repo: its `public.*`
tables use Supabase Auth; this app's `cutter_*` tables do not).

## Two pages (separate on purpose, only one runs at a time)

| Page | Entry | What |
|---|---|---|
| `/campaign.html` | `src/campaign/main.tsx` -> `LoginGate` -> `CampaignApp` | the real app: Videos, Posts, Batch, Campaigns, Pictures, Settings |
| `/` | `src/main.tsx` -> `App.tsx` | the plain "Cut only" tool; redirects to campaign.html unless signed in (`opening.ts`) |

`ModeNav.tsx` switches between them; leaving a page stops its work, so it asks
first when something would be lost.

## Security model (read before touching login or the functions)

- **Login-first.** `src/campaign/LoginGate.tsx` renders only `SignIn` until
  there is a session (`cloud.ts` `currentSession()`); it returns the moment the
  session ends (`SESSION_EVENT`). Offline use is unaffected once signed in.
  The gate is the front door, **the lock is the server**.
- **One shared login** (name + password) lives in `cutter_spaces`. **Logins
  cannot be created**: `supabase/functions/cutter/index.ts` ignores `create`.
  Unknown name, wrong password and wrong admin password all answer `Wrong login
  or password.`; 5 wrong passwords lock 30 min.
- **Admin backup:** name `admin`, password = Edge Function secret
  `CUTTER_ADMIN_PASSWORD` (>= 12 chars; unset = no admin). Opens the same space
  (the oldest `cutter_spaces` row). Own failure counter in `cutter_config`.
- All `cutter_*` tables have RLS on with **no policies**, and (since 2026-10-02)
  `anon`/`authenticated` have **no table privileges** on them. Only the service
  role (the two Edge Functions) can read or write. The `cutter-files` and
  `postiz-outbox` storage buckets are private with no policies.
- Both functions are `verify_jwt = false`: the cutter login token (HMAC-signed
  with the service key, bound to the space + a piece of its password hash) is
  checked inside. Open routes: `login`, `report` (insert-only, capped), signed
  video GETs, and `tick` (secret-gated cron).
- Per-person **Postiz and Anthropic keys** are AES-GCM sealed by the postiz
  function and stored in `cutter_profile_secrets`; never on the phone.
- **Deploy hazard:** `supabase/functions/cutter/index.ts` in the repo must be
  the deployed one. Deploying an older copy reopens signup.

## Render pipeline (all on-device)

```
raw video file(s)
  -> (join) joinRender.ts          two recordings -> one file
  -> listen  pipeline.ts / plan.ts silence curve (media/silenceMath.ts) + speech model
             transcribe.worker.ts   words (+ align.ts re-times them to the voice)
             media/fillerWords.ts   which "um"/stumbles to cut
  -> review  CutsEditor.tsx/cuts.ts fix the cut by hand; CaptionReview.tsx fix words
  -> make    render.ts             ONE pass: decode -> canvas (headline overlay.ts,
                                   logo, effects.ts, captions.ts) -> encode -> mux,
                                   audio mixed here: voice.ts (EQ/compress/loudness),
                                   music.ts (his track under the voice),
                                   sounds.ts (whoosh/ding/switch)
  siblings: reactionRender.ts (reaction clip + product clip), montageRender.ts
            (clips only, music only), media/silenceCut.ts (the plain cutter)
  -> outbox.ts                     copy the finished MP4 to private storage, send in
                                   parts, resume after a dropped connection
```

Queues: `media/jobStore.ts` (plain cutter) and `campaign/store.ts` (campaign
side; separate DB so nothing can collide). Both keep the video in IndexedDB so a
killed tab loses nothing, read it only when its turn comes, and count every
attempt before it starts (a video that kills the tab cannot loop).

**Music, captions, headlines — where they live**
- Music: `campaign/music.ts` (mix: -14/-20 LU under voice, ducks while he talks,
  fades, loops), tracks in the bank (`BankView.tsx`, `MusicRow.tsx`, `SoundRow.tsx`);
  **baked into the render today** (not a separate layer).
- Captions: burned-in word-pop captions `campaign/captions.ts` +
  `CaptionReview.tsx`; the **post caption** (text sent to the platform) is written
  by Claude server-side from stills (`postiz/caption.ts`), edited in `PostsView`.
- Headlines: `campaign/overlay.ts` (position/draw, same function for preview and
  every frame), `headlineFont.ts` (TikTok Sans, bundled), set per angle in `look.ts`.
- Effects: `campaign/effects.ts`, `EffectsSection.tsx` (opt-in, with examples).

## Posting pipeline

```
phone (outbox.ts, posting.ts)          Edge Function postiz            Postiz
 finished MP4 in parts  ----------->  join parts, check MP4
 client_key per video (idempotent)    Claude writes caption (caption.ts)
                                      pick the time (slots.ts: campaign's own
                                        times; late days -> even spread;
                                        hand.ts: New post; batch.ts: Batch tab)
 PostsView: approve/edit/reject <---  status: uploading->writing->waiting->
                                        approved->scheduled->posted | error|failed
                                      pg_cron every 5 min POSTs {action:'tick'}
                                        -> retries, due posts, reminders, push
                                      Postiz API (per-profile key)  ------> TikTok/IG/YT/FB
 push.ts + public/push-sw.js  <-----  web push notifications
```
`fake.ts` is a pretend Postiz + Claude for end-to-end tests (profile key starting
`test-fake-postiz:`). Each person has a **posting profile** (their own Postiz key,
accounts, times) inside the shared login that holds campaigns.

## Data model (Postgres, all RLS-locked)

`cutter_spaces` (login: name, pass_salt, pass_hash, lockout) · `cutter_items`
(synced campaigns/angles/bank, per space) · `cutter_profiles` + `cutter_profile_secrets`
(posting profile; sealed keys) · `cutter_posts` (one row per finished video:
status machine above, `slot`, `post_at`, `accounts`, `postiz_ids`, `release_urls`,
`by_hand`, `batch`, `spread`...) · `cutter_push` (web-push subscriptions) ·
`cutter_config` (`tick_secret`, VAPID keys, `admin_failed`, `admin_locked_until`) ·
`cutter_errors` (phone error reports, insert-only) · `cutter_fake_postiz` (tests).
Migrations: `supabase/migrations/*.sql` (the first recreates tables that already
existed live; apply new ones by hand and show them first).

Client-side (IndexedDB, Dexie): campaign looks/angles/bank + queue in
`campaign/store.ts` (synced via `campaign/cloud.ts`), plain-cutter queue in
`media/jobStore.ts`.

## Env / secrets (names only)

Client: none (the function URL and the public publishable key are constants in
`campaign/cloud.ts`). Edge Function secrets: `CUTTER_ADMIN_PASSWORD`;
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

## Run, build, test

```
npm ci --ignore-scripts   # onnxruntime-node's postinstall needs a download; not needed for tests/build
npm run dev
npm test                  # vitest, jsdom (321 tests)
npx tsc -b
npm run lint              # oxlint
npm run build             # tsc -b && vite build -> dist/
```
`tsconfig.tsbuildinfo` is tracked; `git checkout tsconfig.tsbuildinfo` after builds.

## Folder map

```
index.html / campaign.html     the two entry pages
src/main.tsx, App.tsx          plain cutter ("Cut only")
src/campaign/                  the campaign app (CampaignApp.tsx is the 2.4k-line shell)
  *View.tsx, *Editor*.tsx      screens: Batch, Posts, Campaigns, Bank, Settings, New post
  pipeline/plan/render/...     see render pipeline; cloud.ts = shared-login sync + sign-in
  store.ts, outbox.ts          local storage + upload queue
src/media/                     the plain cutter's engine, reused by campaign/
src/{report,leaving,opening,CrashGuard,UpdateBanner,VideoPicker,pick*}.ts(x)  shell helpers
supabase/functions/cutter      login + shared-setup sync (Edge Function)
supabase/functions/postiz      posting, captions, scheduler, push (Edge Function)
supabase/migrations            SQL
public/push-sw.js              service-worker push handler
```

## Gotchas

- Only one page runs at a time; never add a long-running second queue.
- Never auto-update the service worker (UpdateBanner owns reloads).
- A change to a render function must keep preview and real frames on the same code.
- A finished video is copied to private storage the moment it is made; do not
  rely on the list for it.
- `render.ts` is a *sibling* of `media/silenceCut.ts`; the plain cutter must
  keep working exactly as it did.
- Postiz refuses browser calls and only takes MP4 (`toMp4.ts`).
