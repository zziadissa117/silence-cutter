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
for that (Batch, layout On the engine); see "The engine" below. And **the Cutter
server** (`server/`, his own Railway): this same app, headless in Chrome, making
every batch day and night once it is connected - the phone sends it the banks;
see "The Cutter server" below.

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
- **The Cutter server** (`server/`) checks every public call's token with `whoami`, makes videos for one space and
  one posting profile only, and keeps the token on its own volume (it posts while the phone is closed). Its app
  page and `/local/*` routes listen on 127.0.0.1 only.
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
  -> ask     CheckQuestions.tsx (what Captions opens first): where it goes, headline + its look,
             music (JobRow.VideoFields), the pictures it shows (JobRow.PictureToggles), captions on
             the hook - in the row only without Captions
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
            the clip's frame sizes, all moments together at most showcaseMax; a step
            with a single clip plays whole, outside that cap (playsWhole) - batch.ts
            BatchStep, StepOrder.tsx), media/silenceCut.ts
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
**The Posts screen** (`PostsView`) is To approve -> Ready to post -> On the way -> Failed -> Scheduled ->
Posted. Approved posts are listed with Scheduled (they go at their time; Take back works on both). On
the way is one line (`OnTheWay`): the phone's queue - one video at a time (`outbox.sending().now`),
the rest "waiting their turn" whatever their last error - plus the server's `uploading`/`writing`;
only a video that can't go by itself (`SendEntry.stuck`: a `PostingError` that isn't `later`) gets
a row with Try again / Stop sending. The phone asks for posts, views and the profile through
`posting.shared`: askers at the same moment share one question, an answer from the last few seconds
is reused (`listPosts(true)` after a change of his), so a batch going up never sends Supabase a burst
it turns away (its 429 has no CORS header - Safari reads it as no connection). `call` tries a failed
fetch once more after 1.5 s before saying there is no connection.
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
Start over (`batchRun.startOver`): every batch video not out yet comes out (jobs dropped, posts
stopped), their combinations leave `made` - read back from each video's file name and headline
(`batch.mixPrefixes`), never one matching a posted or still-going-out video (`unmake`) - the days
are recounted from what is left, and the batch stops for Start.
No video twice: `made` holds this round's combinations (pruned to what is still in the bank);
a clip that leaves the bank after going into videos (taken out, a step removed, or `spend`) is
kept in `usedClips` by `clipKey` (fingerprint, else name|size), and adding it again is refused.
Overrides, his to take: Add anyway (after that refusal) takes the clip in again with `again`
(a timestamp) - `batch.usedKey` is then `clipKey~again`, so `fromPhone` keeps it though the
server's `usedClips` has its plain key, and its own use is remembered apart (`rememberUsed`
adds both). Start anyway (red, beside Start, only while mixes made before hold Start back)
starts with `made: []` and `anyway = startedAt`; `fromPhone` takes the phone's `made` for that
Start only. New post's Add anyway gives a video already sent its own send key
(`handPostKey…~again-<ms>`); Formats' Add anyway takes an opening already made back in, its job
id suffixed with the same stamp.
Words on a batch video other than the hook - step titles and the Claude + X amount - are always
`ONLY_HOOK_ELSE` (outline). `clipParts.writeWhole` fills each clip's sound up to its last frame's
end, so clips joined one after another leave no hole in the soundtrack. A batch video's sound
is the music alone, `montageRender.musicTrack`: one unbroken track from one running position,
written up to each frame as the picture goes (never after it - the file is streamed, and held
to the end it would keep every frame in memory); its clips' own sound is never read.
Times: the campaign's own, all of them, or its window as he set it (`window.ts`; one ending at
or before its start runs past midnight, `lengthOf`); without either, `DEFAULT_WINDOW` (11 AM -
6 PM, 3 a day). Times are 30 minutes apart while that many fit, closer when he wants more
(`gapFor`, never under `LEAST_GAP_MINUTES`, 1: 125 a day in a whole day are 11 minutes apart).
A full day keeps a quarter of it free (`posting.batchGap`) so its times move from day to day; times added to his own, or to a day
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

## Instagram location (`postiz/place.ts`, `InstagramPlace.tsx`)

One place every Instagram post is tagged with (`settings.instagramPlace`, action `save-place`,
Settings, Posting), or a campaign's own (`settings.campaigns[id].instagramPlace`, saved with its
posting). He pastes the place's Facebook page link, its Instagram location page or its ID
(`parsePlace`); `settingsFor` puts `location_id` (the Facebook Page ID Instagram takes) in every
Instagram post's Postiz settings (`instagramPlace`). Postiz validates settings without a whitelist,
so the extra field is kept - but it doesn't pass it to Instagram yet: the change for Postiz, and
the request, are in `docs/postiz-location`. Not sent to Buffer.

## Buffer, the backup for Postiz (`postiz/buffer.ts`)

When Postiz can't post, the Instagram accounts Buffer backs up get the same video, caption and
time through Buffer's GraphQL API (api.buffer.com, a personal key as Bearer; no upload - Buffer
fetches the video from a public link). Keys: pasted in Settings, Posting (`BufferBackup.tsx`,
action `backup`), checked by listing their channels, sealed in `cutter_profile_secrets.buffer_keys`;
the channels go in `settings.backup` and are matched to Postiz accounts by username
(`matchChannels`) whenever needed. Every error from a Postiz call is a `PostizProblem`. `prepare`
goes on without Postiz's copy of the video for a post with a backed-up account; `schedule`, when
Postiz fails, hands the backed-up accounts to Buffer (`toBuffer`: one `createPost` per account,
saved at once in `cutter_posts.buffer_ids`, so a retry never sends one twice) - unless the post is
over `HAND_AHEAD_MS` (6 h) away, when it waits with a `retry_at` nearer its time (Buffer's free plan
holds 10 posts a channel) and says `POSTIZ_WAIT`; the tick's `probePostiz` asks Postiz again with one
of a profile's such posts every 30 min (Postiz allows ~30 questions an hour), and once one gets in,
the rest get `retry_at` now. The rest of its accounts stay with Postiz. "Postiz is down"
(`settings.backup.active`) also has the tick's `handOver` give Buffer the posts Postiz already holds
whose accounts are all backed up (Postiz deletes whole posts only), `handOverPlan`: due within 6 h at
their own time, missed in the last 2 h spaced 30 min apart from now; `unpostHanded` then deletes
them from Postiz once it answers. It is a switch because Postiz's scheduler can keep posting while
its API is down. `checkBuffer` reads Buffer's status for posts that went only through Buffer (posted
/ error, links); `checkPosted` leaves those alone. A backed-up account's video keeps the server's
copy (the outbox parts) until its post is posted, errored or rejected, for Buffer to fetch through
the signed `videoUrl`; without it (posts Postiz took before this), Postiz's own `media.path`. Reject,
unschedule and stop also delete it in Buffer (`dropFromBuffer`).

## Formats (`formats.ts`, `FormatsView.tsx`)

A format is an angle with `isFormat`: its look and the clips joined onto every video (clips.ts,
set in the angle editor's Clips), and a script (`FormatScript`, meta `format:<angleId>`,
`store.loadFormatScript/saveFormatScript`): its lines in order, each with its takes - bank files
(`store.saveBankFile`, fingerprinted, a duplicate skipped) with `filmedAt` from the file. It is
never a candidate when sorting a day's videos. Make (`CampaignApp.makeFormat`) turns the script
into videos with `mixesOf`: one per take of line 1 (an opening opens one video only, then leaves
the line; its fingerprint goes in `opened` so it can't be added again), each with the take of
every other line in the fewest videos so far (`uses`), and of those the one filmed nearest the
opening (or at the same place in the line). Each video is a job with `forFormat`, `day.chosen`,
`formatMix` (its takes, read from the bank - no copies) and, for 2+ lines, `prejoin`; its id is
`format-<angle>-<opening fp>`, so Make twice never makes one twice. The rows are saved, then
`afterMixing` saves the script, then the openings are retired (`retireBankFiles`; the sweep keeps
any a saved row's `formatMix` still needs). `joinFirst` joins the takes (`finishPrejoin` keeps the
joined file as the job's own), then the job is listened to for captions, `approved` at once, made
like any talking video, and on `done` kept instead of sent (`holdFormat` -> `store.holdMade`: the
finished MP4 under `held:<id>`, the transcript/headline/duration on the row; never expired, the
recording goes after the edit window). A one-line format's video is its take, read straight from
the bank. They are left out of the Videos tab. Taking a take or line out, or deleting the format
or its campaign (`forgetFormats`, `store.deleteFormatScript`), retires its takes. Save opens the
share sheet with the files (to send the brand). Schedule (`scheduleFormat`) spreads them over
30, 7 or 5 days (`spreadOver`: `perDayCounts`, the campaign's `batchTimesOn`, `stackTimesOn`
clear of taken times, today only with room an hour ahead) and queues each with `meta.batch` and
`meta.scheduled`; the server's `approvalFor` makes such a post `direct`, so `takeBatchSlot` puts
it at its day and time and it is scheduled without waiting in Posts.

## Pictures that come up together, and pictures put on by hand

`render.ts` groups the pictures up at a frame by when each came up (`overlay.cameUpTogether`,
within 0.35 s) and lays each group out with `sideBySide` (one row, same height, inside the safe
width); the bank's pictures do the same with the newest mention. A picture put on by hand
(`ManualPicture`) can carry `center` (dragged in the cuts editor) which `layoutLogo` uses in place
of its spot. The cuts editor previews with `previewBoxes` - the render's own layout - and edits
the selected picture in `.pic-edit` (delete, seconds, size, start here, drag/pinch on the video).

## The edit screen as TikTok's editor (headline, + Text, + Overlay)

Everything he puts on a talking video in the edit screen is a `ManualPicture` in `day.overlays`,
told apart by `source.kind`: `bank`/`phone` image (a picture, as above), `phone` with a `video/*`
type or `video` (the video bank) - a video over him - and `text` (his words, `{ text, style }`).
`isPicture`/`isVideo`/`isText` say which. Phone files (pictures and videos) are kept per job in
`clipParts` (`store.saveOverlayFile`). The render (`pipeline.make` -> `renderCampaignCut`):
- pictures as before (`manualCues` takes only pictures);
- words (`texts`): `manualPictures.textHeadline` makes each a headline (`overlay.layoutHeadline`
  with a `place`), drawn from `at` for `seconds`, under the headline, logo and captions;
- videos (`overlays`): muted, read already sized to their box (`CanvasSink`, laid out by
  `layoutLogo` like a picture), one decoder for all of them (`popVideo.PopFrames`), up for
  `seconds` or to their end; one that can't be read is left out (`overlaysLeftOut`, said on the row).
The headline itself can be moved: `Headline.place` (`{ x, y, scale }`, middle as fractions of the
frame) put on the angle for one video only (`look.withHeadlinePlace`); `layoutHeadline` centres the
block there, scaled, inside the frame (Snapchat's band only moves up and down). Each video keeps
its own `day.headlinePlace` (null = the angle's spot); one never moved starts where he last moved
one of its angle's (`headlinePlace.ts`, this phone's localStorage), and is fixed on approve.
In `CutsEditor` the words and the headline are laid out at the frame's size and drawn on the
overlay canvas under the captions; a clear `.cuts-text-hold` (finger-sized) over each takes the
drag and pinch, as `.cuts-pic-preview` does for pictures and `<video>` overlays (played along on
the finished video's clock, `outputTime`). Things up together get their own timeline row
(`overlayRows`).

## Analytics (`analytics.ts`, `AnalyticsView.tsx`, server `postiz/views.ts`)

Only campaigns with a batch bank (running or made before) are shown - his CPM campaigns.

Per video (`postViews.ts`): the tick also reads one posted video's views a tick, per account
(`GET /analytics/post/:postId`), a day, three days and a week after it went out, into
`cutter_posts.views` (by account name) and `views_at`; the planner's `cutter-posted` returns them for its
views tracker (`campaigns.min_views`). The tick reads one account's views from Postiz (`GET /analytics/:id?date=7`) - the stalest of
the accounts a campaign posts to, each about once a day - so Postiz's hourly allowance stays
for posting. `readViews` brings each platform to views per video lately (TikTok: last 20
videos' views over their count; others: the week's views over the Cutter's posts there that
week - counted by `postedThere`, whose jsonb `contains` takes JSON text: given an array it
failed and counted 0 until 2026-10-22, so no Instagram account had a number; the `views` action
fills those from what was read, `fillPerVideo`); one reading a day is kept 60 days, in
`cutter_config` `views:<profile>`. The `views` action hands them to the phone (`posting.listViews`, cached for offline). The phone averages a
campaign's accounts (`campaignViews`), compares with a week before (`weekChange`), and for a
running batch suggests a small step (`suggestRate`: up a fifth or at `BatchBank.viewTarget` ->
more; down almost a third -> fewer; quiet 3 days after an answer). Yes saves the bank's
`perDay` and runs the app's batch runner (`runBatchesRef`), which trims or tops up at once.

## The music bank, shared (`musicBank.ts`, `MusicBankView.tsx`, server `cutter/songs.ts`)

Songs for every campaign, the same on every phone that uses the Cutter, whatever the login. Each
phone keeps its list in meta `music:bank` and the files as bank files (`saveBankFile`), as before.
`syncSongs` (on each sync, on opening the Music screen, after a change) sends what this phone did -
renames and takings-out queued in `music:pending`, then its songs not shared yet: the file (sound
only - a video's is taken out on adding, `soundOf`) to `cutter-files` `music/<sha256>` through
`song-upload`, then `add-song`, which keeps it as `cutter_config` `song:<id>` once the file is there
(`songFileThere`) - or answers with the song already there by sha or fingerprint, which this phone's
copy then becomes (`music:aliases` keeps the old id findable, `findSong`). Then `songs` brings the
list: `mergeSongs` keeps this phone's unshared songs, takes the server's names (unless a rename is
still going up), drops shared ones another phone took out and appends the others' new ones. Their
files come down the first time they are used (`ensureSong`: `song-urls`, checked against the sha) -
`songFile`, `copySong`, the Music screen's play and `BatchEdit` all go through it. Every song action
is behind the cutter login (`spaceFor`); the rows and the bucket have no policies.

## The Cutter server (`server/`, on Railway)

The Cutter app itself in Chrome for Testing (headless, Linux), driven by `server/main.mjs` (Node, no packages):
the same top-ups, mixing, rendering and sending as on the phone. Setup and diagram: `server/README.md`.

- Public port (`PORT`): `/health`; everything else needs the phone's Cutter token (Bearer), checked with the
  `cutter` function's `whoami`, and only that space - and the posting profile that connected first - once
  connected (`/connect`, `/files`, `/banks/:id`, `/banks/:id/start-over|back-to-phone`, `/status`). Browsers only
  from `ALLOWED_ORIGIN` (the Netlify app). The token and profile are kept in `/data/session.json` on its volume:
  it makes videos while the phone is closed.
- Local port (`APP_PORT`, 127.0.0.1 only): the built app (never its service worker) and `/local/*` for the page:
  the session, the clips, the inbox, its status and log.
- The page (`serverMode.ts`, `SERVER_MODE` = `?server=1` on localhost): signs in as the phone, always "visible",
  registers `@mediabunny/aac-encoder` (a chunk phones never download - `vite.config.ts`), reads clips from the
  server's disk (`store.loadBankFile`), takes the inbox every 10 s (`batch.fromPhone`), Start over and back to the
  phone (`CampaignApp`), and reports the banks and what it is making every 30 s. It never pushes campaigns
  (`cloud.syncNow`), keeps no made video once sent (`store.keptFor`, `outbox.sent`).
- Phone (`serverLink.ts`, from `CampaignApp` while the app is open): connects once per opening, hands every
  batch over (clips first, then `batchRun.handOver`, `where: 'server'`, `movedAt`), sends each settings change
  (`settingsKey`), and reads back the server's progress. `topUp` makes nothing on a phone with a server connected.
- HEVC/HDR clips are made H.264 by ffmpeg when they arrive; unused clips are let go after two days (`sweepFiles`).

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
- Never auto-update the service worker (UpdateBanner owns reloads). The one other reload: a video that stops
  moving for 90 s (`CampaignApp` `watched` -> `StallError`) restarts the page once per video (`stallRestart.ts`
  `firstRestartFor`; `restartPage` waits while he types or picks, and for saves and outbox copies) - on an iPhone
  the video maker stays stuck for the page's life once it goes quiet, and unfinished videos are picked up on load.
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
