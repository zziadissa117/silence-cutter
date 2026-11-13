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
   `channels`, by the project's service key - see ARCHITECTURE.md). Never add
   another way to make a login: the only one is the owner's one-time sign-in link
   (cutter `invite` / `accept-invite`, his OK 2026-10-29) - no sign-up, no `create`. All `cutter_*` tables: RLS on, **no policies, no anon/authenticated
   privileges**. Secrets (Postiz/Anthropic keys, admin password) never go in code,
   the client, or git.
2. `supabase/functions/cutter/index.ts` in the repo is the deployed source of
   record. Deploying anything older reopens signup.
3. Show any SQL migration to the owner and wait for OK before applying it. The
   Supabase MCP `apply_migration`/`execute_sql` tool hangs on statements containing
   `delete`/`drop`; those are run by hand in the SQL editor.
4. Videos never leave the phone except as the finished MP4 to Postiz, and the
   campaign bank sent to **the engine** (`engine/`, OK'd by the owner) when he
   makes a batch there, or to **the Cutter server** (`server/`, his own Railway,
   asked for by him 2026-10-20) once it is connected - and, since his OK on
   2026-11-04, his talking-video recordings to that same server of his, to be
   listened to and made there (`talkOrder.ts`). Never upload a raw recording
   anywhere else.
5. Local-first: every change lands on the phone at once and syncs in the
   background; nothing waits on the network except first sign-in and posting.
6. One page runs at a time. Do not auto-update the service worker.
7. The plain cutter (`media/silenceCut.ts`, `App.tsx`) must keep working
   unchanged; `campaign/*` render files are siblings, not edits of it.
8. Idempotency everywhere: a video has a client key; sending twice must make one post.
9. No new dependencies without asking.

## Where things are

- Render: `src/campaign/{pipeline,plan,render,reactionRender,montageRender,joinRender}.ts`
- His voice measured once per person and mic (Settings -> Your voice): `VoiceSetup.tsx`, `voiceProfile.ts` (`withProfile` in `plan.planCampaignCut`); "um"s found by their sound, heard again, cut and listed (captions `UmFlags`, CutCheck kind `um`): `umFind.ts`
- Audio: `voice.ts`, `music.ts`, `sounds.ts`; captions `captions.ts`; headline `overlay.ts`, `look.ts`; effects `effects.ts`
- English or French, told from each video by itself (`media/speechLanguage.ts`, `transcribe.detectLanguage`, the multilingual `whisper-tiny` in `transcribe.worker.ts`; `plan.language`, `plan.frenchWords`); French skips the English letter aligner; Claude's captions, caption check, headline and motion graphics write in the language he speaks
- Music bank, shared by every phone that uses the Cutter: `musicBank.ts` (`syncSongs`, `ensureSong`), `MusicBankView.tsx`; server `cutter/songs.ts` (rows `song:<id>` in `cutter_config`, files `music/<sha>` in `cutter-files`)
- Edit screen like TikTok's (dark; timeline of what plays: clips of frames `filmstrip.ts` with arrows to trim, bars for text/overlays, toolbar along the bottom; drag/pinch the headline, Text, Overlay picture or video): `CutsEditor.tsx`, `manualPictures.ts` (`day.overlays`), `headlinePlace.ts`; drawn in `render.ts` (`texts`, `overlays`); questions before it: `CheckQuestions.tsx`
- Sounds in the edit screen (Sound tool: sound effects bank, the Cutter's effects, music bank, his phone): `SoundPicker.tsx`, `manualPictures.SoundSource`, `render.ts` `sounds`; sound effects bank = music bank songs with `sfx` (`MusicBankView.tsx`, server `cutter/songs.ts`)
- Videos before/after/in the middle (at a phrase): `clips.ts`, `cueClips.ts`, `ClipRow.tsx`, `ClipsField.tsx`
- One video, new songs (Batch tab: the same video posted again with other songs, picture untouched): `CopiesCard.tsx`, `copyTalk.ts`, `songSwap.ts`; planned by `batchRun.planCopies` (`BatchBank.copies`/`copiesMade`)
- Green screen (Batch "The product: Behind you"): `cutout.ts` (once per reaction), `greenScreenRender.ts` (product steps one after another; a talking reaction keeps his voice)
- One batch per account, made of formats (reaction, talking head, green screen - several of each): `batch.ts` `BatchFormat`, `BankFile.formats`/`BatchStep.formats`, `withFormats` (old banks), `formatBank`, `turnsFor`; `batchRun.planFormats`; Batch tab format cards `BatchView.formatCard`
- Batch keeps going (Videos a day + Start, no days): `batchRun.ts` (`runSlots`, `planVideos`, `topUp`; Batch tab and `CampaignApp` top up); more each day: `perDayOn` (`growth`, `growthFrom`); what it is doing, at the top of the Batch tab: `batchNow.ts` (`batchState`, `statusDays`), `BatchStatus.tsx`; times spread evenly around the clock: `window.ts` `evenTimes` (`posting.batchTimesOn`), what is scheduled moved to even times: server `postiz/respread.ts` + `respreadBatches` in `postiz/index.ts`, phone `keepEven.ts`
- Analytics tab (views per video, trend, "ready for more a day?"): `analytics.ts`, `AnalyticsView.tsx`; server `postiz/views.ts` (one account read per tick, cache in `cutter_config` `views:<profile>`); when to post and what works: `WhatWorks.tsx`, `batchFavour.ts` (Use the best hooks), server `postiz/bestHours.ts`, `postiz/hookInsights.ts`; accounts that stopped getting views `postiz/deadAccounts.ts` (`TroubleCard`); new headlines like the best `postiz/headlineIdeas.ts`
- Formats tab (script lines -> takes of each -> Make mixes them -> made -> kept -> saved for the brand -> scheduled): `formats.ts` (`mixesOf`, `afterMixing`), `FormatsView.tsx`; formats are angles with `isFormat`, their script `store.loadFormatScript` (takes in the bank), videos are jobs with `forFormat` + `formatMix` (`CampaignApp.makeFormat/joinFirst/holdFormat/scheduleFormat`, `store.holdMade/heldVideos`); server `batch.approvalFor` (`meta.scheduled`)
- Motion graphics (More -> Motion graphics: Claude's storyboard from his words, plan screen with stills + chat, then
  made in render.ts `motion`): `MotionView.tsx`, `motion/draw.ts` (the board and parts, drawn per frame),
  `motion/track.ts` (word numbers -> the video's clock), `motion/make.ts`, `motion/session.ts`, `motion/frames.ts`;
  two looks: board (`draw.ts`; pop cards over his face between boards, confetti; drawings `motion/icons.ts` drawn on and moving) and glass (Format 2: `motion/glass.ts` - everything inside the middle square `squareOf`, frosted cards over his face / low / side / behind him beside his head via `motion/liveCutout.ts` `behindBox`, four entrances, the steps light screen, a compare card (theirs crossed out vs his ticked), title, call to action always), picked in `motion/FormatPicker.tsx`; captions are the Cutter's own in every look; sound effects are his own from the music bank's Sound effects, matched by name (`sfx.bankSounds`); caption check before the plan (`MotionView.CaptionCheck`); on the plan screen Play draws it live over his video (`MotionView.drawLive`) and a tapped moment's words are changed or it is taken out by hand (`motion/editPlan.ts`); the shot's moves (push-in, cuts, punch-ins as big moments land) `motion/camera.ts`;
  server `postiz/motion.ts` (prompt, schema, `cleanStoryboard`), action `motion-plan`
- Warm-ups (More -> Warm-ups: shared ideas to film in seconds - headline, sound, length; anyone adds, the owner approves; partners first): `WarmupView.tsx`, `warmups.ts`; server `cutter/warmups.ts` + `warmupAction` in `cutter/index.ts` (rows `warmup:` / `warmcat:`, files `warmup/<sha>`, People `partner`); filming `WarmupFilm.tsx`, `warmupMake.ts`; posting `warmupPlan.ts`, `warmupSend.ts` (server `postiz/batch.warmupOf`); cold accounts `ColdWarmup.tsx`
- Trial reels (admins: the owner's login and the ones he turns on in People): `trialLoop.ts` (a batch of layout
  `trial` - the viral reels, how each copy differs), `viralReel.ts` (where the reel starts, its sound, a still),
  `TrialView.tsx` (More -> Trial reels); talking clips (one cut clip, same captions, a headline and song per copy): `TrialTalkStart.tsx`, `trialTalk.ts`, `trialLoop.TrialTalk`, server `postiz/trialHeadlines.ts` (`trial-headlines`); server `postiz/trial.ts` (`trialAllowed`, `trial-read`, Instagram's trial
  limit learned), `settingsFor` (`is_trial_reel`), cutter `trial`; research in `docs/TRIAL_REELS_AND_ORIGINALITY.md`;
  a login for Trial reels only: People tick -> cutter `invite only:'trial'`, cutter_config `trial-only`, postiz `trialOnly` refuses other posts, phone shell in `CampaignApp`
- A talking head batch's captions: its talking clip and each talked-over product step, heard once per clip (`talkCaptions.ts`, montageRender `captions.steps`)
- Batch mixing: `batch.ts` (`pickBatch`, `combos`; hooks in shares `looks`/`looksToMix` - headline looks and Claude + X; product steps `BatchStep` set in `StepOrder.tsx` - names and order; each step's own words and pictures/videos placed on a phone screen `StepTexts.tsx` (centre snap + guide line), `BatchStep.texts`/`BatchStep.overlays`, drawn by `montageRender` `stepTexts`/`stepOverlays` (`stepOverlays.ts`)), made by `montageRender.ts` (reaction zoom; each step clip plays its moment, found by `stepPiece.ts` from frame sizes; a wide clip shown whole on black, an upright one filling: `clipPlace`)
- Wide clips -> 9:16: `framing916.ts` (Settings: Fit - whole on black, the default - / Fill / Off); a 9:16 clip with black bands already in it is never zoomed: `blackBands.ts` (render.ts and montageRender.ts)
- Edit again: `store.ts` (markMade/reopenJob/expireMade, `stillKept`: until the post goes out, and 2 h after; server-made talking videos too), `PostsView.EditAgain`, `CampaignApp.editAgain/retireOld` (see ARCHITECTURE.md)
- Recording in the Cutter (camera, flip, light, takes): `Recorder.tsx` (Videos -> Record a video); the back camera's takes steadied after Done, only when it helps: `stabilize.ts`
- Tabs: `TabBar.tsx` (Videos, Posts, Batch, Analytics, More), `MoreView.tsx` (Campaigns, Formats, Bank, Settings, Cut only - each with `BackToMore`)
- Queue/storage: `store.ts`, `outbox.ts`; sync + login: `cloud.ts`, `SignIn.tsx`, `LoginGate.tsx`
- Updates: a new version waits until the page lets it in (`UpdateBanner.reloadIntoUpdate`; `skipWaiting` off in vite.config.ts; the campaign page's `restartPage` and the plain page's banner both go through it). One tab works at a time: `media/workLock.ts`. A cut that stops moving: `media/stallWatch.ts` (Cut only), `CampaignApp.watched` + `stallRestart.ts` (campaign)
- Secrets the functions read: `SUPABASE_SERVICE_ROLE_KEY` (the database), `CUTTER_ADMIN_PASSWORD`, and optional `CUTTER_TOKEN_SECRET` (login tokens and video links, both functions) and `CUTTER_SEAL_SECRET` (the sealed Postiz/Anthropic keys, postiz); unset, both fall back to the service key
- Shared by both pages (edit once): `media/audio.ts` (decode to 16 kHz mono, levels, `audioExtent`), `media/transcribe.worker.ts` + `media/transcribe.ts` (the one speech worker; the campaign page asks for `padQuiet`), `media/ort.ts` (runtime from the CDN), `media/recovery.ts` (decoder vs encoder vs storage failures), `config.ts` (functions URL + publishable key - the only copy), `words.ts` (the words both pages use), `share.ts`, `UpdateBanner.safeToReloadWith`
- Posting (phone): `posting.ts`, `PostsView.tsx` (one list by time - `postsList.postsOrder`: Up next, Didn't go out, Just posted), `NewPost.tsx`, `BatchView.tsx`
- A video with no talking is a reaction (`noTalk.noSpeechIn`): kept whole, no captions, its own sound muted and the music the only sound at -14 LUFS (`render.ts` `musicOnly`, `MakeOrder.musicOnly`); a song from the music bank when none is picked (`noTalk.songForReaction`)
- The look: tokens and cards in the last blocks of `campaign.css`; Videos top `HomeTop.tsx`, Analytics top `Overview.tsx`, section marks `Mark.tsx` (Batch) and Settings' `Section`
- Posting (server): `supabase/functions/postiz/*` (`slots.ts` times, `caption.ts`, `batch.ts`, `hand.ts`, `attach.ts`, `failed.ts` missed accounts,
  `channels.ts` accounts a campaign holds / `endPlan` for ending one - phone side `EndCampaign.tsx`)
- Each video's cover on the grid: its own moment per video and account (`postiz/cover.ts`, Postiz `thumbnailTimestamp`)
- Instagram location tagged on every Instagram post (default + per campaign): `postiz/place.ts`, `InstagramPlace.tsx`; Postiz doesn't pass it on yet - the request and patch for them in `docs/postiz-location`
- Buffer, the backup for Postiz (same video, caption, time, Instagram accounts matched by username): `postiz/buffer.ts`;
  in `postiz/index.ts` `PostizProblem`, `toBuffer`, `handOver` ("Postiz is down" switch), `checkBuffer`, `unpostHanded`;
  keys sealed in `cutter_profile_secrets.buffer_keys`, per-post `cutter_posts.buffer_ids`; phone `BufferBackup.tsx` (Settings, Posting)
- Duplicate protection: `campaign/fingerprint.ts` (never key a send or a bank file on a random id alone)
- Login (server): `supabase/functions/cutter/index.ts` (`whoami` is the engine's and the Cutter server's login check)
- The Cutter server (Railway: this same app headless in Chrome for Testing, making every batch day and night):
  `server/main.mjs` (Node, no packages), its image the root `Dockerfile` (Railway finds it by itself; `server/railway.json` points at it for a service set up with Railway's old config files), setup in `server/README.md`; Apple's emoji in its videos as pictures the iPhone draws: `emojiSprites.ts`;
  app side `serverMode.ts` (`?server=1` on its localhost, `serverFlag.ts`), phone side `serverLink.ts` (hand-over,
  each change, progress back; `batch.fromPhone` says who owns which field, `batchRun.handOver`), Settings "Server"
- Talking videos on the Cutter server (3+ waiting and the server up; listened to 4 at once, made 2 at once, sent to
  Postiz from there): `talkOrder.ts` (orders, `toServer`), phone `talkLink.ts` + `CampaignApp` (`talkTick`,
  `afterListen`, `makeOrderFor`, `onServer` on the job), server page `serverTalk.ts`, server `/talk` in `server/main.mjs`
- The engine (Railway, Python + ffmpeg, Ilyan's Le plateau): `engine/` (setup in `engine/README.md`); phone side
  `campaign/engine.ts`, Batch layout "On the engine", Settings "Engine". Tests: `cd engine && python3 -m unittest tests.test_engine`

## Workflow

Phases, verified one at a time (tests, `tsc`, lint, no console errors, existing
batches still work); commit after each. If ambiguous, take the simplest option
and note it in the commit message.
