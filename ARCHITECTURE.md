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
no ffmpeg and no ffprobe anywhere in the app. The one exception, OK'd by the
owner: **the engine** (`engine/`, Python + ffmpeg on Railway) - Ilyan's Le
plateau making big batches on a server. The phone sends it the campaign's bank
for that (Batch, layout On the engine); see "The engine" below.

## Stack

Vite 8 + React 19 + TypeScript 6, `vite-plugin-pwa` (prompt-to-update, not
auto-update: a reload mid-render loses video), Dexie 4 (IndexedDB), `mediabunny`
(demux/decode/encode/mux), `@huggingface/transformers` (whisper-tiny.en speech
model, in a worker), `@mediapipe/tasks-vision` (green screen cut-outs; model in `public/models`,
engine from jsdelivr), Vitest + jsdom, oxlint. Netlify hosts the static build
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
  video GETs, `tick` (secret-gated cron), and `channels` (the planner's
  `planner-postiz` function, same project, gated by the project's service key
  in `x-planner-bridge`; read-only toward Postiz, returns which channels a
  cutter campaign holds - `postiz/channels.ts`).
- Per-person **Postiz and Anthropic keys** are AES-GCM sealed by the postiz
  function and stored in `cutter_profile_secrets`; never on the phone.
- **Deploy hazard:** `supabase/functions/cutter/index.ts` in the repo must be
  the deployed one. Deploying an older copy reopens signup.
- **The engine** (`engine/`) checks every call's cutter login token with the
  `cutter` function's `whoami` (a valid token gets its space id, nothing else),
  keeps each space's batches apart, and answers browsers only from
  `ALLOWED_ORIGIN` (the Netlify app). It holds a phone's token in memory only,
  while that phone's batch is made, and posts through the `postiz` function with
  it - never to Postiz directly, never with a key of its own.

## Render pipeline (all on-device)

```
raw video file(s)
  -> (join) joinRender.ts          two recordings -> one file
  -> listen  pipeline.ts / plan.ts silence curve (media/silenceMath.ts) + speech model
             transcribe.worker.ts   words (+ align.ts re-times them to the voice)
             media/fillerWords.ts   which "um"/stumbles to cut
  -> review  EditScreen.tsx: CutsEditor.tsx/cuts.ts (the cut, by hand) with CaptionReview.tsx
             (the words) under it, on one page; captions off: CutsEditor alone
  -> make    render.ts             ONE pass: decode -> canvas (headline overlay.ts,
                                   logo, effects.ts, captions.ts) -> encode -> mux,
                                   audio mixed here: voice.ts (EQ/compress/loudness),
                                   music.ts (his track under the voice),
                                   sounds.ts (whoosh/ding/switch)
  middle:   cueClips.ts places an angle's "video in the middle" after its phrase, splitting
            the cut there; render.ts writes the clip between the two kept parts (`inserts`)
  green:    cutout.ts cuts him out of a reaction once (MediaPipe selfie segmenter; his frame
            over its mask in one MP4, kept by store.saveCutout); greenScreenRender.ts puts it
            in a corner over a Batch background video, its sound only
  siblings: reactionRender.ts (reaction clip + product clip), montageRender.ts
            (clips only, music only - the Batch tab's videos: reaction first, slowly
            zooming in, then the product whole or, with steps, one clip per step
            playing the moment something happens in it - stepPiece.ts finds it from
            the clip's frame sizes - batch.ts BatchStep, StepOrder.tsx), media/silenceCut.ts
            (the plain cutter)
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
- Picture/logo/sound timing: `campaign/moments.ts` `wordMoments` - from `plan.spoken` (the captions' words,
  letter-model timed when it ran), falling back per cue to `plan.words`; pictures and the logo lead the word by
  `PICTURE_LEAD_SEC` (0.1 s), sounds and the brand-hit zoom land on it; hand-placed pictures keep their time.
- Caption timing: `campaign/align.ts` + `align.worker.ts` (wav2vec2 letter model, forced alignment). Each
  speech-model window is heard in pieces of at most `ALIGN_PIECE_SEC` (8 s) cut mid-pause (`pieceCuts`), the
  letter scores joined (`joinPieces`) and the words aligned over the whole window. If it fails or goes quiet
  for 60 s, captions fall back to the speech model's own times (`HEARD_LATE_SEC`), reported as `fallback/aligning`.
  The campaign speech worker hears each window with 0.5 s of digital quiet either side (`timedWords.padWithQuiet`).
  With a headline, captions start at the first phrase mostly said after it (`captions.captionedIndices`). A word he
  types back at the start or end on Approve is reported (`captionFixes.typedBack`, kind `check`, phase `captions`).
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
                                        times, or window.ts random ones in its
                                        window; none -> at once; late days -> even spread;
                                        hand.ts: New post; batch.ts: Batch tab)
 PostsView: approve/edit/reject <---  status: uploading->writing->waiting->
                                        approved->scheduled->posted | error|failed
                                      pg_cron every 5 min POSTs {action:'tick'}
                                        -> retries, due posts, reminders, push
                                      Postiz API (per-profile key)  ------> TikTok/IG/YT/FB
 push.ts + public/push-sw.js  <-----  web push notifications
```
**Ending a campaign** (`EndCampaign.tsx` -> `end-campaign`): its posts are stopped, its accounts that nothing else
needs (`channels.ts` `endPlan`) are unticked and then deleted from Postiz in the background and on each tick
(`finishEnding`; the job in `cutter_profiles.settings.ending`, the result in `settings.ended`). Postiz's public API
can only delete a channel, never switch it off; deleting also deletes every post Postiz holds on it, so an account
with anything else on it is kept, with the reason shown.
`fake.ts` is a pretend Postiz + Claude for end-to-end tests (profile key starting
`test-fake-postiz:`). Each person has a **posting profile** (their own Postiz key,
accounts, times) inside the shared login that holds campaigns.

## Batches that keep going (`batchRun.ts`)

He sets Videos a day and taps Start once (`BatchBank.running`). `runSlots` fills every day
from today through `AHEAD_DAYS` (7) up to his number - an empty day takes `batchTimesOn`, one
already holding some takes `stackTimesOn` clear of its times - counting what it put on each
day in `BatchBank.filled` (days made before that count as `lastPerDay`). `planVideos` mixes
them (`pickBatch`), never past the different videos left; the last of them spends the bank
and stops the run (those videos carry `batch.last`, so the server's one notification for them says they
are the last - `postiz/batch.batchReady`). `topUp` saves the bank, then queues the videos (`CampaignApp.addBatch`) or
hands the days to the engine; a failure is kept in `runProblem` and tried again. Who tops up:
the Batch tab for its own campaign while open (`WhenDue`, a moment after the last change),
otherwise `CampaignApp` for every running campaign when the app opens, comes back on screen,
and every 30 min. `oneAtATime`/`settled` keep the two from making the same days at once.
Batch banks are on the phone with the footage, never synced, so a second phone never tops up.
Lowering the number (or 0, a pause) works at once too: `overfull` finds the days over it,
`dayVideos` lists the batch's videos on them (server posts + jobs here, one per key), and
`trimPlan` picks the extra to take out, leaving the rest spread through the day - jobs not
started are dropped, posts not out are stopped (`stopPostsNow`), posted or being-made ones stay.
On the engine, a batch still being made is stopped first and the days recounted (`countedDays`).
Times: the day is `window.ts` DAY (11 AM - 6 PM). A full day keeps a quarter of it free
(`posting.batchGap`) so its times move from day to day; times added to his own, or to a day
already holding some (`stackTimesOn`, given only the number still needed and today's `usable`
ones, so it keeps 20 minutes clear when there is room), are one from each stretch of the free
candidates (`batch.spreadPick`, seeded by campaign and day) - never the first free minutes.

Hooks in shares: `BatchBank.looks` - `{ look, parts }` for White box / Outline / Snapchat
headlines and Claude + X (`BatchLook`), picked in the Batch tab's Hook section (`HookLooks`,
− / + per look as a %). Older banks read through `looksOf` (`hook: 'formula'` alone, or
`headlineStyles` even). With two or more (`looksToMix`: not on the engine, no Claude + X in
green screen, headline looks only with headlines), the mix's hook dimension is every headline
in every headline look plus Claude + X at each amount of its range (`formulaAmounts`, at most
100) - each amount a different video, as each headline is; combo keys end `|<look>`, used counts
`s:<look>`. `pickBatch` first takes the look furthest behind its share this round (`behind`:
`(made + 1) / parts`), then the least-used unmade combination in it; a look with nothing left
sits out until the next round, and the same reaction is still never twice in a row. One look
(or Claude + X alone) keeps the keys and counts it always had. `planVideos` gives a Claude + X
pick the logos and `formulaLine(…, amount)`, a headline pick its `headlineStyle`
(-> `montage.bank`); at render `batch.styleFor` keeps it while still picked, else takes one
picked now, and `withHeadlineStyle` swaps it into the angle. The bottom of the Batch tab shows
the number of variations and `variationParts` (what multiplies into it).

## Formats (`formats.ts`, `FormatsView.tsx`)

A format is an angle with `isFormat`: its look and the clips joined onto every take (clips.ts,
set in the angle editor's Clips). It is never a candidate when sorting a day's videos. Takes
added on the Formats tab (`CampaignApp.addFormatTakes`) are jobs with `forFormat` and
`day.chosen`: listened to for captions, then `approved` at once, made like any talking video,
and on `done` kept instead of sent (`holdFormat` -> `store.holdMade`: the finished MP4 under
`held:<id>`, the transcript/headline/duration on the row; never expired, the recording goes after
the edit window). They are left out of the Videos tab. Save opens the share sheet with the
files (to send the brand). Schedule (`scheduleFormat`) spreads them over 7 or 5 days
(`spreadOver`: `perDayCounts`, the campaign's `batchTimesOn`, `stackTimesOn` clear of taken
times, today only with room an hour ahead) and queues each with `meta.batch` and
`meta.scheduled`; the server's `approvalFor` makes such a post `direct`, so `takeBatchSlot` puts
it at its day and time and it is scheduled without waiting in Posts.

## Pictures that come up together, and pictures put on by hand

`render.ts` groups the pictures up at a frame by when each came up (`overlay.cameUpTogether`,
within 0.35 s) and lays each group out with `sideBySide` (one row, same height, inside the safe
width); the bank's pictures do the same with the newest mention. A picture put on by hand
(`ManualPicture`) can carry `center` (dragged in the cuts editor) which `layoutLogo` uses in place
of its spot. The cuts editor previews with `previewBoxes` - the render's own layout - and edits
the selected picture in `.pic-edit` (delete, seconds, size, start here, drag/pinch on the video).

## Analytics (`analytics.ts`, `AnalyticsView.tsx`, server `postiz/views.ts`)

Only campaigns with a batch bank (running or made before) are shown - his CPM campaigns.

The tick reads one account's views from Postiz (`GET /analytics/:id?date=7`) - the stalest of
the accounts a campaign posts to, each about once a day - so Postiz's hourly allowance stays
for posting. `readViews` brings each platform to views per video lately (TikTok: last 20
videos' views over their count; others: the week's views over the Cutter's posts there that
week); one reading a day is kept 60 days, in `cutter_config` `views:<profile>`. The `views`
action hands them to the phone (`posting.listViews`, cached for offline). The phone averages a
campaign's accounts (`campaignViews`), compares with a week before (`weekChange`), and for a
running batch suggests a small step (`suggestRate`: up a fifth or at `BatchBank.viewTarget` ->
more; down almost a third -> fewer; quiet 3 days after an answer). Yes saves the bank's
`perDay` and runs the app's batch runner (`runBatchesRef`), which trims or tops up at once.

## The engine (`engine/`, on Railway)

```
phone, Batch "On the engine"                 engine (Python, ffmpeg, /data volume)
 Settings: its address (engine.ts)
 saveEngineSeries: hook lines  ---------->   series/<campaign>/settings.json
 sendFootage: what it lacks, 8 MB pieces ->  uploads.py -> series/<campaign>/{hook,product}, songs (sons.py)
 makeOnEngine: batch id, days+times  --->    jobs.py, one batch at a time:
   (each top-up of a running batch is one)
                                               hooks.py   Claude rewords the lines (optional key)
                                               remixer.py Le plateau's render (Ilyan's, unchanged)
                                               guard.py   near-copy check (dHash, 30/90 days, in-batch)
                                               poster.py  -> postiz function start/parts/sent, key
                                                          engine-<batch>-<n>, meta.batch day+time
 polls /jobs/<id> every 15 s; Stop; Carry on (/jobs/<id>/again: same keys, sent ones skipped)
```
Videos made there wait in Posts like any batch (approval `me`): watch one, then Approve all.
Which bank files were sent is kept on the phone (`cutter.engineSent`) and checked against the engine's list.
Setup steps: `engine/README.md`. Tests: `engine/tests/test_engine.py` (real renders).

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
`campaign/cloud.ts`; the engine's address is typed in Settings and kept on the phone). Edge Function secrets:
`CUTTER_ADMIN_PASSWORD`; `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Engine (Railway
variables, `engine/engine/config.py`): `ANTHROPIC_API_KEY` (optional), `ALLOWED_ORIGIN`, `ENGINE_DATA` (`/data`),
`PORT`.

## Run, build, test

```
npm ci --ignore-scripts   # onnxruntime-node's postinstall needs a download; not needed for tests/build
npm run dev
npm test                  # vitest, jsdom (321 tests)
npx tsc -b
npm run lint              # oxlint
npm run build             # tsc -b && vite build -> dist/
cd engine && python3 -m unittest tests.test_engine   # the engine (needs ffmpeg + requirements.txt)
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
                               slots.ts times, window.ts random times (also imported by the phone's
                               posting.ts/batch views), attach.ts late-account rules, batch.ts, hand.ts, caption.ts,
                               failed.ts (accounts a post missed: names, retry-accounts)
supabase/migrations            SQL
public/push-sw.js              service-worker push handler
engine/                        the engine on Railway (Python): engine/ its code, plateau/ Ilyan's files, tests/
```

## Gotchas

- Colours only as tokens (`index.css` top: dark in `:root`, light under `prefers-color-scheme` and
  `[data-theme='light']`); `theme.ts` sets `data-theme` and `tips-on`. An explanation (not a status) gets the class
  `tip` - hidden unless Settings, Show tips is on. A section's rows go on one card in a `.card-group` (Settings);
  a long list (Pause and daily limits) gets its own page opened from one row, not a block in Settings.

- Only one page runs at a time; never add a long-running second queue.
- Never auto-update the service worker (UpdateBanner owns reloads).
- The campaign page scrolls as the document and `.tabbar` is `position: fixed` to its bottom. Never size a
  container to the screen (a fixed `inset: 0` frame, `100%`, `100svh`/`100dvh`): on iOS 26 the home-screen
  app (viewport-fit=cover + black-translucent status bar, WebKit bug 301108 - the status bar is now plain black to avoid it) reports those a status bar's
  height short, which left the bar a block up with a dead black strip under it. Only `100lvh` is the full
  screen there; the installed app's html/body are at least that tall so short screens reach the bottom.
  Changing the status-bar meta would fix it at the root, but iOS reads it only when the app is added to the
  Home Screen, and removing the app to add it again can wipe its storage (videos not yet sent with it).
- The edit screen (`EditScreen.tsx`) is CutsEditor with CaptionReview `embedded` under its buttons: one video
  (the cuts editor's), the captions drawn on it through `paintOver`, the phrases seeking and playing it through
  `CutsControl`. A cut change settles for 0.4 s, then the captions follow (`CampaignApp.followCuts`,
  `captions.withRestored`); leaving keeps cuts and captions in one write (`keepEdit`).
- CutsEditor and CaptionReview hold only their head row and the video at the top (`.review-top`, sticky);
  anything else there (the caption look, the headline, the picture picker) left no room on a phone.
- A change to a render function must keep preview and real frames on the same code.
- A finished video is copied to private storage the moment it is made; do not
  rely on the list for it. That copy is let go once Postiz has the video (`outbox.copyDone`: scheduled/error with
  a media URL, posted, rejected); Watch/Save/Add music then use Postiz's copy (`post.videoUrl`).
- Once a day the campaign page reports what it stores (`storageReport.ts`, `check`/`storage`). Safari's own
  errors ("EmptyRanges", "Script error.") are not reported as crashes (`report.safarisOwn`).
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
