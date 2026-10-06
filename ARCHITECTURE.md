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
- Wide clips (Meta glasses): `campaign/framing916.ts` - detects non-9:16 from the
  display size (rotation applied), Fill (crop, default) / Fit (blurred backdrop) / Off,
  stored in localStorage `cutter-landscape-mode`, set in Settings, used by render.ts.
  Clips already 9:16 are never touched. Join/montage/reaction already cover-fill.
  On adding, only clips that are not phone-upright (`isUpright`: landscape, square,
  3:4) get `WideAsk` ("cut" or "only make 9:16" -> job `noCut`, plan `keepWhole`);
  a portrait phone clip (9:16, 9:19.5) is never asked and always cut. A `noCut` row
  says "not cut, only made 9:16".
- Caption timing: `campaign/align.ts` + `align.worker.ts` (wav2vec2 letter model, forced alignment). Each
  speech-model window is heard in pieces of at most `ALIGN_PIECE_SEC` (8 s) cut mid-pause (`pieceCuts`), the
  letter scores joined (`joinPieces`) and the words aligned over the whole window. If it fails or goes quiet
  for 60 s, captions fall back to the speech model's own times (`HEARD_LATE_SEC`), reported as `fallback/aligning`.
- Cut decisions: `campaign/plan.ts` `planCampaignCut` decodes and listens, then runs
  the pure steps `fromHeard` (word times, "um"s, caption words), `plainKeep` (the cut;
  the whole cut when noise cutting is off, the default) and, with noise cutting on,
  `noiseCandidates` + `noiseCuts.cutNoise`. `plan.test.ts` runs them on a synthetic
  talking-head take (stretched word ends, a cough): pauses cut, words whole.
- Effects: `campaign/effects.ts`, `EffectsSection.tsx` (opt-in, with examples).

**Duplicates (Phase 1.1).** `campaign/fingerprint.ts` = size + SHA-256 of three
1 MB samples. The Batch bank (`BatchView.add`, `BankFile.fp`) and New post
(`NewPost.add`) skip a recording already there and say so; a hand post's send key
is `post-<fingerprint>-<campaign>-<day>` (`handPostKey`), so a re-pick/re-tap lands
on the same key (the server keeps one post per profile + key). `queueSend` returns
`'duplicate'`.

**Account linked after videos were made (Phase 1.2).** A post's `accounts` are fixed
when it is prepared. `PostingEditor` shows "Add to videos already made" (default on)
when picked accounts are missing from waiting/approved/scheduled posts
(`accountsBehind`); saving calls the server action `attach-accounts`
(`postiz/index.ts attachAccounts`, decisions in `postiz/attach.ts`): waiting/approved
posts just gain the account; a scheduled post gets a Postiz post for ONLY the new
account at its existing time (existing accounts untouched, no double posting);
posted/too-close/busy posts are left and reported. `unschedule`/`reject` now delete
every Postiz group (`deleteScheduled`), since late accounts are their own group.

**Pause and daily limits (Phase 2.1).** `settings.limits` on the posting profile
(`{platforms:{tiktok:{paused,perDay}}, accounts:{<id>:{...}}}`, no table): set in
Settings (`PostingLimits.tsx`, action `save-limits`). `postiz/limits.ts`: at
schedule time `split()` removes paused/full accounts from the group and marks them
`held` on the post (`accounts` jsonb); the others go as planned; if every account
is held the post stays `approved`, untouched, retried every 30 min. `releaseHeld()`
(run by every 5-min `tick`) gives a freed account its own Postiz post from the same
video+caption, at the video's time of day on the first day with room. Paused ones
resume without loss; caps are counted per account per local day.

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
`media/jobStore.ts`. Sync pulls by `server_at`, which the function stamps before
the write commits, so each pull looks back `PULL_OVERLAP_MS` (2 min) and the read
point only moves forward (`pullFrom`/`readTo`); `applyRemote` keeps only newer rows.

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
supabase/functions/postiz      posting, captions, scheduler, push (Edge Function);
                               slots.ts times, attach.ts late-account rules, batch.ts, hand.ts, caption.ts
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
  keep working exactly as it did. Shared by both: `media/recovery.ts` (decoder
  gave up -> fresh decoder from the last frame written, up to 4 times; waits for
  the page to be visible first). The plain cutter also cuts pauses-only when the
  speech model cannot start for memory (`App.tsx`, says so on the row).
- Postiz refuses browser calls and only takes MP4 (`toMp4.ts`).

## Edit again (Phase 5 / 4.1 / 3.2)

A finished *talking* video (plan present; not reaction, montage, batch, joined) is
not forgotten when made: `store.markMade` stamps `madeAt` and keeps its job row
(listen plan, captions, cuts, music) and raw recording for `EDIT_WINDOW_MS`
(2 h). `expireMade` removes older ones (on load + every 5 min). Made jobs are
never returned by `loadPendingJobs`, so they are not re-queued.

Posts view shows "Edit again · Xh left" when the post's job is in `editableJobs()`.
`CampaignApp.editAgain` -> `store.reopenJob` (clears madeAt, `version`+1, `replaces` =
old post key, day.approved=false) -> caption review (with Cuts + per-video music).
Approving re-makes it; `sendToPostiz` sends under `postKeyOf(id, version)` (`id~2`)
after `retireOld` rejects the old post (unschedules in Postiz) - unless it already
posted, in which case a notice says the edit goes out as a new post. No server
change: reuses the `reject` action. Not yet covered: reaction/montage/batch videos,
and excluding a single bank picture from one video.
