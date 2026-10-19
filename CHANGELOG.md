# Cutter patch notes

Newest first. Every change says what it does, how to use it, and how it works
underneath. Kept up to date with each commit.

## Batch: several headline looks at once, and the number of variations at the bottom
Only ./deploy.sh is needed.
**What:** under a batch's Headlines, White box / Outline / Snapchat can now be on together - tap one to add it, tap it
again to take it out (one always stays). With more than one, the videos take turns: the same headlines in each look,
evenly - with all three, a third of the videos in each (15 videos: 5 Outline, 5 Snapchat, 5 White box). Every headline
comes in every look, so each look counts as more different videos. Step names follow each video's look.
At the very bottom of the Batch tab: **"360 variations"** with what multiplies into it ("4 reactions × 3 product
showcases × 5 headlines × 2 songs × 3 headline looks") and how many are still to make, with the days that lasts. It
replaces the "X of Y different videos left" line, and shows even when Videos a day is 0.
**How:** `BatchBank.headlineStyles` (`stylesOf` reads the earlier single `headlineStyle`); `pickBatch`/`combos` add the
look as a dimension only with two or more (`stylesToMix`) so one-look banks keep their keys; `BatchVideo.headlineStyle`
-> `montage.bank.headlineStyle`; at render `styleFor` keeps it while still picked, else one picked now (a change reaches
videos not made yet). `batchRun.variationParts`. Tests in `batch.test.ts`, `batchRun.test.ts`, `batchView.test.tsx`.

## Headline style (Snapchat, Outline, White box) picked right where the headline is written
Only ./deploy.sh is needed.
**What:** the Snapchat look was only in Campaigns -> the angle -> Headline -> Style, so it was easy to miss. Now the
three looks (White box / Outline / Snapchat) sit right under the headline in two more places:
- **Videos tab:** open a video waiting to be approved; under its Headline box, tap the look for that one video. It
  starts on the angle's look.
- **Batch tab:** under the Headlines list, tap the look for every video of the batch. The step names (Set order) use
  the same look. It is read when each video is made, so it reaches every batch video not made yet; videos already made
  keep their look.
**How:** `look.HEADLINE_STYLES` (shared with the angle editor) and `withHeadlineStyle(angle, style)`; per video
`day.headlineStyle` (`CampaignApp.setHeadlineStyle`), per batch `BatchBank.headlineStyle`; the render loop swaps the
angle's headline style for whichever is set (the video's first) before any make. Picker: `JobRow.HeadlineLook`. Tests in
`headlineLook.test.tsx`, `batchView.test.tsx`.

## Batch: each step's name written over its clip, as a headline
Only ./deploy.sh is needed.
**What:** in a batch with steps (Set order), every video now shows each step's name over that step's clip, in the same
headline text as the reaction's (TikTok font, the angle's headline look): a step named "DRAW SOMETHING" puts "DRAW
SOMETHING" over its part of every video, exactly as typed. A step still called "Step 1", "Step 2"... shows no words -
rename it to have some. Videos already planned get it too (their step names are looked up from the campaign's steps).
The Batch tab says under each step what will be written.
**How:** `batch.stepTitle`; `BatchVideo.steps[].name` (set by `batchRun.planVideos`), `MontageParts.bank.steps[].name`;
`makeMontage`/`renderMontage` `titles` per clip, laid out with `layoutHeadline` in `look.headline` and drawn for the
whole clip. Tests in `batch.test.ts`, `batchRun.test.ts`.

## Pictures side by side; pictures fully editable in the editor; Analytics only for batches
Only ./deploy.sh is needed.
**Pictures side by side:** pictures that come up together - one word bringing up two (give two pictures the same words
in the angle's Pictures, or two bank pictures share a word), or two put on by hand at the same moment - now sit side by
side in one row, the same height, inside the frame, instead of on top of each other. Before, the bank showed only the
newest, and two angle pictures overlapped.
**Pictures in the editor (cuts/captions page):** the controls were there but at the very bottom, under every caption
phrase - so a picture put on by mistake looked impossible to remove. Now tapping a picture (on the video, the timeline,
or the new row of picture chips under the buttons) opens it right under the video:
- **Delete picture**.
- **On screen for** − / + (half a second at a time, 0.5 to 20 s).
- **Size** slider (8% to 100% of the width), or pinch it on the video.
- **Drag it on the video** anywhere you like (**Put back** returns it to its usual spot).
- **Start it here**: moves it to where the playhead is.
What the video shows while you edit is exactly where it lands in the finished video.
**Analytics:** only your batch campaigns now (Lovable, OpenArt - any campaign with a batch); your other accounts are
gone from it, and so is the account-by-account list. Each card: videos a day, views a video, the trend on last week,
and the "Ready for N a day?" suggestion right in the card.
**How:** `overlay.cameUpTogether` (within 0.35 s), `sideBySide`, `layoutLogo` `center`; `render.ts` draws angle and
bank pictures in groups. `ManualPicture.center`, `PICTURE_SECONDS`, `PICTURE_WIDTH`, `previewBoxes` (the render's own
layout, for the preview); `CutsEditor` panel `.pic-edit`, chips, pointer drag/pinch on the selected picture.
`AnalyticsView`/`useCampaignRows` keep campaigns with a batch only. Tests: `overlay.test.ts`, `cutsPictures.test.tsx`,
`analyticsView.test.tsx`.

## Captions: every sentence keeps its first and last word, and shows them long enough to read
**What:** captions were losing words at the edges of sentences. Each sentence is its own kept stretch (the pause
between is cut), and the speech model times edge words a little off:
- A word **starting in the last 0.1 s** of a stretch was dropped outright - the "a bit early" allowance shifted it
  past the end, where no other rule caught it. In a simulation of 600 sentences with the model's real timing error,
  53 lost their last word this way. Now 0.
- A sentence's last word heard up to half a second after the cut is kept when it carries the sentence on (the word
  before it didn't end one) - before, only the rougher timings got that much room.
- A sentence's first word timed just before its stretch (short ones: "And", "I", "So") is kept when it ends within a
  quarter-second of it and the sentence before has ended.
- The last words of a sentence were squeezed into its final 0.1 s, two or three frames. Each now gets at least a
  quarter-second (the earlier words move up a touch to make room); in the simulation, last words on screen for under
  0.2 s went from 30 to 2.
**How:** `captionWords` (captions.ts): in-stretch test no longer shifted at the end, `EARLY_END_SEC` for first words,
the half-second late window when the sentence hasn't ended, and a per-stretch `READ_SEC` tail fit after the in-order
pass. Tests: the old "drop a late last word" expectation now keeps it; new cases for an early first word and readable
last words.

## Formats tab: drop in your takes, get them made, send them to the brand, schedule the week
Needs deploying: run ./deploy-server.sh (scheduled videos skip approval), then ./deploy.sh.
**What:** a new **Formats** tab (next to Videos).
- **Pick the campaign, tap + New format, name it** (e.g. "Morning routine"). Its editor opens: set its look like any
  angle and, under **Clips**, the clips joined onto every take - intro before, product demo or outro after, clips in
  the middle at a phrase.
- **Open the format, tap + Add takes** and pick all the takes you filmed for it. Each one becomes its own video: cut,
  captioned, joined with the format's clips, with its headline and logo - like the Videos tab, but no sorting and no
  approving in between.
- **They wait in the format, not posted.** Tap **Watch** to check one, **Save** (or **Save all to my phone**) to put
  them in your Photos/Files and send them to the brand. They're kept on the phone until you schedule them - closing
  the app doesn't lose them.
- **Brand said yes?** Tap **Schedule for the week** or **Next 5 days**: the videos are spread as evenly as possible
  over those days (it shows which days before you tap), at the campaign's posting times, clear of what's already
  there. They post by themselves - no approving again - and show in Posts like any post.
- A take that fails shows **Try again**; ✕ takes one out. If the headline/caption look fails on one, you still get a
  plain cut (marked).
**How:** formats are angles with `isFormat` (never used to sort a day's videos; no "Recognise it by"). Takes are jobs
with `forFormat`: listened to for captions, then made straight away (`approved`), and when made `holdFormat` keeps the
finished MP4 (`store.holdMade`, `held:<id>` in the videos table) with the transcript/headline/duration, instead of
sending. Held videos never expire; their recording goes after the 2 h edit window. `scheduleFormat` spreads them
(`formats.spreadOver`, `perDayCounts`) and queues each with `meta.batch` + `meta.scheduled`; the server's
`approvalFor` makes a scheduled batch video `direct`, so it goes at its time. `FormatsView.tsx`; tab bar now 7 tabs
(10 px labels, iOS's own size). Tests: `formats.test.ts`, `formatsView.test.tsx`, `postiz/batch.test.ts`.
**Not checked here:** making real videos (this browser can't encode H.264) and the iPhone share sheet with several
videos at once - the store keeping is typechecked, not run.

## Analytics tab: views per video, the trend, and "ready for more a day?" - one tap
Needs deploying: run ./deploy-server.sh (the server reads the views), then ./deploy.sh.
**What:** a new **Analytics** tab (between Batch and Campaigns):
- **Each campaign:** its views per video (its accounts averaged) and how that moved on last week, then each account
  with its views per video, followers, trend and when it was last read.
- **Suggestions you answer with one tap:** when a running batch's videos are doing well - views per video up a fifth
  on last week, or at the number you set - a card says "Inflow: ready for 4 a day?" with **Yes, 4 a day** and
  **Not now**. Yes changes Videos a day and the week ahead follows at once (like the + on the Batch tab). If views
  fall by almost a third it suggests one fewer (unless you're still at your number). Steps are small - one a day,
  two once past five - never past 25, and after you answer it leaves that campaign alone for 3 days so the new rate
  can show. A blue dot on the tab means a suggestion is waiting.
- **Your number (optional), per campaign:** "Suggest more a day at [1000] views a video". Empty: it goes by the
  trend only. Both count: up a fifth OR at your number.
**Where the views come from:** Postiz reads them from the platforms. TikTok: the total views of your last 20 videos,
over how many (so views per recent video). Instagram, YouTube: views over the last 7 days, over the videos the Cutter
posted there. The server reads one account every few minutes, each about once a day, so it never uses up Postiz's
hourly allowance that posting needs; with ~20 accounts the first numbers fill in over the first hour or two after the
deploy. Postiz only has views from when an account was connected; brand-new accounts may show nothing for a few days.
**How:** server `postiz/views.ts` (`readViews` per platform, `remember` one reading a day for 60 days, `notRead`
retries in 6 h, `dueAt`), `index.ts` `refreshViews` in the tick (the stalest account a campaign posts to, one
`GET /analytics/:id?date=7` a tick; a 429 is left for the next tick) and the `views` action (login-checked), cache in
`cutter_config` `views:<profile>`. Phone: `analytics.ts` (`weekChange`, `campaignViews`, `suggestRate`, `stepFrom`,
answers per campaign), `AnalyticsView.tsx` (`useCampaignRows`, `answerSuggestion`, `saveTarget`), `posting.listViews`,
`BatchBank.viewTarget`, `TabBar` dots. Lowering moved to `batchRun.trimDown`, so the app's own batch runner now
lowers days too (a "fewer a day" yes applies at once, whatever tab is open). Tests: `views.test.ts`,
`analytics.test.ts`, `analyticsView.test.tsx`.

## Headline: Snapchat style
**What:** a third headline style, next to White box and Outline: **Snapchat** - white words on a see-through black
band right across the video, the way a Snapchat caption looks. Pick it in the angle's Headline -> Style; Where and
Size work as for the others, and batches made with that angle use it. On the iPhone it is drawn in Apple's own font,
as Snapchat's is. Only ./deploy.sh is needed.
**How:** `look.HeadlineStyle` 'snap'; `overlay.layoutHeadline` (system font, smaller sizes, a band's padding kept
below TikTok's tabs) and `drawHeadline` (one `fillRect` the canvas's full width at 60% black, then white text);
`Editors` STYLES. Test in `overlay.test.ts`.

## Batch: change videos a day any time - up, down, or 0 to pause - and it follows at once
**What:** while a batch runs, change **Videos a day** whenever you like and the week ahead follows straight away:
- **Up** (2 -> 10 -> 25): the extra videos are added to the days already made, as before.
- **Down** (25 -> 2): the extra videos come back out of the days ahead, leaving the rest spread through each day.
  Ones not made yet are dropped; ones waiting or scheduled are stopped, the same way Posts stops them. One already
  posted, or being made right that second, stays.
- **0**: paused. Everything not out yet comes out, nothing new is made, your clips and what's left to make are kept.
  Raise it again and it picks up from there - no need to tap Start.
- **Tap the number to type it** (2 to 25 in one go) instead of tapping + 23 times. The +/- still work; quick taps
  make one change, not one per tap.
On the engine, lowering also stops the batch it is making, then hands it the days again at the new number.
Only ./deploy.sh is needed.
**How:** `batchRun.ts` `overfull`, `dayVideos` (server posts + jobs here, one per key), `trimPlan` (keeps an even
spread; never posted, never the job being made), `countedDays` (after the engine is stopped). `BatchView.runTrim`
(`WhenDue`, before any top-up); 0 allowed (`BATCH_MAX_PER_DAY` still the top); the number is an input. Tests in
`batchRun.test.ts` and `batchView.test.tsx` (lower, pause, typing 25).

## Batch: no more Days - pick videos a day, tap Start, it keeps going
**What:** the Batch tab's Posting is now just **Videos a day**. Days and the "On top / After" choice are gone. Tap
**Start**: the next 7 days are made straight away. After that, every time you open the Cutter, the batch makes the
days it's missing by itself - no tap - so there's always a week of videos waiting. It stops on its own once every
different video your footage can make has been made (you get "Time to film new ones", as before), or when you tap
**Stop**. Raise Videos a day and the days already made get the extra ones too (clear of their times); lower it and
the days not made yet get fewer. It says how many different videos are left and how many days that lasts. Same on the
engine: each top-up is handed to it. Every video still waits in Posts for your approval. Batches you made before keep
their days; tap Start once to keep them going. Only ./deploy.sh is needed.
**Good to know:** the phone layouts still make videos only while the app is open (as before) - now it just happens
without you asking. The engine makes them with the app closed.
**How:** `batchRun.ts`: `runSlots` (every day from today through a week, up to the number; empty days take the
campaign's batch times, part-filled days `stackTimesOn` clear of their times), `planVideos` (mixing moved out of
`BatchView.make`; caps at the different videos left, spends and stops at the last), `topUp` (saves the bank, then
queues or hands to the engine; failures kept in `runProblem`). `BatchBank.running`, `filled` (count per day; old days
count as `lastPerDay`). Top-ups: the Batch tab for its campaign (`WhenDue`, 1.2 s after the last change), and
`CampaignApp` for every running campaign when the app opens, comes back on screen and every 30 min; `oneAtATime` /
`settled` keep them from overlapping. `planSlots` and the stacking UI are gone. Tests: `batchRun.test.ts`,
`batchView.test.tsx` (Start, Stop, top-ups, old batches).

## Batch: no seconds to set - each step plays the moment something happens in its clip
**What:** **Set order** is now just the step names and their order; the seconds boxes are gone. When a video is made,
the Cutter looks at each step's clip and plays the moment something happens in it - a scroll, an answer appearing,
typing - from just before it starts to just after it settles (2-5 s).
- A clip with several moments: different videos play different ones, the bigger ones more often.
- A long moment (a minute of typing): 3-5 s of it, from a different place in each video.
- A clip you trimmed to 4 s or less: plays whole.
- Nothing stands out (all still, or filmed footage moving the whole time): a random 2-3.5 s of it.
- All the steps together never run past 12 s (each shortened evenly, none under 1 s).
Steps you already set keep their names and clips; the seconds typed before are ignored, and videos already planned
use the new way when they're made. Only ./deploy.sh is needed.
**How:** `stepPiece.ts`. A still frame is stored in a few bytes and a changing one in many, so the clip's frame sizes,
read from its index (mediabunny `EncodedPacketSink`, metadata only - no picture decoded, a few ms even for a long 4K
clip), show when something happens: `activityOf` (bytes per quarter second, key frames counted as ordinary frames,
smoothed), `momentsOf` (above 25% of the way from the quiet level to the busiest, gaps under 0.75 s joined; none unless
the busiest is 2.5x the quiet), `pickPiece`, `fitShowcase`. `montageRender` `windows` is now true/false per clip;
`BatchStep` has no `minSec`/`maxSec`. Tests: `stepPiece.test.ts` (including an MP4 written and read back). Checked on
ffmpeg-made H.264 and HEVC clips: a scroll at 3-5 s found at 2.75-5.25 s; still and always-moving clips find none.
**Also:** AGENTS.md now opens with the rule behind every feature - least input from him, most output from the app.

## Fix: Edit again takes the post out of Posts until the new version is ready
**What:** tapping **Edit again** on a post now takes it off the Posts screen (and out of the "to approve" count) right
away. It stays off while you edit and while the new version is made; the new version shows up in Posts once it's made
and sent, replacing the old one. If the old one was already scheduled in Postiz, it's taken back out while you edit,
so the old version can't go out in the meantime. Remove the edited video from the list and the old post comes back.
One already posted stays, as before. Same for batch videos (new headline / track).
**How:** `posting.isBeingRemade` (+ `remade.test.ts`): a post whose key a job `replaces`, not gone out yet.
`PostsView` `remaking` (filters it out of every list), `CampaignApp` `remaking` / `remakingRef` (also the count),
`holdWhileRemade` (unschedules a scheduled one) on Edit again and on a batch remake.

## Fix: headlines with emoji centred, and never off the sides
**What:** on the iPhone an emoji is drawn wider or narrower than Safari says it is, and a headline with one could come
out off to one side - sometimes. The headline is now laid out on how it is really drawn: where lines break, how wide
each is, and where its middle is. A line that still can't fit (one long word, a row of emoji) makes the headline a
little smaller instead of running off the edges. Only ./deploy.sh is needed.
**Why "sometimes":** the centring already drew each line once to find its real middle, but (1) where lines broke still
used Safari's width, so a line could come out too wide; (2) the scratch canvas was sized from that width too, so a much
wider emoji was cut off and centred wrong; (3) the first emoji drawn could come out missing. All three are fixed.
**How:** `overlay.ts` `layoutHeadline` (wraps on drawn width for lines with emoji, shrinks to fit, up to 3 tries),
`inkOf` (room for the widest it could be, draws twice, retries wider if the ink touches the edge). Checked in Chromium
with real emoji (every line centred to the pixel, before and after - the bug is Safari's), and a test for the shrink.

## Batch: product showcase in steps (Set order), and the reaction zoom really on batches
**What:**
- **Set order** (Batch tab, next to the campaign): name the steps of the campaign's product showcase in order - e.g.
  "Claude", "The app", "The prompt" - up to 10, each with how long it plays (2-3 s to start; 1-15 s). Save order,
  and the product showcases become one list per step ("1. Claude", "2. The app"...): add as many clips to each as you
  like. Every video plays the reaction, then one clip from each step in your order - a random few seconds of it, from
  a random place - with the song over all of it (the step clips are muted).
- **Many more different videos:** each step is its own choice, so 5 reactions x 4 clips in each of 3 steps x 20
  headlines x 5 songs = 32,000 combinations before the random slices; each is made once before any comes again, and
  every clip comes round evenly. Big banks are picked in a moment (it stops listing every combination past 20,000 and
  takes the least-used of each part, still never repeating one it remembers).
- Each campaign keeps its own order. Campaigns with no order set work exactly as before (one list, each clip whole).
  Taking a step out takes its clips with it (asks first if it has any). When every combination is made, the clips go
  (film new ones) and the step names stay. Green screen and the engine don't use steps yet.
- **The reaction zoom now reaches batch videos:** the last update only zoomed reaction videos made one at a time - the
  Batch tab makes its videos another way. Now every batch reaction slowly zooms in too (8%, under the headline or the
  formula).
Only ./deploy.sh is needed.
**How:** `batch.ts`: `BatchStep`, `usesSteps`, `cleanStepSeconds`, `stepWindow`, `filesOf`; `pickBatch` / `combos`
generalised to any number of product lists (keys unchanged for banks without steps), `MAX_COMBOS` 20,000, unlisted banks
remember 5,000 made, `spend` keeps step names. `StepOrder.tsx` (the sheet); `BatchView` (Set order button, step lists,
`add` to a step, `takeOutOfStep`, `saveOrder`); `store.ts` `MontageParts.bank.steps`, cleanup via `filesOf`;
`clipParts.writeWhole` `window`; `montageRender` `windows` (seeded per video) and `reactionFirst`; `pipeline.makeMontage`,
`CampaignApp` (clips, windows, names). Tests in `batch.test.ts`.

## Batch: every reaction slowly zooms in
**What:** (Reached only reaction videos made one at a time - batch videos got it in the next update.) Every reaction now has a slow zoom-in for its whole length -
the full frame at the start, 8% closer by the end, easing in and out. Only the video moves: the headline (or the
formula) stays still on top. Always on, whatever the angle's effects say; where the angle's own "Push-in under the
hook" is on and closer, that one shows. Green screen and the engine are as they were. Only ./deploy.sh is needed.
**How:** `effects.ts` `REACTION_ZOOM` / `reactionZoom` (+ test); `reactionRender.ts` takes the larger of it and the
angle's framing for the reaction stretch.

## Fix: no more click at every cut
**What:** every cut had a little click - the sound a video makes when it ends and starts. Now the sound fades out
over the last 8 thousandths of a second before each cut and back in over the first 8 after it: far too short to hear
as a fade, and the click is gone. The same where a video before / after / in the middle meets you, and where two
recordings are joined. Your music and pops/whooshes are untouched - they're laid over the finished video and play
straight through the cuts. Videos made from now on; ones already made keep their clicks (Edit again remakes one).
Only ./deploy.sh is needed.
**Why it clicked:** the sound is read in chunks of about 20 ms and each kept part took whole chunks - the one already
playing at its start and every one starting before its end - so at each cut the sound wave jumped from wherever one
part stopped to wherever the next started, and a few ms of the cut pause came along on each side.
**How:** `cutFades.ts` (+ test, which rebuilds a click from two joined chunks and checks it is gone): `cutEdges` (which
ends of each kept part are a cut - a gap, a video in the middle, the start and end of him; two parts with nothing
between them play on as one), `edgeGain` / `fadeAtCuts` (silent outside the part, 8 ms ramps inside it), `nearCut`
(only chunks at a cut are touched). `render.ts` fades his voice before the voice chain, the music and the sounds;
clip edges in `writeClip`; `joinRender.ts` at each join. The plain cutter is unchanged (rule 7).

## Captions: "Usual" sits a little lower
**What:** the Usual caption place is a little lower - its middle is now 66% of the way down the video instead of 63%
(about 58 pixels lower on a 1080x1920 video), still well above Bottom (80%) and TikTok's own caption. Every video
made from now on, and the caption preview, use it; videos already made don't change. Top, Middle and Bottom are as
they were. Only ./deploy.sh is needed.
**How:** `captions.ts` `CAPTION_Y` 0.63 -> 0.66 (+ test).

## End a campaign: its accounts come out of Postiz
**What:** a campaign's page (Campaigns, open it) has a new button under Stop all posts: **End campaign - free its
Postiz accounts**. For when a campaign is over, so its accounts stop counting toward your 30 in Postiz.
- Tapping it changes nothing yet: it shows what would happen - how many of its posts not out yet get stopped, which
  of its accounts come out of Postiz ("3 of your 28 connected accounts") and which stay, and why each one stays:
  another campaign posts to it, your friend's login uses it, another campaign's post is still due on it, a post went
  out on it in the last few hours, or Postiz holds posts on it that the Cutter didn't make. Then **End it and take
  out 3**, or Cancel.
- Ending stops all its posts at once and unticks those accounts from it; over the next few minutes the server takes
  its scheduled posts out of Postiz, then removes the accounts from Postiz. The page says "Taking 3 accounts out of
  Postiz..." and then what it did ("Taken out of Postiz: ...", anything kept and why, anything Postiz refused).
- **Removing means deleting from Postiz**: Postiz gives apps no way to just switch an account off (checked in Postiz's
  own code today). Videos already posted stay up on TikTok/Instagram/etc. To use an account again, add it in Postiz
  again (you log in to it there) - Postiz brings it back as the same account - and tick it in a campaign's Posting.
- An account kept for a reason that passes (a post still due, one just out, posts made in Postiz) stays ticked on the
  campaign, so ending it again later takes it out. Accounts a deleted campaign had ticked no longer hold anything.
- **Stop all posts** is unchanged (it only stops posts), so stopping a wrong batch never removes accounts.
Needs deploying: run ./deploy-server.sh, then ./deploy.sh.
**How:** `postiz/channels.ts` `endPlan` (pure, tested: which accounts may go and why the rest stay); `postiz/index.ts`
action `end-campaign` (no `confirm`: the preview; with `confirm`, the ids he was shown: `stopAll`, untick, a job in
the profile's `settings.ending`), `finishEnding` (after the request and on every tick: takes its stopped posts out of
Postiz, asks again, `DELETE /public/v1/integrations/:id`, retries when Postiz is busy, writes `settings.ended`,
re-ticks what stays for a reason that passes, refreshes the account list); `fake.ts` deletes a channel's posts.
Phone: `EndCampaign.tsx`, `posting.ts` `previewEndCampaign`/`endCampaign`, `CampaignsView`, `CampaignApp`.

## Settings tidied, dark mode finished
**What:**
- **Pause and daily limits** has its own page: Settings shows one row - "Pause and daily limits", saying what is paused
  or capped (or "Nothing paused, no daily limits") - and tapping it opens the list. There, each platform is one card:
  "All of TikTok" first, then each account (its @ name), each with its most-a-day number and a pause switch (orange
  when paused). Same settings as before, nothing changes in how they work.
- **Settings is shorter:** each section's rows sit together on one card with thin lines between them, like the
  iPhone's Settings (Posting, Default effects, Captions, Speech), instead of a card for every row. Default effects'
  three choices are one line each ("Punch-in at cuts ... Off"). Row names are in regular weight, as on the iPhone.
- **Dark mode:** the parts that were still drawn by the browser are finished - the limits' number boxes, the colour
  well, the angle's Look / Pictures / Sound / Effects / Clips switcher (now on its grey track), the sounds picker
  ("Your file..." on the same line), each effect on its own card, and numbers (-6 dB, 4.0 s) in the normal font
  instead of a code font.
Only ./deploy.sh is needed.
**How:** `PostingLimits.tsx`: `PostingLimitsRow` + `limitsLine` (+ `postingLimits.test.ts`) and the page
(`SettingsView` `limitsOpen`); `campaign.css`: `.limit-card`/`.limit-row`, `.card-group` (rows on one card, hairline
by a background gradient, `.field.inline` for a choice on one line), `.seg.parts` track over `--ink`, `.effect`
card, `input[type=color]`. Checked with screenshots in Chromium, light and dark, and a scan of every visible
control on Videos, Batch, Campaigns, Bank, Settings, the angle's five parts, New campaign and Posts for any left
with the browser's own look (none left).

## Batch 8: the engine - Ilyan's Le plateau on a server
**What:** big batches made on a server (Railway) instead of the phone, with Ilyan's engine: many videos from each
take, each a little different, never a near-copy, and the phone can be closed while it works.
- **Set up once:** the steps are in `engine/README.md` (a Railway project from this repo, a volume, an address).
  Then Settings, **Engine**: paste the address, **Connect** - it says how much room is left and whether Claude is on.
- **Use:** Batch tab, Layout **On the engine** (shows once the engine is connected). Add **Hooks - your face** (takes
  of 10-12 s; it cuts several hooks out of each), **Product clips**, **Headlines** (the words over the hook - Claude
  rewords them a little for each video) and **Songs** (each video gets the one this campaign used least, from its
  chorus). Pick the days as usual and tap Make: the phone sends what the engine doesn't have yet (once - after that,
  only new files), hands it the batch and is free.
- **Approving:** the videos arrive in Posts as a batch, each with its day and time, waiting for you - watch one, and
  if it's right, **Approve all**.
- The Batch tab shows how far it got (checked every 15 s), with **Stop** while it works and **Carry on** if it stopped
  (a restart, a failure) - nothing is posted twice. A video that would be too close to one already sent (last 30 days,
  90 for other campaigns) or to one in the batch is made again, up to three times, then skipped and counted.
- Rule change, OK'd by you: the bank's footage now leaves the phone - to the engine only, and only for this layout.
Needs deploying: run ./deploy-server.sh (the login function's new `whoami`), then ./deploy.sh.
**How:** `engine/` (Python 3.12 stdlib server + ffmpeg, Dockerfile, `railway.json`): `server.py` routes, `auth.py`
(token -> space via `cutter` `whoami`, cached 5 min), `uploads.py` (8 MB pieces), `series.py` (clips + settings ->
Le plateau `serie`), `jobs.py` (one batch at a time; keys `engine-<batch>-<n>`; token in memory only; `again`),
`guard.py` (dHash fingerprints every 0.5 s), `hooks.py` (Anthropic SDK 1.10.0, `claude-opus-5-5`, low effort, JSON
schema output, server-side fallback), `poster.py` (the phone's start / signed pieces / sent protocol to `postiz`).
`plateau/`: Ilyan's `remixer.py`, `sons.py`, `captions*.py` and TikTok Sans, unchanged (commit `f3c8678`), pointed at
`/data` by `plateau_paths.py`. Phone: `campaign/engine.ts` (+ test), `BatchView` layout `engine`, `SettingsView`
`EngineSetting`, `batch.ts` (`engineJob`). Tests: `engine/tests/test_engine.py` (14, with real renders and the real
SDK against a stand-in server). Checked here: renders are 1080x1920, 30 fps, about 15 Mbps.

## Batch 7: the look of Apple's own apps, light and dark, tips hidden
**What:**
- **Light and dark:** Settings, **Appearance**: Automatic (follows the phone), Light or Dark. Colours are Apple's own -
  grey ground, white (or dark grey) cards, system blue for the thing to do next, green / orange / red for done /
  look at this / failed - in both.
- **Tidier:** each section sits on its own rounded card; the switches are the iPhone's (Cut only / Campaign videos,
  every segmented choice, and on/off switches on the right instead of tick boxes); buttons are filled blue for the
  main one and light blue for the rest; links are plain blue; the tab bar is see-through like iOS; section names are
  small grey capitals like the iPhone's Settings; the Bank tab has one big title.
- **Tips off:** the explanations under settings and buttons (41 of them) are hidden unless **Show tips** is on in
  Settings, Appearance. Anything that says what is happening - warnings, "not synced", what is missing, progress -
  always shows.
- One thing that can't follow the theme: the iPhone's own status bar at the very top of the home-screen app stays
  black (it is set when the app is added to the Home Screen; changing it means re-adding the app, which can lose
  videos not yet sent).
Only ./deploy.sh is needed.
**How:** `theme.ts` (+ test): `data-theme` and `tips-on` on the page, set before the first paint in both `main.tsx`;
`index.css` tokens for dark (`:root`) and light (`prefers-color-scheme` / `data-theme='light'`), plus `--accent`,
`--field`, `--seg-track`, `--seg-on`, `--bar-bg`; an "Apple's own apps" block at the end of `index.css`,
`campaign.css` and `modes.css`; hard-coded colours replaced with tokens (`color-mix`). Explanations carry the class
`tip`. Checked with screenshots in light and dark in Chromium.

## Batch 6: green screen reactions
**What:** the Batch tab has a new **Layout**: **Reaction, then video** (as before) or **Green screen**. In green
screen, each video is the brief's video playing full screen with its own sound, and you, cut out of your background
(no box), reacting in a bottom corner - like TikTok's green screen effect. The video lasts as long as the background
video; a reaction shorter than that starts over, so film reactions as long as the backgrounds (up to a minute).
- **Reactions** are your clips; **Background videos** are the brief's (the product list, renamed in this layout).
- **Your corner:** Bottom left or Bottom right, and Size (25-50% of the width, 38% to start).
- **Headlines** are optional - none, and there's no headline. No music: the background's sound is the sound.
- Cutting you out happens **once per reaction**, the first time a video uses it ("Cutting you out - once per
  reaction" on the batch row), and is kept on the phone; every later video with that reaction reuses it. Taking a
  reaction out of the bank deletes its cut-out too.
- The first time, the phone downloads the cut-out tool (about 12 MB, from jsdelivr like the speech model).
Only ./deploy.sh is needed (it installs the new add-on).
**How:** new dependency `@mediapipe/tasks-vision` 1.0.1 (OK'd by the owner), its selfie segmenter model in
`public/models/selfie_segmenter.tflite` (250 KB), its engine fetched from jsdelivr at that version. `cutout.ts`
(`makeCutout`): every frame (at most 30 a second) at 540x960, mask steadied frame to frame and its edge softened,
kept as one MP4 with his frame on top and the mask under it; `store.ts` `saveCutout`/`loadCutout` (pieces in
`clipParts`, under the reaction's bank id, `CUTOUT_VERSION`). `greenScreenRender.ts` (`renderGreenScreen`,
`cornerBox`): background covers the frame, the mask half made see-through (`greyToAlpha`) and him drawn through it,
background sound to -14 LUFS under a limiter. `batch.ts` (`layout`, `corner`, `mixFrom`), `BatchView.tsx`,
`pipeline.makeGreenScreen`, `CampaignApp` (phase `cutout`). Tests: `greenScreen.test.ts`. The segmenter was run in
headless Chromium here (GPU, a 540x960 mask per frame); how well it cuts out a real person is checked on the phone.

## Batch 5: a video in the middle, when you say its words
**What:** an angle can now have **videos in the middle**: in the angle's **Clips** tab, tap **+ Video in the
middle**, type the words ("I'm going to show you how") and choose the clip. In every video of that angle where you
say those words, the clip plays right after them - whole, with its own sound, filling the frame - and then you carry
on. Not over you like a pop-up: in the timeline, so the video gets longer by the clip. If there's a short pause just
after the words, it goes in the pause; otherwise straight after the last word.
- The words are matched in what is kept of the take, whatever the case or punctuation; a phrase of four words or
  more may have one word misheard (never the first or last).
- Each video's Add list (on its row and on the edit screen) shows the angle's videos in the middle and says when a
  video doesn't say the words; untick **In this video** to leave them off that one.
- The finished row says "0:12 video in the middle", or that the words weren't said.
- Captions, pictures, sounds and music after the clip all move on with it; the music keeps playing under it.
- Not in the edit screen's preview yet - it plays your take; the clip is put in when the video is made.
Only ./deploy.sh is needed.
**How:** `cueClips.ts` (+ test): `findPhrase`, `placeCues` splits the cut where a clip goes (or uses the pause
within 0.35 s); `render.ts` `inserts` writes each clip with `writeClip` after its kept part, so every
`MomentPlacer` after it gets the new shift; `pipeline.make` places them (captions, else the words heard);
`clips.ts` `AngleClips.cues` (kept on this phone, counted as used); `JobClips.cues: 'none'` per video;
`ClipRow` takes a title and the phrase box; `ClipsField` shows the lines.

## Batch 4: cuts and captions on one page
**What:** a video's cuts and its captions are now one screen: the video at the top with the captions drawn on it,
the cuts timeline right under it (Split, Delete, Undo, + Picture as before), then the caption phrases, the look
settings and **Approve**. No more going back and forth between Cuts and Captions.
- **Play** plays only the kept parts, with the captions popping in - exactly the video that will be made.
- Tapping a phrase moves the timeline to it; its play button plays from there. While it plays, the phrase being
  said is lit and the list follows.
- Change a cut and, a moment later, the captions follow: words in a part you cut go, words in a part you bring
  back come back, and what you typed stays.
- **Cuts** on a video's row and **Check** both open this screen. The headline question before checking captions
  is unchanged. With captions off in Settings, Cuts opens the cuts alone as before.
Only ./deploy.sh is needed.
**How:** `EditScreen.tsx` (+ `editScreen.test.tsx`) puts `CaptionReview` (`embedded`: no video of its own) under
`CutsEditor` (`below`), draws the captions over its video (`paintOver`) and drives it through `CutsControl`
(seek, playFrom, repaint, subscribe). Cut changes settle `SETTLE_MS` (0.4 s) before `CampaignApp.followCuts`
applies them; `captions.withRestored` (+ test) brings back the words of a part put back; `keepEdit` keeps cuts and
captions together. `usePopStills`/`paintPopBox` shared from `CaptionReview` for the pop-up box.

## Batch 3: phone storage freed, the picker waits longer, fewer false crash reports
**What:**
- **Storage:** every sent video used to keep a copy on the phone until its post went out - a 120-video batch posting
  a few a day kept all 120 for weeks (one phone had 106 GB of Cutter storage the day a video stalled). Now the
  phone's copy goes as soon as Postiz has the video (scheduled). Watch, Save video and Add music then play Postiz's
  copy. Videos still waiting for you keep theirs, so they play at once with no signal. A full phone is what stops the
  iPhone handing picked videos over and gets the page restarted mid-video, so this should help both. Copies already
  there go the next time Posts is opened.
- **The picker:** most "nothing arrived" picks were slow, not lost - the video was made a minute or a few later. At
  15 s it now says "Your iPhone is still preparing the video" (and how to skip the wait: Format → Current) and only
  says it didn't come after 2 minutes. A late video is reported with how late it was.
- **Reports:** "EmptyRanges" and "Script error." (46 in three weeks) are Safari's own - in none of the app's code or
  libraries - and are no longer reported as app crashes. Once a day the phone sends a storage report (what is kept,
  counts and sizes only) so what is left can be found.
- **Stalls:** most came from 4K videos on builds before 2026-10-15 18:58; videos are 1080p since, and the stall
  watchdog already retries a stuck video. None since - watching the reports.
Only ./deploy.sh is needed.
**How:** `outbox.ts` (`copyDone`, used by `tidySends`; `sendsHeld`), `store.ts` (`storedCounts`),
`storageReport.ts` (kind `check`, phase `storage`, once a day, a minute after opening), `pickWatch.ts`
(`ARRIVE_MS` notice, `GIVE_UP_MS` 120 s, late pick reported as `check`/`pick`), `report.ts` (`safarisOwn`).
Tests: `copyDone.test.ts`, `pickWatch.test.ts`, `report.test.ts`.

## Batch 2: captions keep their first word
**What:** the first word of the captions (and sometimes the last) no longer goes missing, so it doesn't have to be
typed back in. Three causes, all fixed:
- **The headline cut the first phrase in half.** Captions start once the headline has gone - at that exact second,
  even mid-sentence, so "This app changed my life" came out as "app changed my life". Now captions start with a
  whole phrase: one mostly said after the headline is captioned whole (its first word can show as the headline
  goes), one mostly said under it is left out whole.
- **A soft first sound** ("so", "hey", "for") sits under the line the pauses are found with, so the kept stretch
  started a moment after the word and the word was dropped. A word whose sound runs on into the stretch is now kept.
- **The speech model missed the first or last word** of a take that starts the moment you talk or stops the moment
  you finish. Each stretch is now heard with half a second of quiet either side.
And when a word still has to be typed back, Approve sends a "check" report saying whether the speech model heard it
- so a next fix goes to the right step.
Only ./deploy.sh is needed.
**How:** `captions.ts` (`captionedIndices` works on `phrasesOf`, majority after the headline; `captionWords`
keeps a word starting up to 0.6 s before a stretch when 50 ms of it is inside, never an "um" or a repeat),
`timedWords.ts` (`padWithQuiet`, `keepInWindow`) used by `campaign/transcribe.worker.ts` only (the plain cutter's
worker is unchanged), `captionFixes.ts` (`typedBack`) reported from `CampaignApp` on Approve (kind `check`, phase
`captions`). Tests for each.

## Batch 1: post one now and one later, one-tap music, Reaction video, and a retry for missed accounts
**What:**
- **New post, One by one:** with two or more videos there is now **One by one** next to Spread them / All now.
  Each video then gets its own **Now** or **At a time** - one can go now and the other at 6 PM.
- **Add music** in Posts is just the song (with a play button) and one button: **Add music & approve** on a post
  waiting for you, **Add music** on one already approved or scheduled - it stays approved, no second approval. A
  post on "Approve, post later" or waiting for a brand still waits for you or the brand. The level is always
  Normal; songs come from the Bank (the "from my phone" picker is gone).
- **"Choose the campaign myself" is gone.** Videos are always sorted into their campaign. Reaction videos have
  their own **Reaction video** button under the drop zone (only when a campaign makes reaction videos).
- **A video that missed an account** (Posted, but "Not posted to Jake") now says so in orange on its row, with
  **Post again to the missing ones**: only the accounts that failed get it, a few minutes later, with the same
  video and caption. A video that failed everywhere gets **Post again**.
- Two accounts with the same name ("Ilyan Hamdane" on YouTube and on Instagram) now keep a link each, and a
  failure names the platform: "Not posted to Ilyan Hamdane (Instagram)."
**Needs deploying: run ./deploy-server.sh** (the retry, the music approval and the account names are on the
server), then ./deploy.sh.
**How:** `NewPost.tsx` (`each`, per-video `when`/`at`, `timeOf`); `MusicAfter.tsx`, `musicAfterSend.ts`
(`carry.approve`) and `postiz/index.ts start` (a carried post with `approve` gets `approval: 'direct'`, never past
a brand); `CampaignApp.tsx` (mode `one` lists reaction campaigns only); `postiz/failed.ts` (+ test) and the new
`retry-accounts` action (`retryAccounts`: asks Postiz which of the post's Postiz posts are in error, posts again
to those accounts only, drops the failed ids so they don't count again); `PostsView.tsx` (+ test).

## Posting: made to Instagram's and TikTok's own spec, and quiet songs turned up
**What:** posted videos looked soft on Instagram and TikTok while the preview looked fine - the file sent is the
preview, unchanged, so the softening happened at the platforms. Instagram's API takes nothing wider than 1920 px or
over 25 Mbps and wants the file's index ("moov") at the front; 4K files at up to 45 Mbps, with the index at the
end, were outside all three, so they were shrunk and re-compressed hard on the way in. Now every video is made at
1080x1920 at its own frame rate, at most 20 Mbps (about 16 for 60 fps), with its index at the front - what both
platforms ask for, and they show 1080p anyway.
Batch songs: a quiet song used to be left quiet ("never turned up"), so some batch videos had music you could
barely hear and no error. Now every song is set to the same level - loud ones brought down, quiet ones up (24 dB at
most), its peaks under the limiter so it never clips.
**How:** `makeSize` (quality.ts) is 1080 on the shorter side and the bitrate capped at `MAX_BITRATE`; the 4K and
"second go in 1080p" paths are gone. `moovToFront` (media/fastStart.ts) moves the index to the front of every
finished file the way qt-faststart does - the media data is sliced, never copied into memory - and gives the file
back unchanged if anything looks wrong; mediabunny's own `fastStart: 'reserve'` was tried and fails an assertion on
B-frame video. Checked with ffmpeg on 1080p60 files with and without B-frames, sound and none, and one written by
mediabunny: every frame and sample identical, index first. `liftMusic` (montageRender.ts) uses the voice's Limiter.

## Music: every song in a big batch gets heard
**What:** in a long batch (90, then 120 videos) only a couple of songs were coming through. The batch picks songs
evenly - checked with the real picker over 90 and a stacked 120 - so the songs were being lost when each video was
made: every video decoded its *whole* song into memory (a three-minute track is about 70 MB as samples, copied
again on the way), and with 4K frames in memory too the phone could not always manage it. A song that failed went
out silent ("Made without the music"); on a talking video, with no word at all. Now only the part of the song the
video uses is decoded - about 20 seconds instead of three minutes - and any song that still fails is reported, with
its type and size, so it can be seen and fixed.
**How:** `prepareMusic` (sounds.ts) reads just the song's first seconds with mediabunny and has the browser
resample them; a song the phone can't read that way is decoded whole, as before. Used by talking, reaction, batch
and add-music videos. Checked in Chromium with a three-minute MP3 and WAV: 21 s decoded, 440 Hz kept through the
44.1 to 48 kHz resample.

## Colour: the file says what the video really is, so no app adds contrast
**What:** made videos should no longer look like a harsh-contrast filter went over them once posted. The first
colour report showed why: his take was ordinary limited-range BT.709 (what every phone records), but Safari's
encoder labels what it writes as sRGB, *full* range - and that label went into the MP4. Apps that trust the label
and apps that trust the video stream then show different black and white levels. Now the label is set from what the
H.264 stream itself says, so every player - TikTok, Instagram, Postiz, Photos - reads the same levels. Applies to
talking, reaction, batch and joined videos and the plain cutter. The colour report now also says what the stream
says and what was finally tagged.
**How:** `avcColour.ts` reads the SPS's video signal type (range, primaries, curve, matrix) from the encoder's avcC,
or from the first packet; `matchStreamColour` (colourCheck.ts) writes it onto the encoder metadata in
`onEncodedPacket`, the same object mediabunny then muxes into the `colr` box. A stream that says nothing gets
H.264's own default, limited BT.709. Checked against real x264 streams in both ranges.

## Colour check: each made video reports what happened to its colour
**What:** nothing he sees changes. Each talking video now sends one "check" report saying how the camera recorded
it (HDR or not, and its colour tags), what the decoder handed over, and how the encoder wrote it. Asked for because
posted videos looked like a harsh-contrast filter had gone over them; an iPhone films in HDR by default, and every
campaign video is drawn onto a canvas, where Safari turns HDR into ordinary colour - the likely culprit. The report
shows which step does it, so the fix goes in the right place. Never the video itself, only these tags.
**How:** `colourCheck.ts`, hooked into `render.ts` through the encoder's `onEncodedPacket`; sent once per video.

## Quality: a 4K 60 fps take comes out 4K 60 fps
**What:** videos keep their own resolution up to 4K, their own frame rate, and a bitrate close to what the phone's
camera records at - about 16 Mbps for 1080p60 and 45 Mbps for 4K60. Before, every video was brought down to 1080p
and encoded at about 6 Mbps (the reports showed "avc1.640028 … 6111000 bps"), which is where the softness came from.
Applies to talking videos, reactions, batch videos and joined recordings. 4K is four times the pixels, so making
takes longer and files are bigger. If the phone's encoder can't do 4K, or a first go fails, that video is made in
1080p - still at the higher bitrate - rather than not at all.
Only ./deploy.sh is needed.
Files: `quality.ts` (+ test), `overlay.ts` (`outputSize` cap), `framing916.ts`, `render.ts`, `reactionRender.ts`,
`montageRender.ts`, `joinRender.ts`, `pipeline.ts`, `CampaignApp.tsx`.

## A video with no campaign: edit it again, or give it one, and send it
**What:** a finished video that went nowhere - no campaign recognised in it (General), or its campaign posts nowhere
yet - now says so on its row in Videos, with **Edit again and pick its campaign** (back in the list with its cuts,
captions and headline; pick the campaign, approve, and it's made again with that campaign's look and sent) and **Or
send it as it is to [campaign]** (only campaigns that post somewhere; sent unchanged under that campaign's posting
rules - approve it in Posts). Its recording is now kept for 7 days instead of 2 hours (the newest 10 such videos), and
after the app restarts they're listed under **Made, not sent** with Edit again and Remove.
Only ./deploy.sh is needed.
Files: `store.ts` (`unsent`, `UNSENT_KEEP_MS`, `madeNotSent`, `markJobSent`), `CampaignApp.tsx`, `JobRow.tsx`
(+ `jobRowNowhere.test.tsx`).

## Batch: a new batch on top of the running one, to post more a day
**What:** while a campaign's batch is still running, a new batch for it no longer has to wait until the last one
ends. Under **Posting** on the Batch tab, pick **On top - from today** (the default) or **After {the day after the last
one}**. On top, "Videos a day" becomes **More a day**: running 3 a day and adding 2 makes 5 a day while both run,
from today (or tomorrow if today's times have gone). The line under it says so - "3 already on Wed Oct 14 + 2 = 5
that day". The new videos' times keep 20 minutes clear of the ones already scheduled (closer, never under 10, on a
crowded day), all inside 11 AM - 6 PM. Every video is still a different one, approved in Posts as before. To scale
up step by step, make another small batch on top when you're ready.
Only ./deploy.sh is needed.
Files: `batch.ts` (`stack`, `lastPerDay`), `posting.ts` (`stackTimesOn`, `takenTimes`, + test), `BatchView.tsx`
(+ test).

## Background music: heard, still under the voice
**What:** background music is louder. **Background** now sits about 12 dB under your voice while you talk (it was
about 19 - inaudible on a phone), **Quieter** about 17. Your voice is always in front. Applies to every talking video
with music: an angle's music, a bank song picked for a video, reaction videos and Add music in Posts.
**Why it was so quiet:** the music dipped 5 dB more "while you talk, back up in the pauses" - but the pauses are cut
out, so it was dipped the whole video, on top of sitting 14 LU under you. Now 9 LU under, dipping 3 dB.
Only ./deploy.sh is needed.
Files: `music.ts` (+ test).

## Headlines: centred on what is drawn, not what is measured
**What:** a headline is now centred - and its white box sized - on the letters as the phone actually draws them.
It used to be centred on the width the phone measured, and nearly every headline ends in emoji, which an iPhone can
draw at a different width than it measures; that left the words off to one side and the box longer on one side.
Each line is drawn once off-screen before the video is made and its visible edges found, so whatever the emoji do,
the words sit in the middle. Plain-text headlines move by a pixel or two at most. Batch hooks (Claude + X) too.
Only ./deploy.sh is needed.
Files: `overlay.ts` (`inkOf`, `inkColumns`, + test).

## Pop-up videos: a clip comes up when you say its words
**What:** a new **Videos** section in the Bank tab, between Pictures and Music. Add a clip (screen recording, demo,
anything), type the words that bring it up - "Claude Code" - and in every angle that uses the bank, saying those words
pops the clip up over you: muted, in a big box (65% of the width by default, at the clip's own shape, never more
than three quarters of the height), with rounded corners and the same spring as the pictures, playing to its end. A
new mention takes over from one still playing. On the caption check before a video is made, a **Pop-up videos**
group lists the clips that take says and when, with a tick to leave one out, a **Size** slider (40-90%) and
**Top / Middle / Bottom** - the frame above shows the clip's still in the box as it will sit. Each video keeps its
own setting. A clip the phone can't play mid-make is left out and the video is still made.
Only ./deploy.sh is needed.
Files: `videoBank.ts` (+ test), `VideoBankView.tsx`, `popVideo.ts` (+ test), `look.ts`, `moments.ts` (+ test),
`pipeline.ts`, `render.ts`, `CaptionReview.tsx` (+ `captionReviewPops.test.tsx`), `CampaignApp.tsx`, `jobs.ts`,
`store.ts`, `sort.ts`, `campaign.css`.
**Underneath:** each clip is read already shrunk to its box (mediabunny `CanvasSink`), one decoder at a time,
opened when it comes up and closed when it ends, so a 4K clip costs no more than a small one.

## Music bank: songs with names, heard before they are picked
**What:** the Pictures tab is now **Bank**, with a **Music** section. Add MP3s, M4As or videos - from a video only
its sound is kept. Tap a song's name to rename it ("random text" → "Sad piano") and ▶ to hear it. Every music picker
lists the bank by name with a ▶ for the one picked: a video's Music before it is made, Edit on a batch video, Add
music in Posts, an angle's Background music (whose name can now be changed too), and Batch → Music ("From the music
bank", as a copy). One track plays at a time.
Only ./deploy.sh is needed.
Files: `musicBank.ts` (+ test), `MusicBankView.tsx` (+ test), `TrackPlayer.tsx` (`PlayButton`), `JobRow.tsx`,
`BatchEdit.tsx`, `MusicAfter.tsx`, `MusicRow.tsx`, `BatchView.tsx`, `CampaignApp.tsx`, `TabBar.tsx`.

## Captions: the last word no longer goes missing
**What:** the letter model that times each word had failed on 13 videos in two weeks, and those fell back to rough
times that lost the last word of a phrase. Now it gets 2.5 minutes to load and a second go after any failure; on
rough times a word up to 0.5 s into a cut pause goes back into its phrase (the take's last words, up to 1 s); the
last words always fit inside the video; and a word the speech model gives no time is kept.
Only ./deploy.sh is needed.
Files: `captions.ts` (+ test), `plan.ts`, `timedWords.ts` (+ test), `transcribe.worker.ts`, `pipeline.ts`,
`CampaignApp.tsx`.

## Posting: in the middle of the day, not at night
**What:** posts go out between 11 AM and 6 PM. Your own times outside that are skipped (greyed in Posting); a
campaign whose times were all at night posts as many a day at random inside it; a saved window is cut to it. A video
for today that comes in late spreads to 6 PM, or three hours after it comes in when later, never past midnight. A
post held to another day goes between noon and 2 PM. A post not yet in Postiz holding a night slot is re-timed when
it is sent; Unschedule → Approve re-times one already there.
./deploy.sh (it deploys the server too).
Files: `window.ts`, `slots.ts`, `batch.ts`, `postiz/index.ts` (+ tests), `posting.ts`, `PostingEditor.tsx`,
`NewPost.tsx`, `BatchView.tsx`, `CampaignApp.tsx`.

## Posts: a blue ticking clock on scheduled posts
**What:** on the Posts screen, a post waiting in Postiz for its time now shows a blue clock whose hand ticks round,
instead of the grey dot, and its time is blue too - so what's scheduled reads at a glance. A folded batch whose
videos are all scheduled gets the clock as well. Posted, waiting-for-approval and failed posts keep their dots, and
a post whose time has just come (going out now) loses the clock. The hand stays still if the phone is set to reduce
motion.
Only ./deploy.sh is needed.
Files: `icons.tsx` (`ScheduledIcon`), `PostsView.tsx` (+ test), `campaign.css`, `index.css`.

## A third caption style: Phrase
**What:** the plainest captions, for brands that want nothing busy. In the caption check before a video is made, the
style choice now has **One word**, **Highlight** and **Phrase**. Phrase shows the whole phrase as you start saying it
and swaps to the next when you move on - white with a black outline exactly like the TikTok headline, all
lowercase, a little smaller than a headline, two lines at most. No lit word, no pop, no shadow. Phrases break where
you stop or pause, up to seven words. Your pick is remembered for the next videos, as before; the caption position
and size settings work the same.
Only ./deploy.sh is needed.
Files: `captions.ts` (+ test), `render.ts`, `reactionRender.ts`, `CaptionReview.tsx`.

## Batch: the "Claude + X = $ a day" hook
**What:** a second kind of hook for batch videos. On the Batch tab, under **Hook**, pick **Claude + X** instead of
Headlines. Pick a **left logo** (e.g. Claude) and a **right logo** (e.g. OpenArt) once, and the range of the amount
(default $500 to $1,000). Every video in the batch then shows, over the reaction:

    [left logo]   +   [right logo]

          $650 a day

- the same two logos on every video, and its own amount, in steps of $50, with the ending varied ("a day", "/day",
  "per day", "daily");
- no other headline;
- a slow, strong push into your face for the whole reaction - a fifth closer by the cut - then the product clip,
  music and scheduling as before.
A small preview under the settings shows exactly how it sits on the video. The left logo is remembered for other
campaigns' batches, so you set Claude once. The caption Claude writes is told what the hook says ("Claude + OpenArt =
$650 a day").
**How:** `batch.ts` (`formulaLine`, `formulaText`, `hookOf`), `formulaOverlay.ts` (layout, drawing, the push),
`montageRender.ts` draws it on the reaction; the logos are kept in the batch bank like the clips.
**Checked:** unit tests for the amounts, layout and push; frames drawn in Chromium with the render's own functions.
Not an encoded video - this test browser can't write H.264 - so check the first batch on the phone.
Only ./deploy.sh is needed.
Files: `batch.ts`, `formulaOverlay.ts` (+ test), `FormulaPreview.tsx`, `BatchView.tsx` (+ test), `montageRender.ts`,
`pipeline.ts`, `store.ts`, `CampaignApp.tsx`, `campaign.css`.

## Fix: the server half of a deploy failing without anyone noticing
**What was wrong:** every server change since Oct 6 - Stop, random times everywhere, Approve post later, Add missing
hashtags - never reached the server. The posting function was still the Oct 6 version, because ./deploy-server.sh
kept failing at the Supabase login after ./deploy.sh had already put the new app live. So the new buttons showed up
and then said "run ./deploy-server.sh".
**Now:** ./deploy.sh does both. When the server code changed it runs ./deploy-server.sh itself, which asks for a
Supabase token (supabase.com/dashboard/account/tokens) instead of using the Mac's keychain, and offers to keep it in
~/.supabase-token so it never asks again. If the server part fails, it ends in red with "THE SERVER WAS NOT UPDATED"
instead of "Done". A bad or expired kept token says to delete ~/.supabase-token and try again.
Files: `deploy.sh`, `deploy-server.sh`.

## Redo captions now adds the missing hashtags by default
**What:** "Redo captions" rewrote every caption with Claude. Now the main choice keeps every caption word for word and
only adds the campaign's hashtags it is missing - for a whole batch or campaign at once, never one post at a time.
- **A batch:** on Posts, each batch row has **Add missing hashtags** (one confirm, every post in it). "Rewrite
  captions" is still there as a small second link.
- **A campaign:** in its Posting, "Add the hashtags to posts already made" (ticks itself when you change the
  hashtags; tick it yourself if you changed them earlier), then Save posting. When the rules text changed too, a
  second tick lets Claude rewrite them instead.
Scheduled posts keep their times: a post whose caption changes is taken out of Postiz and put back at the same
time; one that already has every hashtag isn't touched at all. Ones going out in the next 15 minutes are left as they
are. Pasted tracking captions never get hashtags, as before.
**Needs:** ./deploy.sh and ./deploy-server.sh.
Files: `postiz/index.ts`, `postiz/recaption.ts` (+ test), `posting.ts`, `PostsView.tsx` (+ test),
`PostingEditor.tsx` (+ test), `CampaignApp.tsx`.

## Redo captions after changing a campaign's caption rules
**What:** captions already written - waiting, held for later, or scheduled in Postiz - can be written again with the
campaign's rules and hashtags as they are now. Two ways:
- **A whole campaign:** Campaigns, the campaign, Posting. Under the caption rules there is now "Redo the captions
  already made" with how many posts it reaches. It ticks itself when you change the rules or hashtags; tick it
  yourself if you changed them earlier (like the hashtag you just added), then Save posting.
- **One batch:** on the Posts screen each batch row has **Redo captions**.
Scheduled posts stay at their times: each is taken out of Postiz only after its new caption is written, then goes
back at the same time. Ones going out in the next 15 minutes keep their old caption. Pasted (tracking) captions and
captions you wrote for a New post are kept word for word - only the hashtags are added. Posts show "Rewriting the
caption…" while it happens; 100 posts take several minutes. If a caption can't be written (no Anthropic key, Claude
down) the post keeps its old one and says so.
**Needs:** ./deploy.sh and ./deploy-server.sh. No database change.
Files: `postiz/recaption.ts` (+ test), `postiz/index.ts` (`recaption`, `rewriteMarked`), `posting.ts`,
`PostingEditor.tsx` (+ test), `PostsView.tsx` (+ test), `CampaignApp.tsx`.

## Approve, post later
**What:** next to Approve on each post waiting for you there is now **Approve, post later**. It approves the caption
but sends nothing to Postiz: the post moves to a new **Ready to post** list, where Save video works as long as you
like. Tap **Post** there when you want it to go - at its time if that is still ahead, otherwise at the next free time
(or straight away). Ready posts don't count as "posts to approve" in notifications or in Approve all, and the caption
can still be changed. Taking a scheduled post back puts it under To approve again, not Ready.
**Needs:** a new column on the server (`ready_at`, migration `20261010120000_cutter_posts_ready.sql`) and both
deploys - ./deploy.sh and ./deploy-server.sh. Until the server is updated the button says so instead of failing
silently.
Files: `postiz/index.ts` (`ready` action), `posting.ts`, `PostsView.tsx` (+ test), migration.

## Posts: filter by campaign, batches folded into one row
**What:** the Posts screen got long - a batch of 25 a day for a week filled the whole page. Now:
- **Filter:** chips at the top - "All 180", "Polsia 150", "Inflow 30" - show one campaign at a time. The phone
  remembers the last one picked. It applies to every list on the screen (To approve, On the way, Failed, Scheduled,
  Posted), and "Approve all" then approves that campaign's only.
- **Batches folded:** each batch is one row - "Polsia · 25 videos", its days and when the next one goes. Tap it to
  open the posts inside, tap again to fold it. Single videos still show one by one.
- **Posted** shows the latest 10, with "Show all" for the rest. Scheduled and Posted show their count in the title.
Only ./deploy.sh is needed.
Files: `PostsView.tsx` (+ `postsView.test.tsx`), `postsList.ts` (+ test), `campaign.css`.

## Fix: Batch made twice on a double tap, and only 1 or 3 videos a day (now up to 25)
**What was wrong:** tapping "Make 6 videos" twice quickly could make the whole batch twice - the button stayed live,
and a second tap before the screen caught up planned the same days again. And "Videos a day" only offered as many as
the campaign had times: 1 for a campaign with one time of its own, 1-3 for a random one.
**Now:** the first tap locks the button at once; it reads "Making…", then "Making 3 of 6…" while that campaign's
batch is made, and can't be tapped again until it's done. Afterwards it names the days the next batch would cover
("Make 6 more videos - Wed Oct 14 to Fri Oct 16"), so a second batch is clearly a different one.
"Videos a day" is now a − / + counter from 1 to 25. A random campaign draws that many random times from its window,
different each day. A campaign on its own times keeps them and, when you want more videos than it has times, adds
random ones from the window, clear of yours. Times are half an hour apart when the window has room and closer when
you want more (25 in 10 AM - 10 PM is about 29 minutes apart), never under 10 minutes; a window too short for the
count says how many it fits, in amber. The hint under it lists today's times. Posts-a-day limits you set in Settings
still apply on top: posts over a limit are held for the next day with room.
Only ./deploy.sh is needed - the server already posts a batch video at the time it was made for.
Files: `BatchView.tsx` (+ `batchView.test.tsx`), `posting.ts` (`batchTimesOn`, + test).

## Random posting times in every campaign, and late videos at random until midnight
**What:** every campaign now posts at a different random time each day. A campaign with no times of its own used to
post each video the moment it was ready; now it posts 3 a day at random between 10 AM and 10 PM. Each campaign keeps
its own window: change it in Campaigns, the campaign, Posting (it opens on Random times). Campaigns where you set your
own times keep them until you switch them: Settings, Posting, "Random times for every campaign", Switch all. That
gives each of them random times, keeping any window it already had, and leaves its accounts alone.
A video that comes in late - say 10 PM, after the day's times have gone - now gets a random time between 20 minutes
after it arrived and midnight, at least 15 minutes from any other, instead of the evenly spaced spread. The same goes
for extra videos beyond the day's times. Batch videos are made ahead and keep taking each day's random times from
the window, as before.
**How:** `window.ts` has `DEFAULT_WINDOW` (10:00-22:00, 3 a day); the server's `timesFor` and the phone's
`placeTimesOn` fall back to it, so the phone shows the same times the server will use. `spreadDay` (`slots.ts`) now
draws each late video's time from its post id, so a video keeps its time when another late one arrives, and videos
already in Postiz never move.
**Needs deploying:** both - `./deploy.sh` for the phone and `./deploy-server.sh` for the late-video times and the
default window on the server.
Files: `window.ts`, `slots.ts` (+ tests), `index.ts`, `posting.ts` (+ test), `PostingEditor.tsx` (+ test),
`SettingsView.tsx`, `CampaignApp.tsx`, `NewPost.tsx`, `BatchView.tsx`.

## Fix: the tab bar drifting with the scroll (third try - the cause, not the symptom)
**What:** the bar - Videos, Batch, Campaigns, Pictures, Settings - still followed the scroll instead of staying on
the bottom of the phone. The earlier fixes worked around an iOS 26 bug (WebKit 301108) that only happens in a Home
Screen app whose status bar is see-through; this one removes what sets it off: the status bar (time, battery) is
now plain black instead of see-through. On this black app it looks the same. The page also no longer rubber-bands
past its top and bottom, which made the bar look like it was moving.
**If it still drifts after ./deploy.sh:** iOS can keep the old status bar setting from when the app was added to
the Home Screen - delete the Cutter icon and add it again from Safari (Share, Add to Home Screen). Nothing on the
phone is lost: videos and settings are kept by the site, not the icon.
**Checked:** builds; not on an iPhone - only your phone can show it.
Files: `campaign.html`, `index.html`, `campaign.css`.

## Fix: Stop N posts did nothing
**What was wrong:** pressing the red Stop button spun for a moment and then nothing changed - the posts stayed
scheduled. The posting function on the server is still the one from Oct 6 (./deploy-server.sh hasn't run since),
which doesn't know the new "stop these posts" request, so it refused it - and the picker showed that refusal under
the long list of posts, out of sight.
**Now:** with a server that hasn't been updated, the phone stops the posts itself, one by one, using the same Reject
the button on each post has always used (it takes a scheduled post out of Postiz). Three at a time, soonest first, so
the next one due is stopped first; the button counts "Stopping 23 of 73…". Any that won't stop stay ticked with the
reason, and pressing Stop again retries just those. Problems now show at the top of the picker. Once
./deploy-server.sh has run, the faster all-at-once stop is used instead, automatically. The campaign screen's "Stop
all posts" button falls back the same way.
Only ./deploy.sh is needed for this.
Files: `posting.ts` (`stopPostsNow`, + test), `StopPicker.tsx` (+ test), `CampaignApp.tsx`.

## New: select posts on the Posts screen and stop them in one go
**What:** the Posts screen has a **Select** button. It lists every post that can still be stopped (to approve, on
the way, scheduled), with a chip per campaign - "Inflow 64", "Vertus 12" - that ticks all of that campaign's posts in
one tap, and **All**. Tick or untick any post by hand, then **Stop N posts**. They stop at once and none of them goes
out; the ones in Postiz are taken out of it in the background over the next few minutes. Posts already out, failed,
or past their time aren't in the list.
**How it works:** a `stop-posts { ids }` action on the posting function - the same stop as "Stop all [campaign]
posts", for the ticked posts (your own only, up to 500 at a time).
**Needs deploying: run ./deploy-server.sh** (and ./deploy.sh for the screen).
Files: `StopPicker.tsx` (+ test), `PostsView.tsx`, `posting.ts`, `postiz/index.ts`, `index.css`, `campaign.css`.

## New: Highlight captions - the phrase at once, the word being said in yellow
**What:** a second caption style. Instead of one word at a time, the phrase (up to 4 words, on one or two lines)
is on screen together, white with the usual dark edge, and the word being said turns yellow with a small pop. It
keeps every timing of the one-word captions: the same lead, hold, words taken out and no captions under the hook.
**How to use it:** on a video's captions screen, under Top/Middle/Usual/Bottom: **One word / Highlight**. The
preview changes at once. Whichever you pick last is where new videos start; size and position work the same for
both. Edit again keeps the video's style.
**How it works:** `drawPhrase` in `captions.ts` lays the phrase out once (so nothing moves while it's up) and lights
the word `captionAt` picks; phrases are the review list's phrases, capped at 4 words to fit.
Files: `captions.ts` (+ test), `render.ts`, `reactionRender.ts`, `pipeline.ts`, `jobs.ts`, `store.ts`,
`CaptionReview.tsx`, `CampaignApp.tsx`. App only: `./deploy.sh`.

## New: stop all of one campaign's posts
**What:** for a finished campaign, one button stops every post of it that hasn't gone out yet - waiting for approval,
approved, or scheduled in Postiz. Scheduled ones are taken out of Postiz; all of them are marked rejected, the same
as tapping Reject on each. Only that campaign's posts: every other campaign keeps its schedule, and posts whose time
has already come are left alone.
**How to use it:** Campaigns, open the campaign, under Posting: **Stop all [campaign] posts**. It asks first, then
says how many it stopped. Deleting a campaign now also asks "Also stop every [campaign] post that hasn't gone out
yet?" - before, deleting it left its scheduled posts going out. Archiving in the planner does not stop anything;
do this first.
**How it works:** a `stop-campaign` action on the posting function, for your own posting profile only. It stops
every post in one go however many there are - a hundred is as quick as one - so nothing can go out after you press
it. Posts already in Postiz are then taken out of it in the background, 20 at a time; each shows "Stopped - taking
it out of Postiz" on the Posts screen until it's gone, and if the run is cut off the 5-minute scheduler finishes the
rest. One Postiz won't let go of says so after a few tries: "Couldn't take it out of Postiz - delete it there".
**Needs deploying: run ./deploy-server.sh** (and ./deploy.sh for the button).
Files: `supabase/functions/postiz/index.ts`, `posting.ts`, `CampaignsView.tsx`, `CampaignApp.tsx`.

## New: random posting times, so a campaign never posts the moment a video is ready
**What:** a campaign's Posting now has two choices under Your times: **My own times** (as before) or **Random times**
- "between 10 AM and 10 PM, 2 a day" (change all three). Each day gets its own random times inside that window, at
least 30 minutes apart, different every day and different from your other campaigns. A video takes the next free
one, exactly like your own times; more videos than that on a day spread out to midnight, as extra videos always
have. A campaign with neither now says so in red - on its Posting screen and on its row in Campaigns: "No times -
each video posts the moment it's ready".
**How to use it:** Campaigns, open the campaign, Posting, Postiz, Your times, tap Random times, set the window and
how many a day, Save posting. The Batch tab and New post use the same random times (Batch shows today's).
**How it works:** `supabase/functions/postiz/window.ts` turns a window into a day's times from the campaign and the
date, so the same day always gives the same times and a time is still a slot that holds one video. The server and
the phone both use that one file, so what the Batch tab shows is what the server does. Your own times always win
over a window; only one is saved.
**Needs deploying: run ./deploy-server.sh** - until then the server ignores the window and those campaigns still
post at once, so deploy before relying on it.
Files: `postiz/window.ts` (+ test), `postiz/slots.ts`, `postiz/batch.ts`, `postiz/index.ts`, `PostingEditor.tsx`
(+ test), `posting.ts`, `batch.ts`, `BatchView.tsx`, `NewPost.tsx`, `CampaignApp.tsx`, `CampaignsView.tsx`.

## New: the planner can see which Postiz channels a finished campaign still holds
**What:** when you archive a campaign in the planner, it now lists that campaign's Postiz accounts - connected or
disabled - with "Channels in use: N of 30", which other campaign still posts to the same account (keep those), and
how many posts are still due on them. You disable them in Postiz yourself (Postiz has no way for an app to switch a
channel off - the only call that touches one deletes it for good, with its scheduled posts), then press Check
again. Restoring a campaign shows the reverse, so you can switch them back on.
**How it works:** a new `channels` action on the posting function. Only the planner's own server function can call
it, proving itself with the Supabase project's service key (which already seals every Postiz key here, so it opens
nothing new); it reads Postiz's account list with your saved key and changes nothing there. No key leaves the server.
**Needs deploying: run ./deploy-server.sh** (the planner shows nothing for it until this is out).
Files: `supabase/functions/postiz/channels.ts` (+ test), `supabase/functions/postiz/index.ts`.

## Fix: adding a picture on the cuts screen, a way to the captions, and room to fix captions
**Cuts screen - adding a picture:** "+ Picture" opened its picker below the bottom edge of the phone, so pressing
it looked like nothing happened. The picker now opens right under the video, with "From my phone" and the
picture bank in view. If the playhead is on a part that is cut out, it says so straight away (move it onto a
kept part), instead of after you have chosen a photo and then dropping it.
**Cuts screen - to the captions:** a **Captions** button next to Done. It keeps your cut changes and pictures, the
same as Done, and opens that video's captions (asking first whether the hook gets captions, as the list does).
Opened from the captions screen, it goes back to them. The running time moved down next to the zoom buttons to
make room.
**Captions screen:** only the video stays held at the top now. The headline box, Top/Middle/Usual/Bottom,
Small/Normal/Large/Huge and "+ Add" moved under the list of captions, just above Approve: held at the top with the
video they filled the phone's screen, and the captions scrolled by behind them out of sight. On a phone-sized
screen 4-5 captions now show at once (none did before); changing position or size from down there still shows
on the video at the top.
**Checked:** in a phone-sized Chromium - the picker and the "move the playhead" note opening fully in view; a bank
picture and a phone photo added (on the video, on the timeline, in the list); Captions handing back the cuts and
both pictures; the captions screen with 4-5 phrases in view and the look controls working from the bottom.
Files: `CutsEditor.tsx`, `CaptionReview.tsx`, `CampaignApp.tsx`, `campaign.css`.

## Fix: black strip under the tab bar (undoes the change below)
**What:** the "frame the size of the screen" from the last update left a dead black strip at the bottom of the
iPhone, with the bar - Videos, Batch, Campaigns, Pictures, Settings - a block up from where it belongs. It is back
to how it was: fixed to the bottom of the screen, the page scrolling under it.
**Why the bar misbehaved at all:** on iOS 26 an app added to the Home Screen is told the screen is a status bar's
height shorter than it is (a WebKit bug, 301108, set off by this app's see-through status bar). A frame sized to
"the screen" stops that much short - the black strip. A short screen (Batch, Pictures, a short Videos list) ends
that much short too, and the bar sits on its end instead of the bottom of the phone and moves as you scroll - the
"stays with me, doesn't stay all the way down" from before. The one size iOS gets right there is the "large
viewport" (`lvh`), so in the Home Screen app the page is now always at least that tall, and the bar should sit
on the bottom on every screen. In a Safari tab nothing changes.
**Checked:** in a phone-sized Chromium the bar is at the very bottom on short and long screens and while
scrolled, and the new rule is read by the browser. Not on an iPhone: whether the bar now sits on the bottom of a
short screen in the Home Screen app needs your phone.
Files: `CampaignApp.tsx`, `TabBar.tsx`, `campaign.css`.

## Deploying no longer needs Supabase (no more keychain box)
**What:** `./deploy.sh` now only ships the app: it gets the latest code and puts it on Netlify. It no longer
runs the Supabase command, which is what asked for a "keychain" password on the Mac - and since the script
stopped there, nothing after it was going live either.
**Use it:** `cd /Users/ziadissa/Projects/silence-cutter && git pull && ./deploy.sh`, then reload the cutter on
the phone. Netlify may ask you to log in once in the browser.
**The server:** the two server functions (posting, and the shared login) rarely change. When an update does
change them, `./deploy.sh` ends with "Run: ./deploy-server.sh". That one still uses Supabase: if the Mac asks
for a keychain password, it is your Mac's own login password - type it and press "Always Allow". The planner
bridge setting it used to set every time is already set and stays set.
**Now:** nothing on the server has changed since the last deploy (Oct 6), so `./deploy.sh` is all that is
needed today.
Files: `deploy.sh`, `deploy-server.sh` (new), `.gitignore`, `AGENTS.md`.

## Fix: the tab bar rode up the screen when scrolling
**What:** On an iPhone, scrolling down a long screen (Settings, the Videos list) made the bar along the bottom -
Videos, Batch, Campaigns, Pictures, Settings - move with the scroll instead of staying at the very bottom.
**Why:** the bar was fixed to the bottom of a page that scrolls, and Safari moves that page's own viewport as it
scrolls (its toolbars, the bounce), taking the bar with it.
**Fix:** the screens with the bar are now a frame the size of the screen that never moves: the screen scrolls
inside it and the bar is its bottom row, so there is nothing for the bar to move with. Scrolling past the end
bounces the list, not the whole screen. The last line of every screen still clears the bar. Opening something
full-screen (checking captions, an editor, posting setup) and coming back leaves the list where it was; switching
tabs starts the new tab at its top, as before. The full-screen views scroll as they always have.
**Checked:** in a phone-sized Chromium, Settings (2,647 px tall) scrolled to the bottom with the bar staying at
exactly the bottom of the screen, and the list kept its place across posting setup. Not yet on an iPhone.
Files: `CampaignApp.tsx`, `TabBar.tsx`, `campaign.css`.

## Fix: pictures and the logo came up late after the word
**What:** Say "Hershey's" and its picture came up a good part of a second later, while the caption was already
on the word. Pictures (the angle's and the bank's) and the logo now come up the moment the word is said - a
touch before it, in fact, so they are fully on screen as it lands.
**Why:** the captions are timed by the letter model, which places each word within a frame or two of your voice,
but the pictures were still timed from the speech model's rough times - about 0.2 s late on average and wandering
0.2 s either way, worst in the middle of a sentence, where nothing pulls a word back onto your voice. On top of
that, a picture fades in over its first 0.12 s, so it was seen later still.
**Fix:** everything that comes up on a word - pictures, bank pictures, the logo, sounds and the brand-hit zoom -
is timed from the same exact words as the captions. Pictures and the logo start 0.1 s before the word; sounds and
the zoom land on the word itself. A picture you put on by hand stays exactly where you put it.
**Note:** a video already read keeps its words, and those already have the exact times if captions were on - so
making it again (or Edit again) is enough; it does not need adding fresh. If the letter model could not run, the
pictures use the same timing as the captions did.
Files: `moments.ts` (new), `moments.test.ts`, `pipeline.ts`.

## Change the headline when you edit a video again
**What:** The screen you land on after "Edit again" (the captions screen, with the Cuts button) now has a
**Headline** box under the video, beside the caption position and size. Change the words there and make the video
again; the new headline is on the new video and replaces the old post (if it hasn't gone out).
**Before:** the headline could only be changed in the video's list row, which you had to open and find. Batch
videos already had a headline box in their own Edit screen.
**How:** the box is the same headline the list row edits (`setHeadline`/`saveHeadline`), saved when you leave it.
Files: `CaptionReview.tsx`, `CampaignApp.tsx`.

## Fix: cutting "um"s could take a quietly said word out with it
**What:** With "Also cut "um"s and stumbles" on, an "um" cut checks the sound it is about to remove and
refuses when there is more in it than an "um" could make - that is what stops a mistimed "um" taking a real
word with it. But it judged "sound" by the slider's fixed number (-35 dB), while the pauses have long been
found with a line measured on each take, because quieter words sit at -35 to -39 dB. In a quiet take a
quiet word looked like silence to the "um" check, so a word the speech model ran into the "um" was cut with
it (a test reproduces it: "so um this works" lost "this").
**Fix:** the "um" and stumble checks now use the take's own line. It is never above the slider's number, so
the check can only get stricter: an "um" is left in rather than a word taken out. Nothing else changes.
**Not changed:** the plain cutter, which has the same check, is left exactly as it is (it is kept unchanged
on purpose); say if it should get this too.
Files: `plan.ts` (`fromHeard`), `plan.test.ts`.

## Fix: a setup change could miss the other phone; the word-timing step starts more reliably; a clearer message for clips with no talking
**What:**
- **Sync between the two phones.** A change to a campaign, angle or bank picture is stamped with the time the
  server handled it, not the moment it was saved. One saved while the other phone was reading could land just
  behind where that phone had read to, and never reach it (until it was edited again). Each sync now looks
  back two minutes; taking a change twice is harmless, since only a newer change is ever kept.
- **Word timing ("letter model") running out of memory as it starts.** It started the instant the speech
  model's worker ended, before the phone had taken that memory back ("no available backend found ... Out of
  memory", on both phones). It now waits a moment first, and has one more go if it still can't start for
  memory.
- **"The whole video looks silent. Try recording somewhere quieter."** shown for 33 clips in a minute on
  Oct 2 - clips with no talking in them. The advice was backwards. It now says no talking could be heard,
  that a clip with no talking goes in Batch, and to record closer to the phone if you do talk in it.
Files: `cloud.ts` (`pullFrom`, `readTo`), `cloudPull.test.ts`, `plan.ts`.

## Fix: the plain cutter no longer loses a whole batch when the phone is short of memory, and picks up after the decoder gives up
**What:** Three failures from the app's own error log:
- **Twelve videos failed in six seconds.** On the plain cutter (this morning, 08:05), the speech model
  could not get the memory it needs to start ("Out of memory"), and every video in line after it failed the
  same way within a second - and was dropped from the list. Now a video whose speech model can't start is
  still cut (pauses only) and says what it went without: "The phone had no memory left for the speech model,
  so only the pauses were cut - "um"s were left in. Close other apps, reload this page and add it again to
  try with it."
- **"Decoder failure" on long videos.** The plain cutter failed outright when the phone's video decoder gave
  up partway through a long take (90-335 MB, Oct 1 and today). It now picks up from the last frame written,
  up to four times (waiting first if the app was in the background) - what the campaign videos already do
  ("Decoder gave up 1 time(s) mid-video; carried on from the last frame and finished").
- **Joining recordings failed** on a phone whose encoder would not take the very high quality used for the
  joined file ("This specific encoder configuration ... is not supported"). It now steps down to the quality
  every other video is made at.
**Note:** Safari's "Can't find variable: EmptyRanges" error in the log comes from inside Safari's own video
code at the moment one of its encoders or decoders fails; the app only reports it.
Files: `App.tsx`, `media/silenceCut.ts`, `media/recovery.ts` (shared with `campaign/clipParts.ts`),
`campaign/joinRender.ts`.

## Fix: captions on the wrong word because the word-timing step kept failing on phones
**What:** Captions are timed by a second, small model that finds each word's exact moment (the "letter
model"). On phones it kept giving up: the app's error log has it running out of memory or going quiet for
over a minute 7 times since Sept 28, on both phones that use the cutter, 3 of them since Oct 5 (one this
morning, on the newest version). Every time it gave up, that video's captions fell back to the speech
model's rough times: words come up about 0.2 s off and the last word before a pause can be lost, so on fast
talk the word on screen is often not the word being said.
**Why:** it listened to a whole listening window at once - up to 25 s of sound. The memory it needs, and the
time before it says anything, grow with that length; 25 s was too much for an iPhone.
**Fix:** it now hears each window in pieces of at most 8 s, always cut in the middle of a pause (never in a
word), and reports in after each piece and once it has loaded. The letters it hears are joined back up and
the words are laid along the whole window at once, exactly as before - tested to give the same times as
hearing the window whole.
**Not a setting:** no setting changed the words. The caption text stored with every video posted since
Sept 28 (both posting accounts) is as accurate as on day one. The one setting that did hurt was "Also cut
sounds that aren't speech" (on by default from Oct 3 until the Oct 6 02:13 update); it is off now.
**Reaction videos:** their captions come from the product clip's sound, not the face clip. If the product
clip is a screen recording with music or quiet narration, the words heard from it can be wrong - check them
in the caption check, or make that video without captions.
**To test:** update the app (tap the update banner), then add videos fresh - a video already read keeps the
times it was read with.
Files: `align.ts` (`pieceCuts`, `joinPieces`, `placeWordsAt`), `align.worker.ts`, `plan.ts`, `align.test.ts`.

## Checked: cuts and captions match the cutter before noise cutting; a portrait clip is never left uncut by mistake
**What was checked:** the whole path from reading a video to the cut and the captions, against the
version just before noise cutting existed. With noise cutting off (the default) the pause finding, the
"um"/stumble cuts, the word timing and the caption words run the very same code as before - the only
additions are the loudness picture under the Cuts timeline and the caption size, which don't change what is
cut or heard. Nothing else in that path changed.
**New tests** (`plan.test.ts`): a made-up talking video - room hiss, words fading in and out, short breaths
inside sentences, real pauses between them - with the speech model's words timed the way it really times
them (a bit early or late, each word's end stretched over the pause after it). They check every pause is
cut, every word is kept whole (a quiet one too), the breaths inside a sentence stay, and the caption words
are exactly what was said with nothing added. Run against the noise-cutting version that made the cuts
worse, they fail exactly the way you saw it ("pause left 0.90 s"); now they pass.
**Fix (noise cutting, when you turn it on):** a cough or bump in a pause was never cut, for the same reason
the pauses came back - the speech model's stretched word ends made the cough look like part of a word. A
word now counts only where it starts, so the cough is cut (and listed).
**Fix (wide clips):** "Only make 9:16 - don't cut" leaves every pause in, so it is now only asked about
clips that really are wide: landscape, square or 3:4 (Meta glasses). A clip filmed on a phone held upright
- 9:16, or a taller phone screen like 9:19.5 - is never asked and always cut (it is still cropped to exact
9:16). A video you did choose "only make 9:16" for now says "not cut, only made 9:16" on its row.
**To test:** a video already read keeps the cuts and captions it was read with. Add videos fresh.
Files: `plan.ts` (`fromHeard`, `plainKeep`, `noiseCandidates` - the same steps, now testable),
`plan.test.ts`, `noiseCuts.ts` (`loneSounds`), `framing916.ts` (`isUpright`), `filming.ts`, `JobRow.tsx`.

## Fix: cuts and captions are back to how they were (noise cutting is now off by default)
**What:** After the noise-cutting update, talking videos cut worse than before and the caption words got
worse too. Noise cutting is now **off by default**: cuts and captions run exactly the code they ran before it
existed (nothing else in the cutting or caption-hearing code changed). You can still turn it on in Setup
("Also cut sounds that aren't speech").
**Why it hurt:** the noise step re-listened to stray sounds with the speech model, and whatever that second
listen "heard" was added to the caption words - models make words up from noise ("you", "thank you") - at
the wrong times. It also protected words by their stretched timings, which put pauses back (fixed earlier).
**Fix:** off by default; and when on, the second listen only decides whether a stretch stays - it never adds
words to the captions.
**Note:** if you had switched it on yourself before, it stays on. A video already read keeps its old cuts and
captions: add it again.
Files: `noiseSetting.ts`, `plan.ts`, `SettingsView.tsx`.

## Fix: pauses were not being cut in talking videos (the Cuts view looked uncut)
**What:** In a talking video, the Cuts view showed most pauses still in - the cuts were far shorter than the
cutter used to make, or missing.
**Why:** The noise step I added protects every word the speech model heard, by its start and end times. The model
stretches a word's end across the pause after it, often right up to the next word, so the "protected" span covered
the whole pause and the pause was put back.
**Fix:** A word is now judged by its start: it counts as cut only when most of its first half second was cut, and
only that half second is brought back. A long tail over a pause is ignored, so pauses are cut as before. A quiet word
that really was cut inside a silence is still protected.
**Note:** A video that was already read keeps the cuts it was read with. Add it again (or use Edit again) to get the
new cuts.
Files: `noiseCuts.ts` (`protectWords`), `noiseCuts.test.ts`.

## Usernames, not just names, on your Postiz accounts
**What:** Accounts are listed by their username first - "@kari.ugc · TikTok (Kari)" -
wherever you pick or see them (campaign posting setup, daily limits, Posts, late-account
catch-up), so accounts that share a name can be told apart. With no username it falls back
to "Kari · TikTok".
**How:** Postiz already sends each account's username (`profile`); the app was only showing
the name. `accountLabel` now leads with it, and new posts keep it with their accounts (older
posts show the name as before).
**Note:** The username comes from Postiz's own account list. If one account shows no
username there, it shows its name.
**Needs deploying:** the `postiz` function (so posts keep the username).
Files: `posting.ts` (`accountLabel`, `handleOf`), `postiz/index.ts`, `postiz/limits.ts`.

## Add music after the video is finished (Posts screen)
**What:** On a post waiting in Posts (waiting for approval, approved, or scheduled for later)
you can add music to the finished video.
**Use it:** Posts, the post, "Add music": pick a track (an angle's, one from the batch bank,
or "From my phone"), Normal or Quieter, "Add music". It takes seconds. The new version is
sent and the old post is taken back. The caption, title and per-platform captions you
already had come with it, and a batch video keeps its day and time.
**How:** `addMusic.ts` copies the video's encoded picture across untouched (no re-render, no
quality loss) and only redoes the sound: the video's own sound with the track mixed under
it exactly as music goes under a voice when a video is made (set under the voice, dipping
while you talk, fading in and out, looping if short, through the limiter). The video comes
from this phone's copy, or Postiz's if the phone has let go of it. The post is replaced the
same way Edit again does it (new key `id~2`, old one rejected after the new one is safely
queued).
**Limits:** Music goes on top of whatever sound the video already has; to swap a track, use
Edit again. A post that already went out can't be changed. The new version takes the next
free posting time rather than the exact time the old one had (a batch video keeps its slot).
**Needs deploying:** the `postiz` function (the new version carries the caption over).
Files: `addMusic.ts`, `musicAfter.ts`, `MusicAfter.tsx`, `PostsView.tsx`, `postiz/repost.ts`.

## Caption size
**What:** Captions can be made smaller or bigger, as well as moved.
**Use it:** In the caption check, under the Top / Middle / Usual / Bottom row: Small,
Normal, Large, Huge. The preview changes at once. Settings, Captions sets where new videos
start. Normal is what captions have always been; the others are 0.75x, 1.25x and 1.55x.
A long word still shrinks to fit the screen.
**How:** `captions.ts` `CAPTION_SIZES`, saved per video (`day.captionSize`), used by talking
and reaction videos.

## Put a picture on the video at a moment you pick
**What:** In the cuts editor you can add a picture that comes up at a time you choose, from
the picture bank or from your phone.
**Use it:** Open the video's cuts (Edit cuts, or Cuts from the caption check). Scroll the
timeline so the playhead is where the picture should come up (on a kept part), tap
"+ Picture", then "From my phone" or tap one from the bank. It appears on the timeline as a
small picture bar and on the video preview while the playhead is over it. Under "Pictures on
this video" set how long (1-8 s), where (top, corners, middle) and how big, tap one to jump
to it, or Remove. It starts with the angle's picture-bank spot, size and length.
**How:** A picture put on by hand is another picture cue for the render, shown at the
moment you picked instead of when a word is said, so it gets the same spots and spring-in
as the angle's pictures. Phone pictures are kept with that video for the 2-hour edit window
(then go with it); bank pictures are the bank's own. If a picture's image can't be found when
the video is made, it is left off and you are told. Edit again keeps your pictures.
**Limits:** Talking videos (the ones with a cuts editor). A moment that ends up in a part
you later cut out comes up at the start of the next kept part.
Files: `manualPictures.ts` (+ test), `CutsEditor.tsx`, `pipeline.ts`, `store.ts`.

## Re-check captions with Claude (optional, costs credits) + only review what's flagged
**What:** A button in the caption check: "Use Claude to re-check captions · costs credits ·
about N¢". It fixes words the phone's small speech model misheard (brand and product names
above all) using the campaign's own names, and nothing else. Off unless you tap it, so use
it when you're rushed. Needs posting set up (it uses your Anthropic key).
**Cost:** The estimate before you tap is from the length of the captions (a normal video is
a few cents). After it runs it says what it actually cost, from the tokens the API reported
(Claude Opus 5 at $5 in / $25 out per million tokens, checked 2026-09-25).
**Safe:** Claude must return the same number of phrases in order, and a fix is only taken
if it stays close to what was heard (a spelling fix, not a rewrite; at most one word more or
fewer). Anything else keeps the original phrase. Fixed phrases are highlighted green and
there is an Undo.
**Only review what's flagged:** "Only show the N to check" hides the rest. A phrase is
flagged when Claude changed it, when a word nearly matches a campaign name (like "pump fund"
for Pump.fun, or a name split in two), or when it sits next to a sound the cutter cut or was
unsure about. Flagged ones have an amber edge.
**Needs deploying:** the `postiz` function (new action `recheck-captions`).
Files: `postiz/recheck.ts` (+ test), `captionFlags.ts` (+ test), `CaptionReview.tsx`.

## Cut noises, never words (with a checker) + a brighter cuts editor
**What:** The cutter now also cuts sounds with no speech in them (cough, bump, room
noise), and tells you about anything it cut that could have been a word.
**Safety, in order:** (1) any word the speech model heard is brought back whole with a
little room either side, so a heard word is never cut (except the "um"s and stumbles you
chose to cut). (2) A sound with no word in it is listened to a second time on its own; if
a word turns up, it stays and the word joins the captions. (3) Whatever is still cut that
could have been a word is listed with its exact time, length and loudness. A long sound
with no words (over 2.5 s) is never cut, only pointed out. If almost everything looks
like noise, nothing is cut and it says so. If the second listen fails, nothing is cut.
**Use it:** Settings, Noises (on by default; every video is listened to, so it takes a
little longer). On a video row: "N sounds to check" and a "Check cuts" button. In the cuts
editor, "Check these" lists each sound with Listen / Put it back / Cut it; short clicks are
under "Short noises cut". Each is also marked on the timeline with an amber ? box.
**Cuts editor:** kept parts are green, cut-out time is red-striped, the sound's waveform
is drawn across, amber marks flag what to check, and there is a legend. Bigger parts.
**How:** `noiseCuts.ts` (pure, tested), `plan.ts`, `CutsEditor.tsx`. Videos made with
captions off also keep what was heard, so Edit again works for them.
**Limit:** "Never cuts a word" means a word the model heard; a word it missed twice and
that sits alone with silence on both sides can still be cut - that is what the list is for.

## Fix: "Cannot access 'nr' before initialization" crash
The Videos list crashed the whole page when it had a video row. Cause: the per-video
pictures list (added with "leave one picture out") was called while the page was being
drawn, but defined further down in the same component. Now declared as a function so it
exists when the list draws. Videos waiting come back on reload, as the error says.

## Wide clips: cut them, or only make them 9:16
**What:** When you drop in a video that is not 9:16, the cutter asks: "Cut them and make
9:16", or "Only make 9:16 - don't cut" (every moment stays in). Videos that are already
9:16 are never asked about and are always cut.
**Use it:** Drop videos in as usual. If any are not 9:16, a screen lists them and asks once
for the whole drop. "Don't add them" skips the wide ones (any 9:16 ones in the same drop
are still added and cut).
**How:** `filming.ts` reads the picture size (rotation applied) and sets `vertical`
(`framing916.is916`). A clip whose size can't be read is treated as 9:16: no question, cut.
"Don't cut" sets `noCut` on the video; `plan.ts` `keepWhole` keeps the whole recording
(words are still heard for captions and the logo) and the render makes it 9:16 even when
Settings, Wide clips is Off. Headline, captions and effects still go on; only the cutting is skipped.
Files: `WideAsk.tsx`, `CampaignApp.tsx` (`commitAdd`), `plan.ts`, `pipeline.ts`, `render.ts`.

## Edit again for batch videos
**What:** A batch video can be fixed after it was made: its headline and its music track.
**Use it:** Posts, the video, "Edit again · ... left", change the headline or pick another
track (or none), "Make it again". The old post is replaced if it hasn't gone out; if it
already posted, the edit goes out as a new post and says so.
**How:** The batch video's footage is the bank's and is kept while a job row names it, so the
(small) row is kept for the 2-hour window (`markMade`) instead of being forgotten, and the
bank sweep leaves the footage alone until it expires. `store.peekMadeBatch` /
`reopenBatchJob`, `BatchEdit.tsx`, `CampaignApp.makeBatchAgain`. Same replace-the-post path
as talking videos (`id~2`, `retireOld`).
**Not covered:** swapping which reaction or product clip it uses (that is a different
video).

## Reaction and montage videos get default effects and caption position
**What:** The default effects (Settings) and the caption position now apply to batch
videos too. Reaction: a slow push-in as it opens and a punch at the switch to the product.
Montage: a punch at each clip change. Captions on a reaction's product clip sit where you
chose.
**How:** `effects.ts` `zoomPlace` zooms a cover-filled clip and keeps the canvas covered;
`reactionRender.ts` / `montageRender.ts` plan one move per stretch with the same
`planMotion` the talking videos use, seeded per video. The logo/picture spring-in and
the brand punch do not apply (those renderers have no logo or brand words).
**Note:** There is no per-video "No effects" for batch videos yet (their rows are not
shown); turn the default off in Settings to stop them.

## Reminder to repost (replaces the earlier "repost it again")
**What:** Postiz cannot press the platform's own Repost button on TikTok or Instagram (its
auto-repost is for X only), so the app reminds you instead. Campaign, Posting, Repost:
"Remind me to repost it" after 3 / 7 / 14 / 30 days. When the time comes you get a
notification with the post's link, and the post shows "Time to repost" for 3 days.
**How:** `postiz/index.ts` `remindReposts` (runs on the 5-minute tick, told once per post).
The earlier re-upload repost is gone.

## Auto-repost, and a caption per platform
**Repost:** replaced - see "Reminder to repost" above. (It first re-uploaded the video as a new post; that was not what was wanted.)
**Caption per platform:** On a waiting post with more than one account, "A different
caption for one platform" lets you write one for just that account; accounts left blank
use the main caption. Saved on the post (`captions`), used when it is sent to Postiz,
including accounts linked late.
**Needs deploying:** the `postiz` function (`npx supabase functions deploy postiz
--project-ref uykuoibqdxmpbbrsmyad`). Database columns were applied 2 Oct.
Files: `postiz/repost.ts` (+ test), `postiz/index.ts`, `PostingEditor.tsx`, `PostsView.tsx`.

## Move the captions (top / middle / bottom)
**What:** Captions no longer have to sit where your face is.
**Use it:** In the caption check (the editor), under the video: Top, Middle, Usual or
Bottom. The preview moves at once and the video is made with that position. Settings,
Captions sets where new videos start (Usual = where they have always been).
**How:** `captions.ts` `CAPTION_POSITIONS` (caption centre at 20%, 50%, 63%, 80% of the
height); the choice is saved on that video (`day.captionPosition`) and passed through
`make` to the render. Files: `captions.ts`, `CaptionReview.tsx`, `render.ts`, `pipeline.ts`.
**Limit:** Talking videos. Reaction videos still use the usual place.

## Leave one picture out of one video
**What:** A photo that popped up on a word you said in passing can be dropped from
that video only.
**Use it:** Open the video's row (before approving, or after Edit again) → "Pictures in
this video" lists each picture that will appear, with a tick. Untick to leave it out,
then approve (or re-make).
**How:** `skipPictures.ts` lists the pictures whose words were heard, using the same
matching as the render. The unticked ids are saved on the video (`day.skipPictures`) and
filtered out in `videoLook`. Files: `skipPictures.ts`, `look.ts`, `JobRow.tsx`.

## Proposed: planner bridge (design only)
`docs/PLANNER_BRIDGE_PROPOSAL.md` - how a cutter "posted" post would auto-tick the
planner without exposing your cutter data to other planner users. Needs your OK.

## Music library: names and a player
**What:** Every track in the batch bank has a ▶/■ button and a name you can change;
every made talking video says which track is under it.
**Use it:** Batch tab → Music: tap ▶ to hear it, tap the name to rename (Enter
saves). Made videos list "music: <name>" in their row.
**How:** `TrackPlayer.tsx` plays the stored file through an `Audio` element (object
URL freed on leave). Rename changes only the label in the bank row, not the file.
`CampaignResult.music` carries the name. Per-video track choice already existed
(row → Music) and Edit again re-renders with a new one.
**Not yet:** a swap-music-for-the-whole-batch button; a track in the
angle editor still shows its filename as before.

## Proposed, not applied: repost + per-platform captions columns
`supabase/proposed/20261002120000_cutter_posts_repost_captions.sql` adds four
nullable columns to `cutter_posts` (`repost_of`, `repost_at`, `reposted_at`,
`captions`). Waiting for the owner's OK; nothing in the app depends on it yet.

## Default effects preset
**What:** One setting that gives every talking video punch-ins, hook push and
spring-in logo, so you don't set effects angle by angle.
**Use it:** Settings → Default effects: Off (as shipped) / Subtle / Strong, or mix
the four controls yourself. Per video: open its row (before approving) →
Effects → "No effects".
**How:** Stored on the phone (`cutter-default-effects`). `videoLook` uses the
angle's own effects if it has any on, otherwise the default, so nothing already
set up changes. Per-video off is `day.noEffects`. Files: `defaultEffects.ts`,
`look.ts`, `pipeline.ts`, `JobRow.tsx`, `SettingsView.tsx`.
**Limit:** Reaction/montage (batch) renderers have no zoom effects at all today
(their code says "effects are not used"), so the default only affects talking
videos. Adding zooms to those is a separate piece of work.

## Edit again (2-hour window)
**What:** After a talking video is made, you can reopen it from Posts and fix
captions, cuts or music without redoing everything.
**Use it:** Posts → the video → "Edit again · 1h 40m left". Fix it, Approve.
**How:** The recording, listen results and edits are kept 2 hours (`madeAt`,
`EDIT_WINDOW_MS`), then deleted. Re-making sends a new post (`id~2`) and rejects
the old one first (also pulls it from Postiz if scheduled). Already posted → the
edit goes out as a new post, and says so.
**Not yet:** reaction/montage/batch/joined videos; excluding one picture.
Files: `store.ts`, `CampaignApp.tsx`, `PostsView.tsx`.

## Wide clips become 9:16 (Meta glasses)
**What:** Landscape (or 3:4) clips are turned into 9:16 automatically.
**Use it:** Settings → Wide clips: Fill (crop, default) / Fit (whole picture over
a blurred copy) / Off. Clips already 9:16 are never touched.
**How:** Size read from the container's display size (rotation applied), 1%
tolerance. Blur is a downscale/upscale (no canvas filter, which some Safari lack).
Fill outputs the biggest 9:16 crop, no upscaling. Files: `framing916.ts`, `render.ts`.

## Outlined headlines
**What:** Headlines default to outline style; outline colour and width are settable.
**How:** `look.ts` Headline.outlineColor/outlineWidth, drawn by `overlay.ts`.

## Pause and daily limits
**What:** Pause a platform or account, or cap posts per day; nothing is lost.
**Use it:** Settings → Posting limits.
**How:** Server `limits.ts`: paused/over-cap posts are marked held (`paused`/`cap`) and
released by the 5-minute tick when free. Files: `postiz/limits.ts`, `PostingLimits.tsx`.

## Account linked later gets existing videos
**What:** Linking a new account attaches it to videos already waiting/scheduled.
**Use it:** Checkbox when saving posting setup (on by default; untick to skip).
**How:** `attach.ts` decides per post: has all / add / add to scheduled / too late /
busy / not open.

## No more duplicate uploads
**What:** The same recording is never kept or posted twice.
**How:** Content fingerprint per file (`fingerprint.ts`); hand posts use a
deterministic key `post-<fp>-<campaign>-<day>`; picking the same file again shows
a "skipped" notice.

## Locked down
**What:** Login first; only the existing login (and a backup admin) get in.
**How:** `LoginGate`, own HMAC token login in the `cutter` edge function, 5 wrong
tries → 30-minute lock, `cutter_*` tables closed to anon/authenticated.
Admin password is the `CUTTER_ADMIN_PASSWORD` secret (not set yet).
